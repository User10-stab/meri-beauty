import { roundMoney, calculateVatTotals, resolveGoodsVatPolicy, resolveServiceVatPolicy } from "@/lib/tax-policy";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";
import { sessionFlowsBefore } from "@/lib/cash-book/build-ledger";
import {
  categoryForPayment,
  customerForPayment,
  PAYMENT_CATEGORY_LABELS as CATEGORY_LABELS,
} from "@/lib/payments/payment-category";

// Fields resolveGoodsVatPolicy/resolveServiceVatPolicy need to work out the
// applicable rate for a cash sale that has no invoice yet — same select as
// the Livre de recettes' own estimate (lib/livre-de-recettes/build-recettes-journal.js).
const CUSTOMER_SELECT = { isCompany: true, vatNumber: true, vatValidatedAt: true };

/**
 * An issued invoice's rate is an immutable snapshot — always authoritative
 * once it exists. Before that, apply the exact same policy an invoice would
 * use (Belgian or unvalidated customer at 21%, a VIES-validated foreign-EU
 * company at 0%) so the VAT table is never left showing a "Non déterminé"
 * row with a populated TTC but a blank HT/TVA — the rate is knowable (it's
 * what the till would have charged had it invoiced this sale), only the
 * invoice document itself doesn't exist yet.
 */
function resolveVatRate(payment, category) {
  const invoiceRate = payment?.invoice?.vatRate;
  if (invoiceRate != null) return Number(invoiceRate);
  const customer = customerForPayment(payment);
  const policy = category === "ORDER" ? resolveGoodsVatPolicy({ customer }) : resolveServiceVatPolicy({ customer });
  return policy.vatRate;
}

/**
 * The end-of-day report ("rapport X/Z"): every sale and refund of the day —
 * across ALL payment methods, not just cash — broken down by how it was
 * paid, what it was for, and its VAT, plus the cash drawer's own
 * reconciliation. "The day" is one till session's span (openedAt to
 * closedAt), the same boundary already established for the cash book and
 * for filtering session history: a till opened at 9am and closed at 1am the
 * next day is one day's work, not two.
 *
 * It is an "X" while the session is still open (a snapshot, re-runnable at
 * any time, nothing pinned) and a "Z" once closed — and a closed
 * CashSession is already immutable in this codebase (closeCashSession only
 * ever acts on `closedAt: null`, and nothing ever reopens one), so the
 * report itself needs no separate sequence number to be tamper-proof: it
 * simply cannot change once the session it describes is closed.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client — see actions/dashboard/cash-book.js for the
 * auth-gated wrapper.
 */
export async function buildDayReport(client, sessionId) {
  const session = await client.cashSession.findUnique({ where: { id: sessionId } });
  if (!session) return null;

  const windowEnd = session.closedAt ?? new Date();

  // The method/category/VAT breakdown below deliberately covers every
  // payment method (CASH, CARD, ONLINE) — it's the full day's revenue
  // report, not the till's own book. The cash reconciliation figures
  // (expectedCash, cashMovements) are a different question — "what should
  // be physically in this drawer" — so they're delegated to the exact same
  // computeSessionCashTotals that closeCashSession itself uses, rather than
  // derived again locally: two independent computations of the same figure
  // is how a report ends up contradicting the closure it describes.
  const [transactions, cashTotals] = await Promise.all([
    client.transaction.findMany({
      where: {
        paidAt: { gte: session.openedAt, lte: windowEnd },
        isDeleted: false,
      },
      include: {
        payment: {
          include: {
            invoice: { select: { vatRate: true } },
            order: { select: { id: true, user: { select: CUSTOMER_SELECT } } },
            appointment: { select: { id: true, user: { select: CUSTOMER_SELECT } } },
            formationReservation: { select: { id: true, customer: { select: CUSTOMER_SELECT } } },
            workshopReservation: {
              include: {
                customer: { select: CUSTOMER_SELECT },
                session: { include: { workshop: { select: { type: true } } } },
              },
            },
          },
        },
      },
    }),
    computeSessionCashTotals(client, sessionId, session.openingFloat),
  ]);

  const byMethod = {};
  const byCategory = {};
  const byVatRate = new Map();

  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    const sign = transaction.transactionType === "REFUND" ? -1 : 1;

    addToBucket(byMethod, transaction.method, sign * amount);

    const category = categoryForPayment(transaction.payment);
    if (category) addToBucket(byCategory, category, sign * amount);

    const vatRate = resolveVatRate(transaction.payment, category);
    addVatBucket(byVatRate, vatRate, amount, sign);
  }

  const { movementsIn, movementsOut, expectedCash } = cashTotals;

  return {
    session: {
      id: session.id,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      openingFloat: Number(session.openingFloat),
      countedCash: session.countedCash == null ? null : Number(session.countedCash),
      variance: session.variance == null ? null : Number(session.variance),
    },
    isFinal: Boolean(session.closedAt),
    byMethod,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([key, value]) => [CATEGORY_LABELS[key] ?? key, value])
    ),
    byVatRate: [...byVatRate.values()].sort((a, b) => a.rate - b.rate),
    cashMovements: { in: movementsIn, out: movementsOut },
    expectedCash,
  };
}

