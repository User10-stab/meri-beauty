import { roundMoney, calculateVatTotals, resolveGoodsVatPolicy, resolveServiceVatPolicy } from "@/lib/tax-policy";
import { MAX_JOURNAL_ROWS } from "@/lib/cash-book/filters";
import { categoryForPayment, customerForPayment } from "@/lib/payments/payment-category";

// Fields resolveGoodsVatPolicy/resolveServiceVatPolicy need to estimate the
// rate of a not-yet-invoiced cash sale — same select as the Livre de recettes.
const CUSTOMER_SELECT = { isCompany: true, vatNumber: true, vatValidatedAt: true };

/**
 * Assembles the Livre de caisse over a date range: the opening float of
 * every till session that falls in the range, every CASH transaction
 * attached to those sessions, and every drawer movement, merged into one
 * chronological ledger with a running balance.
 *
 * Deliberately scoped to CASH only — mixing in CARD/ONLINE rows would make
 * the running "Solde" column meaningless, since those never touched this
 * drawer. Ateliers/événements/formations/rendez-vous all appear here
 * exactly when they were paid in cash; a card sale is still recorded (see
 * Transaction), just not in this drawer's own book. An invoiced (B2B) cash
 * sale is included the same as any other — the money is still physically in
 * the drawer, invoice or not, and this book's job is to say what's in the
 * drawer.
 *
 * A closed session's opening float already equals the previous session's
 * countedCash (see the auto-carry-forward between auto-open/auto-close), so
 * the running balance is carried CONTINUOUSLY across every session in range
 * rather than reset at each session boundary — several days read as one
 * ledger, exactly like the auto-open/close design intends. This assumes a
 * session rarely spans more than one calendar day, which the daily
 * auto-close (lib/cash-book/auto-session.js) guarantees in the normal case;
 * a session left open across a boundary by a missed auto-close would still
 * render (its OPENING row keeps its true openedAt), just with a balance that
 * starts slightly before the requested range.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client instead of a real database — see
 * actions/dashboard/cash-book.js for the auth-gated wrapper.
 */
export async function buildCashBookLedger(client, { fromDate, toDate }) {
  const sessions = await client.cashSession.findMany({
    where: {
      openedAt: { lte: toDate },
      OR: [{ closedAt: null }, { closedAt: { gte: fromDate } }],
    },
    orderBy: { openedAt: "asc" },
  });

  if (sessions.length === 0) {
    return { sessions: [], rows: [], totals: { entrees: 0, sorties: 0, finalBalance: 0 } };
  }

  const sessionIds = sessions.map((s) => s.id);

  const [transactions, movements] = await Promise.all([
    client.transaction.findMany({
      where: {
        cashSessionId: { in: sessionIds },
        method: "CASH",
        isDeleted: false,
        pieceNumber: { not: null },
        paidAt: { gte: fromDate, lte: toDate },
      },
      include: {
        payment: {
          include: {
            invoice: { select: { number: true, vatRate: true } },
            order: { select: { id: true, orderNumber: true, user: { select: CUSTOMER_SELECT } } },
            appointment: {
              include: {
                user: { select: CUSTOMER_SELECT },
                staffService: { include: { service: { select: { name: true } } } },
              },
            },
            workshopReservation: {
              include: {
                customer: { select: CUSTOMER_SELECT },
                session: { include: { workshop: { select: { title: true, type: true } } } },
              },
            },
            formationReservation: {
              include: {
                customer: { select: CUSTOMER_SELECT },
                session: { include: { formation: { select: { title: true } } } },
              },
            },
          },
        },
      },
      orderBy: { paidAt: "asc" },
      take: MAX_JOURNAL_ROWS,
    }),
    client.cashMovement.findMany({
      where: {
        cashSessionId: { in: sessionIds },
        occurredAt: { gte: fromDate, lte: toDate },
      },
      include: { recordedBy: { select: { fullName: true } } },
      orderBy: { occurredAt: "asc" },
      take: MAX_JOURNAL_ROWS,
    }),
  ]);

  const openingRows = sessions
    .map((session, index) => ({ session, previousSession: sessions[index - 1] ?? null }))
    // Only sessions whose own opening actually falls in the visible window
    // get an OPENING row rendered — a session still open from before
    // fromDate contributes its balance silently (see module doc) rather
    // than showing a confusing "Solde initial" dated outside the range.
    .filter(({ session }) => session.openedAt >= fromDate && session.openedAt <= toDate)
    .map(({ session, previousSession }) => sessionOpeningRow(session, sessions.length > 1, previousSession));

  const rows = [...openingRows, ...transactions.map(transactionToRow), ...movements.map(movementToRow)];

  // A stable sort by date alone would leave same-instant rows (an opening
  // float and a sale recorded in the same tick, in tests or a very fast
  // double-submit) in query order, which happens to already put "Solde
  // initial" first — but relying on that would be an accident, not a
  // contract, so it's pinned explicitly.
  rows.sort((a, b) => {
    const diff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (diff !== 0) return diff;
    if (a.kind === "OPENING") return -1;
    if (b.kind === "OPENING") return 1;
    return 0;
  });

  // Seed the running balance with whatever a session already open before
  // fromDate had accumulated up to fromDate — see the module doc's note on
  // sessions spanning the range boundary. In the normal daily-auto-close
  // case this is always the first session's openingFloat exactly.
  //
  // It is the float PLUS that session's own cash flows before fromDate, the
  // same four terms computeSessionCashTotals counts. The float alone left out
  // every sale made before the range: September 2026 starts inside the
  // 28/08→11/09 session, and its Solde read 923,51 € while "Attendu en
  // caisse" (rightly) read 1 349,94 € — 426,43 € of August sales missing.
  const firstSession = sessions[0];
  let balance =
    firstSession.openedAt < fromDate
      ? roundMoney(Number(firstSession.openingFloat) + (await sessionFlowsBefore(client, firstSession.id, fromDate)))
      : 0;

  const withBalance = rows.map((row) => {
    balance = roundMoney(balance + row.entree - row.sortie);
    return { ...row, solde: balance };
  });

  // Excludes OPENING rows: the float is each session's starting point, not a
  // transaction — including it would make "Total entrées" disagree with the
  // till-close reconciliation for the sessions in range.
  const totals = withBalance.reduce(
    (acc, row) => {
      if (row.kind === "OPENING") return acc;
      return { entrees: roundMoney(acc.entrees + row.entree), sorties: roundMoney(acc.sorties + row.sortie) };
    },
    { entrees: 0, sorties: 0 }
  );

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openingFloat: Number(s.openingFloat),
      isAutoOpened: Boolean(s.isAutoOpened),
      isAutoClosed: Boolean(s.isAutoClosed),
    })),
    rows: withBalance,
    totals: { ...totals, finalBalance: balance },
  };
}

