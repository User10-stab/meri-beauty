import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { issueCreditNote } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import {
  createNotificationsBulk,
  buildAppointmentCancelledNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";

// Matches rejectAppointment's own STALE_CANCELLATION_GUARD_DAYS = 7
// (actions/appointment/manage-appointment.js) — this codebase's established
// convention for "how long is too long to leave something unattended".
const STALE_PENDING_APPOINTMENT_DAYS = 7;

const CANCELLATION_REASON = "Demande non traitée — expirée automatiquement après 7 jours";

/**
 * For the /api/cron job runner, not called from the UI: cancels PENDING
 * appointment requests staff never accepted or rejected (bug H7).
 *
 * ACTIVE_APPOINTMENT_STATUSES (lib/appointment-status.js) includes PENDING —
 * by design, since a manual-confirmation request does occupy the slot while
 * awaiting staff review. But unlike workshop/formation holds (a hard
 * holdExpiresAt + lib/workshops/expire-stale-holds.js /
 * lib/formations/expire-stale-holds.js) or boutique orders
 * (lib/orders/expire-stale-orders.js), nothing ever released a PENDING
 * appointment. If staff never opened the dashboard, the requested slot
 * stayed permanently unbookable by anyone else, forever.
 *
 * Qualifies: still PENDING (staff never acted — ACCEPTED/CONFIRMED/etc are
 * never touched) AND either createdAt is older than
 * STALE_PENDING_APPOINTMENT_DAYS days, or startTime has already passed (the
 * requested slot is moot either way, even for a request made minutes ago for
 * a time that's already gone).
 *
 * Refund safety: in this codebase's actual booking flow a PENDING
 * appointment can never carry a captured (PAID/PARTIALLY_PAID) payment.
 * createCheckoutSession (actions/payment/createCheckoutSession.js) refuses
 * to run at all when requiresOnlinePaymentNow is false, which
 * getReservationPaymentDecision (lib/reservation-payment.js) always returns
 * for MANUAL confirmation mode — the only mode whose appointments start out
 * PENDING with no Payment row. And once a payment *does* clear, the Stripe
 * webhook (app/api/webhooks/stripe/route.js, nextAppointmentStatus) always
 * promotes the appointment straight to CONFIRMED — for AUTOMATIC mode
 * unconditionally, and for MANUAL mode the moment staff has moved it to
 * ACCEPTED (the only way to reach the payment step at all). So this refund
 * branch is defensive-only today, not load-bearing — kept anyway, mirroring
 * rejectAppointment's exact wasPaid / remaining / queueManualRefund pattern,
 * so a future change to that invariant (or a manually-edited row) can never
 * silently expire a paid appointment with no refund, reproducing this exact
 * codebase's B7 bug elsewhere. Confirmed policy (2026-09-02): the
 * application never issues a Stripe refund itself, so what "recorded" means
 * here is a RefundOperation an admin still has to act on, not a completed
 * Stripe call.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-cancels appointments on each call.
 */
export async function expireStalePendingAppointments() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_PENDING_APPOINTMENT_DAYS * 24 * 60 * 60 * 1000);
  const REFUND_EPSILON = 0.01;

  const stale = await prisma.appointment.findMany({
    where: {
      status: "PENDING",
      isDeleted: false,
      OR: [{ createdAt: { lt: cutoff } }, { startTime: { lt: now } }],
    },
    include: {
      user: { select: { fullName: true, email: true, isCompany: true, vatNumber: true } },
      staffService: { include: { service: { select: { name: true } } } },
      payment: { include: { transactions: true, invoice: true } },
    },
  });

  let expiredCount = 0;

  for (const appointment of stale) {
    try {
      const payment = appointment.payment;
      const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

      // Cap against what's actually still outstanding, same reasoning as
      // rejectAppointment — a prior partial refund must never be double-counted.
      let remaining = 0;
      if (wasPaid) {
        const priorRefunds = await prisma.transaction.aggregate({
          where: { paymentId: payment.id, transactionType: "REFUND" },
          _sum: { amount: true },
        });
        const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
        remaining = Number(payment.paidAmount) - alreadyRefunded;
      }

      // Note this no longer requires payment.transactionReference, matching
      // the same fix applied to every other converted cancellation path.
      const needsRefund = wasPaid && remaining > REFUND_EPSILON;

      // Atomic claim gated on the status read above — if staff accepted or
      // rejected this appointment between the findMany and here, this
      // affects zero rows and nothing below runs.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.appointment.updateMany({
          where: { id: appointment.id, status: "PENDING" },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancellationReason: CANCELLATION_REASON,
            cancellationSource: "SYSTEM",
          },
        });
        if (claim.count === 0) return false;

        // Confirmed policy (2026-09-02): the application never issues a
        // Stripe refund itself. This records what is owed as a
        // RefundOperation an OWNER/ADMIN still has to act on — see
        // rejectAppointment's identical comment for the full reasoning.
        let refundQueued = false;
        if (needsRefund) {
          let creditNote = null;
          if (payment.invoice) {
            creditNote = await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: CANCELLATION_REASON,
              totalInclVat: remaining,
            });
          }
          const queued = await queueManualRefund(tx, {
            paymentId: payment.id,
            source: "APPOINTMENT",
            trigger: "SALON_CANCELLATION",
            reason: CANCELLATION_REASON,
            amount: remaining,
            transactions: payment.transactions,
            creditNoteId: creditNote?.id ?? null,
            invoiceId: payment.invoice?.id ?? null,
            customerIsBusiness: isBusinessRefundCustomer(appointment.user),
          });
          refundQueued = Boolean(queued);
        }

        const serviceName = appointment.staffService?.service?.name;
        const customerName = appointment.user?.fullName;
        const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId, { tx });

        if (recipientUserIds.length > 0) {
          await createNotificationsBulk(
            recipientUserIds.map((uid) =>
              buildAppointmentCancelledNotification({
                userId: uid,
                appointmentId: appointment.id,
                date: appointment.date,
                startTime: appointment.startTime,
                serviceName,
                reason: CANCELLATION_REASON,
                customerName,
              })
            ),
            { tx }
          );
        }

        return { claimed: true, refundQueued };
      });

      if (!claimed) continue;

      const refundNote = claimed.refundQueued
        ? " Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
        : "";

      sendEmail({
        to: appointment.user.email,
        subject: "Votre demande de rendez-vous n'a pas pu être traitée – Meri Beauty",
        text:
          `Bonjour ${appointment.user.fullName},\n\n` +
          `Votre demande de rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} n'a pas été traitée par notre équipe dans les délais et a donc été annulée automatiquement.${refundNote} ` +
          `N'hésitez pas à réserver à nouveau si vous le souhaitez.\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${appointment.user.fullName},</p>` +
          `<p>Votre demande de rendez-vous du ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} n'a pas été traitée par notre équipe dans les délais et a donc été annulée automatiquement.${refundNote} ` +
          `N'hésitez pas à réserver à nouveau si vous le souhaitez.</p><p>L'équipe Meri Beauty</p>`,
      }).catch((err) => console.error("[expireStalePendingAppointments] email failed:", err));

      expiredCount += 1;
    } catch (error) {
      console.error("[expireStalePendingAppointments] failed for appointment", appointment.id, error);
    }
  }

  return { success: true, expiredCount };
}