/**
 * The range-aggregating counterpart to buildDayReport, for the Livre de
 * caisse's inline "Rapport" section — which, per the redesign, filters by an
 * arbitrary date range rather than one till session, and lives on the same
 * page as the journal (CaisseClient.jsx) rather than a separate route.
 * Degenerates to exactly buildDayReport's figures when only one session
 * falls in the range (the common "today" view).
 *
 * Unlike buildDayReport, this does not key off one session's openedAt/
 * closedAt window — it queries transactions directly on [fromDate, toDate],
 * so it agrees with buildCashBookLedger's own range filtering regardless of
 * how session boundaries happen to fall.
 *
 * Deliberately CASH-only (unlike buildDayReport's every-method breakdown):
 * this is the Livre de caisse's own report, about what happened in this
 * drawer specifically — a CARD/ONLINE sale never touched it, so mixing that
 * revenue in here would make it a general revenue report wearing the cash
 * book's name. That fuller, all-methods report is the Livre de recettes.
 *
 * cashMovements is a period TOTAL (every apport/dépense/transfert across
 * every session in range) — expectedCash is NOT a sum across sessions, it is
 * the most recent session's own expected balance, i.e. what should
 * physically be in the drawer right now. Because each session's opening
 * float already equals the previous session's counted/expected cash (the
 * continuous-carry design — see build-ledger.js), that one figure already
 * reflects the whole range's history; summing it across sessions would
 * double-count everything before the last session.
 */
