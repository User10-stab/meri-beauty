/**
 * Pure refund arithmetic: what is still owed, by which method, against
 * which original payment row.
 *
 * Deliberately free of Prisma and Stripe imports. Every mandated scenario
 * in the "annuler et rembourser" handoff (acompte Stripe seul, Stripe
 * intégral, acompte Stripe + solde CASH, acompte Stripe + solde CARD,
 * reprise d'un historique partiel…) is a question about these functions
 * alone, so they must be testable without a database or a network.
 *
 * The bug this module exists to end: every per-flow refund path used to
 * send `Payment.paidAmount` to Stripe against whichever payment_intent it
 * could find first. For a reservation settled 50 % online + 50 % at the
 * till that asks Stripe to return 21 € when it only ever took 10,50 €.
 * `planRefund` never produces a leg larger than the original transaction it
 * unwinds, so that request cannot be constructed.
 */

/**
 * Identical to lib/tax-policy.js#roundMoney, inlined rather than imported.
 *
 * This module has exactly one import-free job, and scripts/audit-refund-
 * states.mjs runs it under bare Node against production — where the "@/"
 * alias does not exist, because nothing resolves it outside Next and
 * Vitest. Reaching for tax-policy would drag its whole VIES/VAT surface
 * behind one four-line rounding helper for no gain.
 */
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Below one cent, two money figures are the same figure. Matches the
 * REFUND_EPSILON already used across actions/ and lib/payments/ — kept
 * identical on purpose so a leg considered settled here is not considered
 * outstanding there.
 */
export const REFUND_EPSILON = 0.01;

const COLLECTION_TYPES = new Set(["DEPOSIT", "FINAL_PAYMENT"]);

function amountOf(transaction) {
  return Number(transaction?.amount ?? 0);
}

/** Live rows only — a soft-deleted transaction never moved money. */
function isLive(transaction) {
  return transaction?.isDeleted !== true;
}

/**
 * The payment rows money actually came in on, oldest first.
 * Chronological because that is the order a human reads a payment history
 * in, and `allocateRefund` below walks it backwards.
 */
export function collectionTransactions(transactions = []) {
  return transactions
    .filter((t) => isLive(t) && COLLECTION_TYPES.has(t.transactionType))
    .slice()
    .sort((a, b) => new Date(a.paidAt ?? 0) - new Date(b.paidAt ?? 0));
}

export function refundTransactions(transactions = []) {
  return transactions.filter((t) => isLive(t) && t.transactionType === "REFUND");
}

/**
 * How much of each method has already gone back to the customer.
 *
 * Keyed by method rather than by original transaction because a REFUND row
 * written before RefundLeg existed has no link to the payment it reverses —
 * only its method is trustworthy. Legs created from now on do carry
 * `sourceTransactionId`, but this has to keep reading the historical rows
 * correctly or every reprise case mis-states what is left.
 */
export function refundedByMethod(transactions = []) {
  const totals = { CASH: 0, CARD: 0, ONLINE: 0 };
  for (const refund of refundTransactions(transactions)) {
    const method = refund.method ?? "ONLINE";
    totals[method] = roundMoney((totals[method] ?? 0) + amountOf(refund));
  }
  return totals;
}

/**
 * The five figures the handoff requires to be computed BEFORE any new
 * refund action — "total encaissé, total déjà remboursé, total déjà crédité,
 * remboursement restant, correction comptable restante".
 *
 * `invoice` is optional: a particulier without a validated VAT identity
 * never gets one (lib/tax-policy.js#hasInvoiceableVatIdentity), and that is
 * a normal B2C sale, not missing data. The creditable figures are null in
 * that case rather than 0, so a caller cannot mistake "no invoice to
 * correct" for "nothing left to correct".
 *
 * @param {{ transactions?: Array, invoice?: {totalInclVat: number|string, creditNotes?: Array}|null }} input
 */