/** Net cash a session took in before `beforeDate`: sales − refunds + apports − sorties. */
export async function sessionFlowsBefore(client, sessionId, beforeDate) {
  const [sales, refunds, movements] = await Promise.all([
    client.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", isDeleted: false, transactionType: { not: "REFUND" }, paidAt: { lt: beforeDate } },
      _sum: { amount: true },
    }),
    client.transaction.aggregate({
      where: { cashSessionId: sessionId, method: "CASH", isDeleted: false, transactionType: "REFUND", paidAt: { lt: beforeDate } },
      _sum: { amount: true },
    }),
    client.cashMovement.findMany({
      where: { cashSessionId: sessionId, occurredAt: { lt: beforeDate } },
      select: { type: true, amount: true },
    }),
  ]);
  const moved = movements.reduce((sum, m) => sum + (m.type === "CASH_IN" ? 1 : -1) * Math.abs(Number(m.amount)), 0);
  return roundMoney(Number(sales._sum.amount ?? 0) - Number(refunds._sum.amount ?? 0) + moved);
}

function sessionOpeningRow(session, labelWithDate, previousSession) {
  const dateLabel = labelWithDate
    ? new Date(session.openedAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })
    : null;
  // A carried-forward opening float is normally the exact same money as the
  // previous session's own counted total (see auto-session.js/
  // session-lifecycle.js's carry-forward chain) — already reflected in the
  // running balance from that previous session's last row, not new cash.
  // Recording the full openingFloat here on every session after the first
  // would make the running balance grow by that amount every single day the
  // till sits untouched, even with zero real movement — exactly the bug
  // reported 16/09/2026 (a "Solde initial" of 13,50 € re-added on top of an
  // already-correct 803,92 €, two days running). Only a genuine mismatch
  // against what was actually carried forward — a manual recount, or a reset
  // like 11/09/2026's admin close-to-zero — should move the balance, and only
  // by the difference.
  //
  // The difference is taken against what the previous session was EXPECTED
  // to hold, not what was counted: a closure counted at 0 € against
  // 1 289,85 € expected (the 11/09 test) used to vanish from the journal,
  // because the next float matched that wrong count — the journal kept
  // 1 289,85 € while "Attendu en caisse" restarted from 0. Measured against
  // expectedCash, any closing gap or float mismatch shows up here as an
  // "Écart de caisse" row, and the journal's Solde always equals the drawer's
  // expected cash (the deltas telescope to the last session's float).
  const previousBalance = previousSession ? Number(previousSession.expectedCash ?? previousSession.countedCash ?? 0) : 0;
  const delta = roundMoney(Number(session.openingFloat) - previousBalance);
  const kindLabel = previousSession && delta !== 0 ? "Écart de caisse" : "Solde initial";
  return {
    kind: "OPENING",
    date: session.openedAt,
    pieceNumber: null,
    reference: null,
    label: dateLabel ? `${kindLabel} — ${dateLabel}` : kindLabel,
    entree: delta > 0 ? delta : 0,
    sortie: delta < 0 ? -delta : 0,
    sessionId: session.id,
  };
}

