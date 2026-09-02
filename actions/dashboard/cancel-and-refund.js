"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { planRefund } from "@/lib/refunds/plan-refund";
import { issueCreditNote } from "@/lib/invoicing";
import {
  loadRefundContext,
  openRefundOperation,
  resolveRefundSource,
  RefundNotAllowedError,
} from "@/lib/refunds/open-refund-operation";
import { settleRefundLeg } from "@/lib/refunds/settle-leg";
import { notifyRefundComplete } from "@/lib/refunds/notify-refund-complete";
import { authorizeRefund, cancelsUnderlyingItem, releasesCapacity } from "@/lib/refunds/authorize";
import { notifyAllInWaitingList } from "@/lib/workshops/notify-waiting-list";
import { notifyAllInFormationWaitingList } from "@/lib/formations/notify-waiting-list";

/**
 * "Annuler et générer la note de crédit" — the operation that replaced the
 * old document-only button.
 *
 * The old `issueCreditNoteForTransaction` produced a legally numbered credit
 * note and nothing else: no cancellation, no refund, no released seat. The
 * dev-database audit (scripts/audit-refund-states.mjs) found nine payments
 * left in exactly that state. This action cannot produce it — the note, the
 * cancellation and the refund legs are written by one transaction or none
 * of them are.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) return null;
  return session;
}

function refreshOperationViews() {
  revalidatePath("/dashboard/operations");
  revalidatePath("/dashboard/reservations");
  revalidatePath("/dashboard/ateliers");
  revalidatePath("/dashboard/formations");
  revalidatePath("/dashboard/commandes");
  revalidatePath("/dashboard/caisse");
}

/** The label an admin reads in the confirmation dialog. */
function describeItem(context, source) {
  if (source === "WORKSHOP") {
    return context.workshopReservation?.session?.workshop?.title ?? "Réservation atelier";
  }
  if (source === "FORMATION") {
    return context.formationReservation?.session?.formation?.title ?? "Réservation formation";
  }
  if (source === "APPOINTMENT") return "Rendez-vous";
  if (context.order) return `Commande n°${context.order.orderNumber}`;
  return "Paiement";
}

function currentStatus(context, source) {
  if (source === "WORKSHOP") return context.workshopReservation?.status ?? null;
  if (source === "FORMATION") return context.formationReservation?.status ?? null;
  if (source === "APPOINTMENT") return context.appointment?.status ?? null;
  return context.order?.status ?? null;
}

/**
 * Everything the confirmation dialog must state BEFORE an admin commits:
 * what is affected, its current status, how much is credited, what is
 * released, what Stripe does automatically, what has to be confirmed by
 * hand, and that the customer is mailed only after real confirmation.
 *
 * Read-only. Runs the same authorization check the write path does, so the
 * dialog can explain a refusal instead of letting the admin find out by
 * clicking.
 */