export function summarizeRefundState({ transactions = [], invoice = null } = {}) {
  const collected = collectionTransactions(transactions).reduce((sum, t) => sum + amountOf(t), 0);
  const refunded = refundTransactions(transactions).reduce((sum, t) => sum + amountOf(t), 0);

  const totalCollected = roundMoney(collected);
  const totalRefunded = roundMoney(refunded);
  const remainingRefundable = roundMoney(Math.max(0, totalCollected - totalRefunded));

  const invoiceTotal = invoice ? roundMoney(Number(invoice.totalInclVat ?? 0)) : null;
  const totalCredited = invoice
    ? roundMoney((invoice.creditNotes ?? []).reduce((sum, note) => sum + Number(note.totalInclVat ?? 0), 0))
    : null;
  const remainingCreditable =
    invoice === null ? null : roundMoney(Math.max(0, invoiceTotal - totalCredited));

  // Anything here means the ledger contradicts itself, and the handoff is
  // explicit that such a case goes to reconciliation with NO automatic
  // movement. Reported rather than thrown: the dashboard has to be able to
  // show an admin why the button is disabled.
  const inconsistencies = [];
  if (totalRefunded > totalCollected + REFUND_EPSILON) {
    inconsistencies.push({
      code: "REFUNDED_EXCEEDS_COLLECTED",
      message: `Remboursé (${totalRefunded} €) supérieur à l'encaissé (${totalCollected} €).`,
    });
  }
  if (invoice && totalCredited > invoiceTotal + REFUND_EPSILON) {
    inconsistencies.push({
      code: "CREDITED_EXCEEDS_INVOICE",
      message: `Crédité (${totalCredited} €) supérieur au total de la facture (${invoiceTotal} €).`,
    });
  }

  return {
    totalCollected,
    totalRefunded,
    remainingRefundable,
    invoiceTotal,
    totalCredited,
    remainingCreditable,
    // "Fully credited" is a property of the invoice, and two old partial
    // notes that happen to sum to the invoice total mean it IS fully
    // credited — the handoff calls this out explicitly: do not create a
    // third note in that case.
    fullyCredited: invoice ? remainingCreditable <= REFUND_EPSILON : false,
    fullyRefunded: totalCollected > 0 && remainingRefundable <= REFUND_EPSILON,
    inconsistencies,
  };
}

/**
 * Splits `amount` across the original payment rows, newest first, never
 * exceeding what remains on any one of them.
 *
 * Newest-first (rather than oldest-first or pro-rata) because a partial
 * refund of a two-part settlement should unwind the balance before touching
 * the acompte: the balance is the part most recently collected and, for a
 * 50/50 split, the one a customer thinks of as "the rest". Pro-rata was
 * rejected — it splits a 10 € gesture into 4,17 € online + 5,83 € cash and
 * makes an admin count out coins for no reason.
 *
 * For a FULL refund the order is irrelevant: every row is drained.
 *
 * @param {Array} transactions - every Transaction on the Payment
 * @param {number} amount - how much to give back in total
 * @returns {Array<{sourceTransactionId: string, method: string, amount: number,
 *   stripeCheckoutSessionId: string|null, stripePaymentIntentId: string|null}>}
 */
export function allocateRefund(transactions = [], amount) {
  let outstanding = roundMoney(amount);
  if (outstanding <= REFUND_EPSILON) return [];

  const alreadyRefunded = refundedByMethod(transactions);
  const pools = { ...alreadyRefunded };

  const originals = collectionTransactions(transactions).slice().reverse();
  const legs = [];

  for (const original of originals) {
    if (outstanding <= REFUND_EPSILON) break;

    const method = original.method ?? "ONLINE";
    const paid = amountOf(original);

    // Consume this method's historical-refund pool before treating any of
    // this row as still refundable. Without it, a payment already refunded
    // once from the Stripe Dashboard would be offered up for refund again.
    const consumed = Math.min(paid, pools[method] ?? 0);
    pools[method] = roundMoney((pools[method] ?? 0) - consumed);
    const availableOnRow = roundMoney(paid - consumed);
    if (availableOnRow <= REFUND_EPSILON) continue;

    const legAmount = roundMoney(Math.min(availableOnRow, outstanding));
    outstanding = roundMoney(outstanding - legAmount);

    legs.push({
      sourceTransactionId: original.id,
      method,
      amount: legAmount,
      stripeCheckoutSessionId: original.stripeCheckoutSessionId ?? null,
      stripePaymentIntentId: original.stripePaymentIntentId ?? null,
    });
  }

  // Legs read best oldest-first once allocated (acompte then solde), even
  // though allocation walked backwards.
  return legs.reverse();
}