/**
 * VAT carried by a cash sale/refund, same rule as the Livre de recettes: an
 * issued invoice's rate is authoritative, otherwise the policy an invoice
 * would apply. Signed like the drawer (a refund gives the VAT back).
 */
function vatForTransaction(transaction, amount, isRefund) {
  const payment = transaction.payment;
  const invoiceRate = payment?.invoice?.vatRate;
  const customer = customerForPayment(payment);
  const vatRate =
    invoiceRate != null
      ? Number(invoiceRate)
      : categoryForPayment(payment) === "ORDER"
        ? resolveGoodsVatPolicy({ customer }).vatRate
        : resolveServiceVatPolicy({ customer }).vatRate;
  const totals = calculateVatTotals(amount, vatRate);
  const sign = isRefund ? -1 : 1;
  return {
    vatRate,
    vatSource: invoiceRate != null ? "invoice" : "estimated",
    amountHt: roundMoney(sign * totals.totalExclVat),
    amountVat: roundMoney(sign * totals.vatAmount),
  };
}

function transactionToRow(transaction) {
  const isRefund = transaction.transactionType === "REFUND";
  const amount = Number(transaction.amount);
  return {
    ...vatForTransaction(transaction, amount, isRefund),
    kind: isRefund ? "REFUND" : "SALE",
    date: transaction.paidAt,
    pieceNumber: transaction.pieceNumber,
    reference: transaction.payment?.invoice?.number ?? null,
    label: labelForPayment(transaction.payment, { isRefund }),
    entree: isRefund ? 0 : amount,
    sortie: isRefund ? amount : 0,
    // Carried through so the UI can link N° pièce to the actual ticket this
    // line was produced by — see CaisseClient.jsx. transaction.id and
    // payment.id are already present on the raw Prisma object (the query
    // above `include`s payment rather than `select`ing it), so this is a
    // free reshape, not a new query.
    transactionId: transaction.id,
    paymentId: transaction.payment?.id ?? null,
    orderId: transaction.payment?.order?.id ?? null,
    // A reservation's ticket is minted at settlement, never on an acompte, so
    // a deposit row must not offer a link at all — see pieceNumberHref. Also a
    // free reshape: `include` already loaded every Payment scalar.
    paymentStatus: transaction.payment?.status ?? null,
  };
}

function labelForPayment(payment, { isRefund }) {
  const prefix = isRefund ? "Remboursement — " : "";
  if (!payment) return `${prefix}Vente`;
  if (payment.order) return `${prefix}Vente produits — commande n°${payment.order.orderNumber}`;
  if (payment.appointment) {
    const service = payment.appointment.staffService?.service?.name;
    return `${prefix}Rendez-vous${service ? ` — ${service}` : ""}`;
  }
  if (payment.workshopReservation) {
    const workshop = payment.workshopReservation.session?.workshop;
    const noun = workshop?.type === "EVENT" ? "Événement" : "Atelier";
    return `${prefix}${noun}${workshop?.title ? ` — ${workshop.title}` : ""}`;
  }
  if (payment.formationReservation) {
    const title = payment.formationReservation.session?.formation?.title;
    return `${prefix}Formation${title ? ` — ${title}` : ""}`;
  }
  return `${prefix}Vente`;
}

function movementToRow(movement) {
  const amount = Number(movement.amount);
  return {
    kind: movement.type,
    date: movement.occurredAt,
    pieceNumber: movement.pieceNumber,
    reference: null,
    label: movement.label,
    entree: movement.type === "CASH_IN" ? amount : 0,
    sortie: movement.type === "CASH_IN" ? 0 : amount,
  };
}