export async function previewCancelAndRefund({ paymentId, trigger = "SALON_CANCELLATION", reason = "" }) {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Non autorisé." };

  const context = await loadRefundContext(prisma, paymentId);
  if (!context) return { success: false, message: "Paiement introuvable." };

  const source = resolveRefundSource(context);
  const plan = planRefund({ transactions: context.transactions, invoice: context.invoice });

  const reservation =
    source === "WORKSHOP" ? context.workshopReservation
    : source === "FORMATION" ? context.formationReservation
    : null;

  const cancellationRequest =
    source === "APPOINTMENT"
      ? await prisma.appointmentCancellationRequest.findUnique({
          where: { appointmentId: context.appointment?.id ?? "" },
          include: {
            requestedBy: { select: { fullName: true } },
            reviewedBy: { select: { fullName: true } },
          },
        })
      : reservation
        ? await prisma.reservationCancellationRequest.findFirst({
            where:
              source === "WORKSHOP"
                ? { workshopReservationId: reservation.id }
                : { formationReservationId: reservation.id },
            include: {
              requestedBy: { select: { fullName: true } },
              reviewedBy: { select: { fullName: true } },
            },
          })
        : null;

  // Checked with the reason the admin has actually typed so far, so an
  // empty motive shows as the blocker it is rather than a surprise later.
  const verdict = authorizeRefund({
    actorRole: session.user.role,
    source,
    trigger,
    reason: reason || "—",
    state: plan,
    appointment: context.appointment,
    reservation,
    order: context.order,
    returnRequest: null,
    cancellationRequest,
    payment: context,
  });

  const willCancel = cancelsUnderlyingItem(trigger);
  const willRelease = releasesCapacity({
    trigger,
    plannedTotal: plan.plannedTotal,
    remainingRefundable: plan.remainingRefundable,
  });

  const seats = Number(reservation?.seatsCount ?? (source === "APPOINTMENT" ? 1 : 0));
  const restockLines = source === "ORDER" || source === "POS" ? (context.order?.items?.length ?? 0) : 0;

  const inFlight = await prisma.refundOperation.findFirst({
    where: { paymentId, status: { in: ["PENDING", "PARTIALLY_REFUNDED"] } },
    select: { id: true, status: true, createdAt: true },
  });

  return {
    success: true,
    data: serializeDecimalFields({
      paymentId,
      source,
      itemLabel: describeItem(context, source),
      currentStatus: currentStatus(context, source),
      // "Conserver le statut historique" — the dialog has to say plainly
      // that a NO_SHOW is NOT being turned into a cancellation.
      keepsHistoricalStatus: !willCancel,
      totalCollected: plan.totalCollected,
      alreadyRefunded: plan.totalRefunded,
      creditedTotal: plan.plannedTotal,
      automaticTotal: plan.automaticTotal,
      manualTotal: plan.manualTotal,
      manualLegs: plan.legs
        .filter((leg) => leg.method !== "ONLINE")
        .map((leg) => ({ method: leg.method, amount: leg.amount })),
      releasedSeats: willRelease ? seats : 0,
      restoredStockLines: willRelease ? restockLines : 0,
      // Invoice present -> legal credit note. Absent -> B2C refund receipt.
      documentKind: context.invoice ? "CREDIT_NOTE" : "REFUND_RECEIPT",
      invoiceNumber: context.invoice?.number ?? null,
      alreadyFullyCredited: plan.fullyCredited,
      customerRequest: cancellationRequest
        ? {
            message: cancellationRequest.reason,
            status: cancellationRequest.status,
            requestedBy: cancellationRequest.requestedBy?.fullName ?? null,
            reviewedBy: cancellationRequest.reviewedBy?.fullName ?? null,
          }
        : null,
      approvingAdmin: session.user.name ?? session.user.email ?? null,
      inFlightOperation: inFlight,
      allowed: verdict.allowed,
      blockedReason: verdict.allowed ? null : verdict.message,
    }),
  };
}

/**
 * Cancels, releases, documents — and instructs. Moves no money.
 *
 * Confirmed policy (2026-09-02): this application never calls Stripe to
 * refund. An OWNER/ADMIN performs every card refund by hand in the Stripe
 * dashboard, and hands cash back at the counter. So what this action
 * produces is a decision plus a worklist: the booking is cancelled, the
 * seat or stock released, the credit note issued and the operation's legs
 * written out saying precisely what has to be paid back, by which method,
 * against which original payment.
 *
 * That precision is the point of keeping the machinery at all. Refunding by
 * hand makes the mixed-payment mistake MORE likely, not less: the invoice
 * says 21 €, and it takes a computation nobody wants to do at a counter to
 * know that Stripe must only be asked for the 10,50 € acompte it actually
 * took. planRefund does that computation once and the panel shows the
 * answer.
 *
 * The loop closes at the Stripe webhook (ONLINE legs) or at an admin
 * confirming a hand-over (CASH/CARD legs) — never here.
 */