export async function buildRangeReport(client, { fromDate, toDate }) {
  const sessions = await client.cashSession.findMany({
    where: {
      openedAt: { lte: toDate },
      OR: [{ closedAt: null }, { closedAt: { gte: fromDate } }],
    },
    orderBy: { openedAt: "asc" },
  });

  // Exactly the journal's own rows: cash that went through the drawer (a till
  // session, and a piece number). A cash sale settled off-till by an
  // independent (see lib/authorization salon scope) never touched this drawer,
  // so counting it here made the Rapport contradict the journal right next to
  // it — September 2026 read 903,51 € of "ventes espèces" against 773,51 € of
  // "Total entrées", the 130 € difference being another practitioner's money.
  const [transactions, perSessionTotals] = await Promise.all([
    client.transaction.findMany({
      where: {
        paidAt: { gte: fromDate, lte: toDate },
        isDeleted: false,
        method: "CASH",
        cashSessionId: { not: null },
        pieceNumber: { not: null },
      },
      include: {
        payment: {
          include: {
            invoice: { select: { vatRate: true } },
            order: { select: { id: true, user: { select: CUSTOMER_SELECT } } },
            appointment: { select: { id: true, user: { select: CUSTOMER_SELECT } } },
            formationReservation: { select: { id: true, customer: { select: CUSTOMER_SELECT } } },
            workshopReservation: {
              include: {
                customer: { select: CUSTOMER_SELECT },
                session: { include: { workshop: { select: { type: true } } } },
              },
            },
          },
        },
      },
    }),
    Promise.all(sessions.map((s) => computeSessionCashTotals(client, s.id, s.openingFloat))),
  ]);

  let totalSales = 0;
  const byCategory = {};
  const byCategoryCounts = {};
  const byVatRate = new Map();
  const byVatRateCounts = new Map();

  for (const transaction of transactions) {
    const amount = Number(transaction.amount);
    const sign = transaction.transactionType === "REFUND" ? -1 : 1;

    totalSales = roundMoney(totalSales + sign * amount);

    const category = categoryForPayment(transaction.payment);
    if (category) {
      addToBucket(byCategory, category, sign * amount);
      byCategoryCounts[category] = (byCategoryCounts[category] ?? 0) + 1;
    }

    const vatRate = resolveVatRate(transaction.payment, category);
    addVatBucket(byVatRate, vatRate, amount, sign);
    byVatRateCounts.set(vatRate, (byVatRateCounts.get(vatRate) ?? 0) + 1);
  }

  const movementsIn = roundMoney(perSessionTotals.reduce((sum, t) => sum + t.movementsIn, 0));
  const movementsOut = roundMoney(perSessionTotals.reduce((sum, t) => sum + t.movementsOut, 0));
  const lastTotals = perSessionTotals[perSessionTotals.length - 1] ?? null;

  // What the drawer already held when the period started, so the
  // reconciliation reads as a calculation the reader can follow:
  //   solde de départ + ventes + apports − sorties (± écart) = attendu en caisse.
  // Without it, a period-scoped "ventes espèces" sat next to a drawer-wide
  // "Attendu en caisse" with nothing explaining the difference.
  const first = sessions[0] ?? null;
  const openingBalance = !first
    ? null
    : first.openedAt < fromDate
      ? roundMoney(Number(first.openingFloat) + (await sessionFlowsBefore(client, first.id, fromDate)))
      : roundMoney(Number(first.openingFloat));

  // A float that doesn't continue the previous session's expected total is an
  // écart de caisse (the journal shows it as its own row) — part of the
  // period's movement, so the reconciliation has to carry it too.
  const ecart = roundMoney(
    sessions.reduce((sum, session, index) => {
      const previous = sessions[index - 1];
      if (!previous || session.openedAt < fromDate) return sum;
      return sum + Number(session.openingFloat) - Number(previous.expectedCash ?? previous.countedCash ?? 0);
    }, 0)
  );

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingFloat: Number(s.openingFloat),
      countedCash: s.countedCash == null ? null : Number(s.countedCash),
      variance: s.variance == null ? null : Number(s.variance),
      isAutoOpened: Boolean(s.isAutoOpened),
      isAutoClosed: Boolean(s.isAutoClosed),
    })),
    // A range with every session closed is a definitive report; any open
    // session (including "no sessions at all" — nothing to finalize) means
    // it's still a live snapshot, re-runnable at any time.
    isFinal: sessions.length > 0 && sessions.every((s) => s.closedAt != null),
    totalSales,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([key, value]) => [CATEGORY_LABELS[key] ?? key, value])
    ),
    byCategoryCounts: Object.fromEntries(
      Object.entries(byCategoryCounts).map(([key, value]) => [CATEGORY_LABELS[key] ?? key, value])
    ),
    byVatRate: [...byVatRate.values()]
      .map((entry) => ({ ...entry, count: byVatRateCounts.get(entry.rate) ?? 0 }))
      .sort((a, b) => a.rate - b.rate),
    cashMovements: { in: movementsIn, out: movementsOut },
    openingBalance,
    ecart,
    expectedCash: lastTotals?.expectedCash ?? null,
  };
}

function addToBucket(buckets, key, signedAmount) {
  buckets[key] = roundMoney((buckets[key] ?? 0) + signedAmount);
}

/**
 * VAT is backed out of each transaction's own amount at its rate (the
 * invoice's, once one exists — otherwise resolveVatRate's estimate), rather
 * than summed from Invoice/InvoiceLine totals: an invoice is issued once,
 * but a payment can have several transactions against it (a deposit, a
 * balance, a refund), so summing invoice totals per transaction touched
 * today would double-count. resolveVatRate always returns a real number, so
 * every row lands in a genuine rate bucket — never a blank "unknown" one
 * with HT/TVA left at 0 while TTC is populated.
 */
function addVatBucket(byVatRate, rate, amount, sign) {
  const existing = byVatRate.get(rate) ?? { rate, netAmount: 0, vatAmount: 0, grossAmount: 0 };
  const totals = calculateVatTotals(amount, rate);
  existing.netAmount = roundMoney(existing.netAmount + sign * totals.totalExclVat);
  existing.vatAmount = roundMoney(existing.vatAmount + sign * totals.vatAmount);
  existing.grossAmount = roundMoney(existing.grossAmount + sign * totals.totalInclVat);
  byVatRate.set(rate, existing);
}