/**
 * The full plan for one "annuler et rembourser": the state summary, the
 * legs, and whether anything is left to do at all.
 *
 * `requestedAmount` defaults to the whole remaining refundable balance —
 * the cancellation case. A boutique return passes the value of the goods
 * actually coming back instead.
 *
 * @param {{ transactions?: Array, invoice?: object|null, requestedAmount?: number|null }} input
 */
export function planRefund({ transactions = [], invoice = null, requestedAmount = null } = {}) {
  const state = summarizeRefundState({ transactions, invoice });

  const target =
    requestedAmount === null || requestedAmount === undefined
      ? state.remainingRefundable
      : roundMoney(requestedAmount);

  const blocked = state.inconsistencies.length > 0;
  const overRequested = target > state.remainingRefundable + REFUND_EPSILON;

  const legs = blocked || overRequested ? [] : allocateRefund(transactions, target);
  const plannedTotal = roundMoney(legs.reduce((sum, leg) => sum + leg.amount, 0));

  return {
    ...state,
    requestedAmount: target,
    legs,
    plannedTotal,
    // Split out for the confirmation dialog, which has to say "10,50 €
    // remboursés automatiquement par Stripe, 10,50 € à confirmer au
    // comptoir" before an admin commits to anything.
    automaticTotal: roundMoney(
      legs.filter((leg) => leg.method === "ONLINE").reduce((sum, leg) => sum + leg.amount, 0),
    ),
    manualTotal: roundMoney(
      legs.filter((leg) => leg.method !== "ONLINE").reduce((sum, leg) => sum + leg.amount, 0),
    ),
    requiresManualConfirmation: legs.some((leg) => leg.method !== "ONLINE"),
    blocked,
    overRequested,
  };
}

/**
 * Which of the handoff's "cas historiques et reprise" branches a payment is
 * in, decided before anything is written.
 *
 * Money and paperwork are tracked separately on purpose: the two states the
 * old button produced most often — a credit note with no refund behind it,
 * and a refund with no document — are each recoverable, and neither may be
 * "fixed" by redoing the half that is already done.
 *
 * @returns {"INCONSISTENT"|"NOTHING_TO_DO"|"DOCUMENT_ONLY"|"REFUND_ONLY"|"FULL"}
 */
export function classifyRefundReprise({ transactions = [], invoice = null } = {}) {
  const state = summarizeRefundState({ transactions, invoice });

  // Ledger contradicts itself — reconciliation, never an automatic move.
  if (state.inconsistencies.length > 0) return "INCONSISTENT";

  const moneyOutstanding = state.remainingRefundable > REFUND_EPSILON;
  // With no invoice there is no accounting correction to make: the B2C
  // refund receipt is produced by the operation itself, not by crediting a
  // document that was never issued.
  const paperworkOutstanding = invoice !== null && state.remainingCreditable > REFUND_EPSILON;

  if (!moneyOutstanding && !paperworkOutstanding) return "NOTHING_TO_DO";
  // Money already went back (a Dashboard refund, a completed retry) but the
  // note was never issued. Issue only the note.
  if (!moneyOutstanding && paperworkOutstanding) return "DOCUMENT_ONLY";
  // A full note already exists and the money never moved. Resume the
  // refund against the existing note — never write a second one.
  if (moneyOutstanding && !paperworkOutstanding) return "REFUND_ONLY";
  return "FULL";
}
