import { roundMoney, calculateVatTotals } from "@/lib/tax-policy";
import { computeSessionCashTotals } from "@/lib/cash-book/session-totals";

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
  // is how a report ends up contradicting the closure it describes. That
  // shared helper is also where invoiced cash sales are excluded from the
  // drawer total (see lib/cash-book/build-ledger.js's own doc comment).
  const [transactions, cashTotals] = await Promise.all([
    client.transaction.findMany({
      where: { paidAt: { gte: session.openedAt, lte: windowEnd }, isDeleted: false },
      include: {
        payment: {
          include: {
            invoice: { select: { vatRate: true } },
            order: { select: { id: true } },
            appointment: { select: { id: true } },
            formationReservation: { select: { id: true } },
            workshopReservation: {
              include: { session: { include: { workshop: { select: { type: true } } } } },
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

    const vatRate = transaction.payment?.invoice?.vatRate != null ? Number(transaction.payment.invoice.vatRate) : null;
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
    byVatRate: [...byVatRate.values()].sort((a, b) => (a.rate ?? -1) - (b.rate ?? -1)),
    cashMovements: { in: movementsIn, out: movementsOut },
    expectedCash,
  };
}

const CATEGORY_LABELS = {
  ORDER: "Produits",
  APPOINTMENT: "Rendez-vous",
  FORMATION: "Formations",
  WORKSHOP: "Ateliers",
  EVENT: "Événements",
};

function categoryForPayment(payment) {
  if (!payment) return null;
  if (payment.order) return "ORDER";
  if (payment.appointment) return "APPOINTMENT";
  if (payment.formationReservation) return "FORMATION";
  if (payment.workshopReservation) {
    return payment.workshopReservation.session?.workshop?.type === "EVENT" ? "EVENT" : "WORKSHOP";
  }
  return null;
}

function addToBucket(buckets, key, signedAmount) {
  buckets[key] = roundMoney((buckets[key] ?? 0) + signedAmount);
}

/**
 * VAT is backed out of each transaction's own amount at its invoice's rate,
 * rather than summed from Invoice/InvoiceLine totals — an invoice is issued
 * once, but a payment can have several transactions against it (a deposit,
 * a balance, a refund), so summing invoice totals per transaction touched
 * today would double-count. A transaction with no invoice yet (rare: an
 * online deposit collected before final settlement) falls into a null
 * "rate unknown" bucket rather than being silently dropped.
 */
function addVatBucket(byVatRate, rate, amount, sign) {
  const key = rate == null ? "unknown" : rate;
  const existing = byVatRate.get(key) ?? { rate, netAmount: 0, vatAmount: 0, grossAmount: 0 };
  if (rate == null) {
    existing.grossAmount = roundMoney(existing.grossAmount + sign * amount);
  } else {
    const totals = calculateVatTotals(amount, rate);
    existing.netAmount = roundMoney(existing.netAmount + sign * totals.totalExclVat);
    existing.vatAmount = roundMoney(existing.vatAmount + sign * totals.vatAmount);
    existing.grossAmount = roundMoney(existing.grossAmount + sign * totals.totalInclVat);
  }
  byVatRate.set(key, existing);
}
