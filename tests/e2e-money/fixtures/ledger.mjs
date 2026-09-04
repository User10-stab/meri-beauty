import { prisma, money, moneyEquals, EPSILON, loadPaymentLedger } from "./db.mjs";

/**
 * The books, checked the way an accountant would check them.
 *
 * Every scenario in this suite ends here. Driving the UI proves a button
 * works; this proves the money is still right afterwards — which is the only
 * question that actually matters, and the one no amount of DOM assertion can
 * answer.
 *
 * The invariants are deliberately stated per *method* rather than per total.
 * A payment settled 50 % by card and 50 % in cash has one total and two very
 * different pots of money, and every serious refund bug in this domain is
 * some variant of refunding one pot out of the balance of the other.
 */

const COLLECTION_TYPES = new Set(["DEPOSIT", "FINAL_PAYMENT"]);

function sumAmounts(rows) {
  return money(rows.reduce((total, row) => total + Number(row.amount), 0));
}

/** Groups amounts by TransactionMethod ("ONLINE" | "CASH" | "CARD"). */
function byMethod(rows) {
  const totals = {};
  for (const row of rows) {
    totals[row.method] = money((totals[row.method] ?? 0) + Number(row.amount));
  }
  return totals;
}

export function summarizeLedger(payment) {
  const collections = payment.transactions.filter((t) => COLLECTION_TYPES.has(t.transactionType));
  const refunds = payment.transactions.filter((t) => t.transactionType === "REFUND");
  const collected = sumAmounts(collections);
  const refunded = sumAmounts(refunds);

  return {
    paidAmount: money(payment.paidAmount),
    collected,
    refunded,
    collectedByMethod: byMethod(collections),
    refundedByMethod: byMethod(refunds),
    held: money(collected - refunded),
    status: payment.status,
  };
}

/**
 * What a leg still owes: its planned amount while unsettled, and only the
 * shortfall once it has settled short. Mirrors the arithmetic in
 * lib/refunds/operation-status.js and OutstandingRefunds.jsx — if those three
 * ever disagree, the dashboard is lying to whoever is standing at the till.
 */
function outstandingOf(leg) {
  if (leg.status === "SUCCEEDED") {
    if (leg.settledAmount == null) return 0;
    return Math.max(0, money(Number(leg.amount) - Number(leg.settledAmount)));
  }
  if (leg.status === "CANCELLED") return 0;
  return money(leg.amount);
}

/**
 * @param {string} paymentId
 * @param {object} [options]
 * @param {number} [options.expectHeld] what the salon should still be holding
 * @param {boolean} [options.allowLegacyRefundRows] for the paths that still refund through Stripe directly
 */