export async function cancelAndRefund({ paymentId, trigger = "SALON_CANCELLATION", reason, requestedAmount = null }) {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Non autorisé." };
  if (typeof paymentId !== "string" || !paymentId) return { success: false, message: "Paiement introuvable." };
  if (!reason || reason.trim().length < 10) {
    return { success: false, message: "Un motif d'au moins 10 caractères est obligatoire." };
  }

  let opened;
  try {
    opened = await openRefundOperation({
      prisma,
      paymentId,
      trigger,
      reason: reason.trim(),
      actor: { id: session.user.id, role: session.user.role },
      requestedAmount,
    });
  } catch (error) {
    if (error instanceof RefundNotAllowedError) return { success: false, message: error.message, code: error.code };
    console.error("[cancelAndRefund] open failed", error);
    return { success: false, message: "Impossible d'ouvrir l'opération de remboursement." };
  }

  const { operation, plan, released, resumed } = opened;

  // Waiting lists are woken only when a seat genuinely went back on sale.
  if (released.releasedSeats > 0 && released.sessionId) {
    const notify =
      operation.source === "WORKSHOP"
        ? notifyAllInWaitingList(released.sessionId)
        : notifyAllInFormationWaitingList(released.sessionId);
    notify.catch((error) => console.error("[cancelAndRefund] waiting-list notification failed", error));
  }

  // Deliberately still called here. Every leg is outstanding at this point,
  // so it is a no-op — but it is the same call the webhook and the manual
  // confirmation make, and having exactly one notification path means there
  // is no second place for the "tell the customer" rule to drift.
  await notifyRefundComplete({ prisma, operationId: operation.id }).catch((error) =>
    console.error("[cancelAndRefund] notification failed", error),
  );

  refreshOperationViews();

  const parts = [];
  if (resumed) parts.push("Opération déjà en cours reprise (aucun second remboursement créé).");
  else if (released.keptHistoricalStatus) parts.push("Statut historique conservé, correction financière enregistrée.");
  else if (released.cancelled) parts.push("Élément annulé.");

  // Never "remboursé" — nothing has been. The wording has to leave an admin
  // in no doubt that the money is still theirs to move.
  if (plan.automaticTotal > 0) {
    parts.push(
      `${plan.automaticTotal.toFixed(2)} € à rembourser dans Stripe (montant exact — ne pas rembourser le total de la facture).`,
    );
  }
  if (plan.manualTotal > 0) {
    parts.push(`${plan.manualTotal.toFixed(2)} € à rendre en main propre, puis à confirmer.`);
  }
  parts.push("Le client sera informé une fois tout confirmé.");

  return {
    success: true,
    message: parts.join(" "),
    data: {
      operationId: operation.id,
      awaitingStripeRefund: plan.automaticTotal > 0,
      requiresManualConfirmation: plan.requiresManualConfirmation,
    },
  };
}

/**
 * Confirms a CASH or CARD leg — the money the application cannot move
 * itself. Only here does such a leg become SUCCEEDED and produce its REFUND
 * ledger row.
 */
export async function confirmManualRefundLeg({ legId, terminalReference = null, cashHandedOver = false }) {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Non autorisé." };
  if (typeof legId !== "string" || !legId) return { success: false, message: "Remboursement introuvable." };

  const result = await settleRefundLeg({
    prisma,
    legId,
    manual: {
      confirmedByUserId: session.user.id,
      terminalReference,
      cashHandedOver,
    },
  });

  if (!result.settled) {
    const messages = {
      LEG_NOT_FOUND: "Remboursement introuvable.",
      ALREADY_SETTLED: "Ce remboursement est déjà confirmé.",
      TERMINAL_REFERENCE_REQUIRED: "La référence du ticket du terminal est obligatoire.",
      CASH_HANDOVER_NOT_CONFIRMED: "Confirmez que les espèces ont bien été remises au client.",
    };
    return { success: false, message: messages[result.reason] ?? "Confirmation impossible." };
  }

  // Now that this leg has landed, the operation may be complete. If a Stripe
  // leg is still outstanding this stays silent — the customer is told once,
  // at the end, never per leg.
  const notified = await notifyRefundComplete({ prisma, operationId: result.operationId }).catch((error) => {
    console.error("[confirmManualRefundLeg] notification failed", error);
    return { sent: false };
  });

  refreshOperationViews();

  return {
    success: true,
    message:
      result.operationStatus === "COMPLETED"
        ? notified?.sent
          ? "Remboursement confirmé et client informé."
          : "Remboursement confirmé."
        : "Remboursement partiel confirmé — il reste des parties à confirmer.",
    data: { operationStatus: result.operationStatus },
  };
}

/**
 * Issues the accounting document for a refund that ALREADY happened.
 *
 * This is the narrow, legitimate survivor of the old
 * `issueCreditNoteForTransaction`. The handoff kills the isolated credit
 * note — "le bouton ne doit plus pouvoir créer une note de crédit isolée
 * sans annulation ni remboursement" — but it also names this exact case as
 * one that must stay reachable: "déjà annulé et totalement remboursé :
 * compléter uniquement le document manquant".
 *
 * The difference from the old action is the direction of proof. The old one
 * asked only "does an invoice exist?" and then issued a note against it,
 * which is how a payment could end up credited without a euro having moved.
 * This one refuses unless a REFUND transaction is already on the ledger, and
 * credits at most what that refund actually returned.
 */
