/**
 * Read-only audit of every payment that already carries a refund or a
 * credit note, classified into the "cas historiques et reprise" branches.
 *
 * The handoff makes this a precondition: the old dashboard button issued a
 * credit note WITHOUT ever moving money, and the per-flow refund paths moved
 * money without always issuing a note. Both states are in the data now, and
 * "annuler et rembourser" must not be switched on until someone has looked
 * at how many of each there are — a reprise that guesses wrong either
 * double-refunds a customer or burns a second legal document number.
 *
 * Writes nothing. Ever. Safe to point at production.
 *
 *   node scripts/audit-refund-states.mjs
 *   node scripts/audit-refund-states.mjs --json > refund-audit.json
 *   DATABASE_URL=<prod-url> node scripts/audit-refund-states.mjs
 *
 * Exit code is 0 even when problems are found — this is a report, not a
 * gate. The INCONSISTENT bucket is the one that needs a human before
 * anything is switched on.
 */

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { classifyRefundReprise, summarizeRefundState } from "../lib/refunds/plan-refund.js";

config({ path: [".env.local", ".env"], quiet: true });

const asJson = process.argv.includes("--json");
const prisma = new PrismaClient();

const money = (n) => `${Number(n ?? 0).toFixed(2)} €`;

function sourceOf(payment) {
  if (payment.orderId) return "ORDER";
  if (payment.appointmentId) return "APPOINTMENT";
  if (payment.workshopReservationId) return "WORKSHOP";
  if (payment.formationReservationId) return "FORMATION";
  return "UNKNOWN";
}

async function main() {
  // Only payments where something financial has already happened beyond a
  // clean sale: a refund row, a credit note, or a stuck refund state. A
  // plain PAID payment with no correction has nothing to reprise.
  const payments = await prisma.payment.findMany({
    where: {
      isDeleted: false,
      OR: [
        { transactions: { some: { transactionType: "REFUND", isDeleted: false } } },
        { invoice: { creditNotes: { some: {} } } },
        { status: { in: ["REFUND_PENDING", "REFUND_FAILED", "REFUNDED", "PARTIALLY_REFUNDED"] } },
        { pendingRefundAmount: { not: null } },
      ],
    },
    select: {
      id: true,
      status: true,
      paidAmount: true,
      orderId: true,
      appointmentId: true,
      workshopReservationId: true,
      formationReservationId: true,
      pendingRefundAmount: true,
      pendingRefundIdempotencyKey: true,
      refundFailureReason: true,
      refundRetryCount: true,
      transactions: {
        select: {
          id: true,
          amount: true,
          method: true,
          transactionType: true,
          paidAt: true,
          isDeleted: true,
          creditNoteId: true,
        },
      },
      invoice: {
        select: {
          id: true,
          number: true,
          totalInclVat: true,
          creditNotes: { select: { id: true, number: true, totalInclVat: true, issuedAt: true } },
        },
      },
    },
  });

  const buckets = {
    NOTHING_TO_DO: [],
    DOCUMENT_ONLY: [],
    REFUND_ONLY: [],
    FULL: [],
    INCONSISTENT: [],
  };

  for (const payment of payments) {
    const state = summarizeRefundState({ transactions: payment.transactions, invoice: payment.invoice });
    const verdict = classifyRefundReprise({ transactions: payment.transactions, invoice: payment.invoice });

    // Extra flags the classifier does not model, each one a state the new
    // orchestrator has to survive rather than a reason to stop.
    const flags = [];
    if (payment.pendingRefundAmount != null) {
      flags.push(`refund pinned at ${money(payment.pendingRefundAmount)} (status ${payment.status})`);
    }
    if (payment.status === "REFUND_FAILED") {
      flags.push(`Stripe refund failed x${payment.refundRetryCount}: ${payment.refundFailureReason ?? "?"}`);
    }
    // The state the old button produced most often, and the reason
    // Transaction.creditNoteId had to stop being unique.
    const refundRowsWithoutNote = payment.transactions.filter(
      (t) => t.transactionType === "REFUND" && !t.isDeleted && !t.creditNoteId,
    ).length;
    if (refundRowsWithoutNote > 0 && payment.invoice) {
      flags.push(`${refundRowsWithoutNote} REFUND row(s) not linked to any credit note`);
    }
    if ((payment.invoice?.creditNotes.length ?? 0) > 1) {
      flags.push(`${payment.invoice.creditNotes.length} partial credit notes on one invoice`);
    }

    buckets[verdict].push({
      paymentId: payment.id,
      source: sourceOf(payment),
      paymentStatus: payment.status,
      invoiceNumber: payment.invoice?.number ?? null,
      totalCollected: state.totalCollected,
      totalRefunded: state.totalRefunded,
      totalCredited: state.totalCredited,
      remainingRefundable: state.remainingRefundable,
      remainingCreditable: state.remainingCreditable,
      inconsistencies: state.inconsistencies.map((i) => i.message),
      flags,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ scannedPayments: payments.length, buckets }, null, 2));
    return;
  }

  const label = {
    NOTHING_TO_DO: "Rien à faire — remboursé et crédité",
    DOCUMENT_ONLY: "Document manquant — argent déjà remboursé",
    REFUND_ONLY: "Remboursement manquant — note déjà émise",
    FULL: "Correction complète encore à faire",
    INCONSISTENT: "INCOHÉRENT — réconciliation manuelle requise",
  };

  console.log(`\nAudit des états de remboursement — ${payments.length} paiement(s) concerné(s)\n`);
  for (const [key, rows] of Object.entries(buckets)) {
    console.log(`${label[key]} : ${rows.length}`);
  }

  for (const [key, rows] of Object.entries(buckets)) {
    if (rows.length === 0 || key === "NOTHING_TO_DO") continue;
    console.log(`\n── ${label[key]} ─────────────────────────────────────────`);
    for (const row of rows) {
      console.log(
        `  ${row.paymentId}  ${row.source.padEnd(11)} ${String(row.paymentStatus).padEnd(19)}` +
          ` encaissé ${money(row.totalCollected).padStart(10)}` +
          ` · remboursé ${money(row.totalRefunded).padStart(10)}` +
          ` · reste ${money(row.remainingRefundable).padStart(10)}` +
          (row.invoiceNumber ? ` · ${row.invoiceNumber}` : " · pas de facture (B2C)"),
      );
      for (const problem of row.inconsistencies) console.log(`      ⚠ ${problem}`);
      for (const flag of row.flags) console.log(`      · ${flag}`);
    }
  }

  const blocking = buckets.INCONSISTENT.length;
  console.log(
    blocking > 0
      ? `\n${blocking} paiement(s) incohérent(s) à réconcilier avant d'activer « annuler et rembourser ».\n`
      : "\nAucune incohérence bloquante.\n",
  );
}

main()
  .catch((error) => {
    console.error("[audit-refund-states]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