export async function assertLedgerSound(paymentId, { expectHeld = null, allowLegacyRefundRows = false } = {}) {
  const payment = await loadPaymentLedger(paymentId);
  if (!payment) throw new Error(`assertLedgerSound: no Payment ${paymentId}`);

  const summary = summarizeLedger(payment);
  const problems = [];

  // ── 1. Never refund more than was taken ─────────────────────────────────
  if (summary.held < -EPSILON) {
    problems.push(
      `Refunded more than was ever collected: collected ${summary.collected} €, refunded ${summary.refunded} €.`,
    );
  }
  if (expectHeld != null && !moneyEquals(summary.held, expectHeld)) {
    problems.push(`Expected to still hold ${money(expectHeld)} €, but the ledger holds ${summary.held} €.`);
  }

  // ── 2. Per-method solvency — the mixed-payment guard ────────────────────
  // The 21 € case from the handoff: an acompte of 10,50 € on a card plus
  // 10,50 € in cash must produce a 10,50 € Stripe refund, never a 21 € one.
  // Plans are checked as well as settlements, so an over-refund is caught
  // when it is queued rather than after the money has gone.
  const legs = payment.refundOperations.flatMap((operation) => operation.legs);
  const plannedByMethod = {};
  for (const leg of legs) {
    plannedByMethod[leg.method] = money((plannedByMethod[leg.method] ?? 0) + outstandingOf(leg));
  }

  const allMethods = new Set([
    ...Object.keys(summary.collectedByMethod),
    ...Object.keys(summary.refundedByMethod),
    ...Object.keys(plannedByMethod),
  ]);

  for (const method of allMethods) {
    const collected = summary.collectedByMethod[method] ?? 0;
    const refunded = summary.refundedByMethod[method] ?? 0;
    const planned = plannedByMethod[method] ?? 0;

    if (refunded > collected + EPSILON) {
      problems.push(`${method}: refunded ${refunded} € against only ${collected} € ever collected by that method.`);
    }
    if (refunded + planned > collected + EPSILON) {
      problems.push(
        `${method}: ${refunded} € already refunded plus ${planned} € still planned exceeds the ` +
          `${collected} € collected by that method.`,
      );
    }
  }

  // ── 3. The documents agree with the legs ────────────────────────────────
  for (const operation of payment.refundOperations) {
    const legTotal = sumAmounts(operation.legs);
    if (!moneyEquals(legTotal, operation.totalAmount)) {
      problems.push(
        `RefundOperation ${operation.id}: legs total ${legTotal} € but the operation is for ` +
          `${money(operation.totalAmount)} €.`,
      );
    }
    if (operation.creditNote && !moneyEquals(operation.creditNote.totalInclVat, operation.totalAmount)) {
      problems.push(
        `Credit note ${operation.creditNote.number} is for ${money(operation.creditNote.totalInclVat)} € ` +
          `but its operation is for ${money(operation.totalAmount)} €.`,
      );
    }
    // B2C refunds deliberately have no financial document. B2B operations
    // retain their credit note; historical receipt data is ignored here.
  }

  // ── 4. Every euro refunded is traceable to a leg ────────────────────────
  if (!allowLegacyRefundRows) {
    const settledTransactionIds = new Set(legs.map((leg) => leg.refundTransactionId).filter(Boolean));
    for (const transaction of payment.transactions.filter((t) => t.transactionType === "REFUND")) {
      if (!settledTransactionIds.has(transaction.id)) {
        problems.push(
          `REFUND transaction ${transaction.id} (${money(transaction.amount)} €, ${transaction.method}) ` +
            "belongs to no RefundLeg — it was recorded outside the refund system.",
        );
      }
    }
  }

  // ── 5. Payment.status follows the arithmetic ────────────────────────────
  if (summary.refunded > EPSILON) {
    const expected = summary.refunded + EPSILON >= summary.paidAmount ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (payment.status !== expected) {
      problems.push(
        `Payment.status is ${payment.status}, but ${summary.refunded} € of ${summary.paidAmount} € is ` +
          `refunded (expected ${expected}).`,
      );
    }
  }

  // ── 6. The cash book stays reconcilable ─────────────────────────────────
  // Only CASH rows enter the till total, and every one of them must carry a
  // piece number or the close will not balance (see lib/cash-book/*).
  for (const transaction of payment.transactions) {
    if (transaction.method === "CASH" && !transaction.pieceNumber) {
      problems.push(`CASH transaction ${transaction.id} has no cash-book pieceNumber.`);
    }
    if (transaction.method === "ONLINE" && transaction.pieceNumber) {
      problems.push(`ONLINE transaction ${transaction.id} carries pieceNumber ${transaction.pieceNumber}.`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Ledger is unsound for payment ${paymentId}:\n\n${problems.map((p) => `  • ${p}`).join("\n")}\n\n` +
        `Summary: ${JSON.stringify(summary, null, 2)}`,
    );
  }

  return summary;
}

/**
 * Gapless numbering is a legal requirement in Belgium, not a nicety, and this
 * suite issues real credit notes into the real counters. Asserting the series
 * is still contiguous is how we find out immediately if a scenario managed to
 * allocate a number and then roll its document back.
 *
 * @param {"invoice"|"creditNote"} model
 * @param {string} prefix e.g. "NC2026-"
 */
export async function assertNumberingContiguous(model, prefix) {
  const rows = await prisma[model].findMany({
    where: { number: { startsWith: prefix } },
    select: { number: true },
  });
  if (rows.length === 0) return { prefix, count: 0 };

  const seen = new Set(
    rows
      .map((row) => Number.parseInt(row.number.slice(prefix.length), 10))
      .filter((value) => Number.isFinite(value)),
  );
  const sorted = [...seen].sort((a, b) => a - b);

  const missing = [];
  for (let expected = sorted[0]; expected <= sorted.at(-1); expected += 1) {
    if (!seen.has(expected)) missing.push(`${prefix}${String(expected).padStart(6, "0")}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Gap in the ${model} numbering series ${prefix}: ${missing.join(", ")}. ` +
        "A number was allocated and its document never committed.",
    );
  }

  return { prefix, count: sorted.length, first: sorted[0], last: sorted.at(-1) };
}