export async function issueMissingRefundDocument(transactionId) {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Non autorisé." };
  if (typeof transactionId !== "string" || !transactionId) {
    return { success: false, message: "Transaction introuvable." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
        select: {
          id: true,
          amount: true,
          transactionType: true,
          isDeleted: true,
          creditNoteId: true,
          paymentId: true,
        },
      });
      if (!transaction || transaction.isDeleted) throw new Error("TRANSACTION_NOT_FOUND");
      // The whole guard: a document may only be produced for money that has
      // demonstrably already gone back.
      if (transaction.transactionType !== "REFUND") throw new Error("NOT_A_REFUND");
      if (transaction.creditNoteId) throw new Error("ALREADY_DOCUMENTED");

      const context = await loadRefundContext(tx, transaction.paymentId);
      if (!context?.invoice) throw new Error("NO_INVOICE");

      // Lock the invoice: two refund rows on one payment must not each
      // issue a note concurrently and over-credit it between them.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${context.invoice.id} FOR UPDATE`;

      const state = planRefund({ transactions: context.transactions, invoice: context.invoice });
      if (state.inconsistencies.length > 0) throw new Error("LEDGER_INCONSISTENT");

      const creditable = Math.min(Number(transaction.amount), state.remainingCreditable ?? 0);
      if (!(creditable > 0)) throw new Error("NOTHING_LEFT_TO_CREDIT");

      const note = await issueCreditNote(tx, {
        invoiceId: context.invoice.id,
        reason: "Document de correction émis pour un remboursement déjà effectué",
        totalInclVat: creditable,
      });
      await tx.transaction.update({ where: { id: transaction.id }, data: { creditNoteId: note.id } });

      await tx.auditLog.create({
        data: {
          actorId: session.user.id,
          actorRole: session.user.role,
          action: "refund.missing_document_issued",
          entityType: "CreditNote",
          entityId: note.id,
          metadata: { transactionId, paymentId: transaction.paymentId, amount: creditable, number: note.number },
        },
      });

      return note;
    });

    refreshOperationViews();
    return {
      success: true,
      message: `Note de crédit ${result.number} émise pour ce remboursement déjà effectué.`,
      data: { creditNoteId: result.id, number: result.number },
    };
  } catch (error) {
    const messages = {
      TRANSACTION_NOT_FOUND: "Transaction introuvable.",
      NOT_A_REFUND:
        "Aucun remboursement n'a été enregistré pour cette transaction — utilisez « Annuler et rembourser » plutôt que d'émettre un document seul.",
      ALREADY_DOCUMENTED: "Ce remboursement possède déjà sa note de crédit.",
      NO_INVOICE: "Aucune facture n'est associée à ce paiement — un client B2C reçoit un justificatif, pas une note de crédit.",
      LEDGER_INCONSISTENT: "Les montants de ce paiement sont incohérents — réconciliation requise.",
      NOTHING_LEFT_TO_CREDIT: "Cette facture est déjà entièrement créditée.",
      CREDIT_NOTE_EXCEEDS_INVOICE: "Le montant dépasse ce qui reste créditable sur cette facture.",
    };
    if (messages[error.message]) return { success: false, message: messages[error.message] };
    console.error("[issueMissingRefundDocument]", error);
    return { success: false, message: "Impossible d'émettre la note de crédit." };
  }
}

/**
 * Every refund still owed to a customer — the Operations screen's standing
 * worklist.
 *
 * Since the application moves no money, this list IS the mechanism. A leg
 * only leaves it when the money has demonstrably gone back: an ONLINE leg
 * when Stripe's charge.refunded webhook arrives, a CASH/CARD leg when an
 * admin attests to the hand-over. Nothing on this screen can be dismissed
 * without one of those actually happening, which is what keeps a cancelled
 * booking with an issued credit note from quietly becoming a refund nobody
 * ever made.
 *
 * FAILED legs are included deliberately: a Stripe refund that errored is
 * still money owed, and hiding it until someone thinks to look at a
 * different screen is how it gets forgotten.
 */
export async function getOutstandingRefundLegs() {
  const session = await requireAdmin();
  if (!session) return { success: false, message: "Non autorisé.", data: [] };

  const legs = await prisma.refundLeg.findMany({
    where: { status: { in: ["PENDING", "MANUAL_CONFIRMATION_REQUIRED", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    include: {
      // The original payment the admin has to find in Stripe. Selected here
      // rather than derived in the component so the panel can print the
      // exact payment_intent instead of asking someone to go hunting.
      sourceTransaction: { select: { stripePaymentIntentId: true, stripeCheckoutSessionId: true, paidAt: true } },
      refundOperation: {
        select: {
          id: true,
          reason: true,
          source: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          creditNote: { select: { number: true } },
          refundReceiptNumber: true,
        },
      },
    },
  });

  return { success: true, data: serializeDecimalFields(legs) };
}
