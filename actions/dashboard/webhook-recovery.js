"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";
import { retryRefundReconciliationForPayment } from "@/lib/payments/retry-failed-refunds";
import { reconcileMissedRefunds } from "@/lib/payments/reconcile-missed-refunds";
import { captureError, captureCriticalError } from "@/lib/monitoring";

const RECONCILIATION_PATH = "/dashboard/payments/reconciliation";

async function requireReconciliationAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.PAYMENT_RECONCILIATION)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

const STUCK_PAYMENT_INCLUDE = {
  order: { select: { orderNumber: true, user: { select: { fullName: true, email: true } } } },
  appointment: { select: { date: true, user: { select: { fullName: true, email: true } } } },
  workshopReservation: {
    select: { session: { select: { workshop: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } },
  },
  formationReservation: {
    select: { session: { select: { formation: { select: { title: true } } } }, customer: { select: { fullName: true, email: true } } },
  },
  transactions: { where: { transactionType: "REFUND" }, select: { amount: true } },
};

function serializeStuckPayment(payment) {
  const alreadyRefunded = payment.transactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const remainingToRefund = Math.max(0, Number(payment.paidAmount) - alreadyRefunded);

  let type = "Paiement";
  let reference = payment.id;
  let customerName = null;
  let customerEmail = null;

  if (payment.order) {
    type = "Commande";
    reference = `n°${payment.order.orderNumber}`;
    customerName = payment.order.user?.fullName ?? null;
    customerEmail = payment.order.user?.email ?? null;
  } else if (payment.appointment) {
    type = "Rendez-vous";
    reference = payment.appointment.date ? new Date(payment.appointment.date).toLocaleDateString("fr-FR") : "—";
    customerName = payment.appointment.user?.fullName ?? null;
    customerEmail = payment.appointment.user?.email ?? null;
  } else if (payment.workshopReservation) {
    type = "Atelier";
    reference = payment.workshopReservation.session?.workshop?.title ?? "—";
    customerName = payment.workshopReservation.customer?.fullName ?? null;
    customerEmail = payment.workshopReservation.customer?.email ?? null;
  } else if (payment.formationReservation) {
    type = "Formation";
    reference = payment.formationReservation.session?.formation?.title ?? "—";
    customerName = payment.formationReservation.customer?.fullName ?? null;
    customerEmail = payment.formationReservation.customer?.email ?? null;
  }

  return {
    id: payment.id,
    type,
    reference,
    customerName,
    customerEmail,
    paidAmount: Number(payment.paidAmount),
    remainingToRefund,
    status: payment.status,
    refundRetryCount: payment.refundRetryCount,
    refundFailureReason: payment.refundFailureReason,
    refundAttemptedAt: payment.refundAttemptedAt,
    hasTransactionReference: !!payment.transactionReference,
  };
}

/**
 * Dashboard "Réconciliation" list — every Payment stuck in REFUND_PENDING
 * (a refund was decided but the Stripe call was interrupted before
 * confirming) or REFUND_FAILED (the Stripe call itself errored). Both
 * states are also picked up automatically by the /api/cron sweep
 * (lib/payments/retry-failed-refunds.js) up to MAX_RETRIES — this page is
 * the "never rely on someone noticing logs" backstop: a durable, visible
 * queue an admin can act on directly instead of digging through Sentry/logs.
 */
export async function listStuckPayments() {
  const guard = await requireReconciliationAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const payments = await prisma.payment.findMany({
      where: { status: { in: ["REFUND_PENDING", "REFUND_FAILED"] } },
      include: STUCK_PAYMENT_INCLUDE,
      orderBy: [{ refundAttemptedAt: "desc" }, { paidAt: "desc" }],
    });

    return { success: true, data: payments.map(serializeStuckPayment) };
  } catch (error) {
    captureError(error, { area: "refund-reconciliation", context: "listStuckPayments" });
    return { success: false, message: "Impossible de charger les paiements en attente de réconciliation.", data: [] };
  }
}

/**
 * Per-row "Réessayer" action — safe to click repeatedly: re-checks the
 * payment's current status and Stripe refund state itself before doing
 * anything (see retryRefundReconciliationForPayment), so a stale row or a
 * double-click can't double-refund.
 */
export async function retryStuckPayment({ paymentId }) {
  const guard = await requireReconciliationAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!paymentId) return { success: false, message: "Paiement manquant." };

  const result = await retryRefundReconciliationForPayment(paymentId);
  revalidatePath(RECONCILIATION_PATH);
  return result;
}

/**
 * Top-of-page "Rechercher les webhooks manqués" action — manually triggers
 * the same 72h Stripe-refunds-list scan the cron job runs on a schedule
 * (lib/payments/reconcile-missed-refunds.js), for when staff want to check
 * right now rather than wait for the next scheduled run. Idempotent/safe to
 * run repeatedly — a no-op whenever nothing was actually missed.
 */
export async function runMissedRefundsScan() {
  const guard = await requireReconciliationAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const result = await reconcileMissedRefunds();
    revalidatePath(RECONCILIATION_PATH);

    if (result.failures.length > 0) {
      return {
        success: true,
        message: `${result.reconciled} remboursement(s) manqué(s) récupéré(s) sur ${result.checked} vérifié(s) — ${result.failures.length} échec(s) (voir le suivi d'erreurs pour le détail).`,
      };
    }
    return {
      success: true,
      message:
        result.reconciled > 0
          ? `${result.reconciled} remboursement(s) manqué(s) récupéré(s) sur ${result.checked} vérifié(s).`
          : `Aucun remboursement manqué détecté (${result.checked} vérifié(s)).`,
    };
  } catch (error) {
    captureCriticalError(error, { area: "refund-reconciliation", context: "runMissedRefundsScan" });
    return { success: false, message: "Le scan des remboursements manqués a échoué." };
  }
}
