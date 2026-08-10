import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";

const REFUND_EPSILON = 0.01;

// After this many failed attempts, stop auto-retrying and escalate to staff
// for manual handling in the Stripe dashboard instead — an unbounded retry
// loop on a permanently-broken card/account would just spam Stripe forever.
const MAX_RETRIES = 5;

function describePayment(payment) {
  if (payment.order) return `commande n°${payment.order.orderNumber}`;
  if (payment.appointment) return `rendez-vous du ${payment.appointment.date.toLocaleDateString("fr-FR")}`;
  if (payment.workshopReservation) return `réservation atelier "${payment.workshopReservation.session.workshop.title}"`;
  if (payment.formationReservation) return `réservation formation "${payment.formationReservation.session.formation.title}"`;
  return `paiement ${payment.id}`;
}

function customerEmail(payment) {
  return (
    payment.order?.user?.email ||
    payment.appointment?.user?.email ||
    payment.workshopReservation?.customer?.email ||
    payment.formationReservation?.customer?.email ||
    null
  );
}

/**
 * For the /api/cron job runner, not called from the UI: retries every
 * Payment stuck in REFUND_PENDING (a refund attempt was interrupted, e.g.
 * by a server restart, before the synchronous try/catch that normally
 * records the outcome ever ran) or REFUND_FAILED (the Stripe call itself
 * errored). Only ever redoes the money movement — the cancellation itself
 * (stock restock, reservation status, waiting-list notify, credit note)
 * already happened synchronously at cancel time in every caller
 * (actions/boutique/orders.js, actions/appointment/manage-appointment.js,
 * actions/workshops/manage-reservation.js), decoupled from whether the
 * Stripe call succeeds — so there is nothing left to redo here except the
 * refund + its Payment/Transaction bookkeeping.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * moves real money via Stripe on each call.
 */
export async function retryFailedRefunds() {
  const stuck = await prisma.payment.findMany({
    where: { status: { in: ["REFUND_PENDING", "REFUND_FAILED"] }, refundRetryCount: { lt: MAX_RETRIES } },
    include: {
      order: { select: { orderNumber: true, user: { select: { email: true, fullName: true } } } },
      appointment: { select: { date: true, user: { select: { email: true, fullName: true } } } },
      workshopReservation: {
        select: { session: { select: { workshop: { select: { title: true } } } }, customer: { select: { email: true, fullName: true } } },
      },
      formationReservation: {
        select: { session: { select: { formation: { select: { title: true } } } }, customer: { select: { email: true, fullName: true } } },
      },
    },
  });

  let retried = 0;
  let succeeded = 0;
  let exhausted = 0;

  for (const payment of stuck) {
    if (!payment.transactionReference) continue;

    try {
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      const remaining = Number(payment.paidAmount) - alreadyRefunded;
      if (remaining <= REFUND_EPSILON) {
        // Already fully refunded by some other path (e.g. reconciliation) —
        // nothing left to retry, just clear the stuck state.
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
        continue;
      }

      retried += 1;
      const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
      if (!stripeSession.payment_intent) continue;

      await stripe.refunds.create({ payment_intent: stripeSession.payment_intent, amount: Math.round(remaining * 100) });

      const fullyRefunded = remaining + REFUND_EPSILON >= Number(payment.paidAmount);
      await prisma.$transaction([
        prisma.transaction.create({
          data: { paymentId: payment.id, amount: remaining, method: "ONLINE", transactionType: "REFUND", paidAt: new Date() },
        }),
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
            refundAttemptedAt: new Date(),
          },
        }),
      ]);
      succeeded += 1;
    } catch (err) {
      console.error("[retryFailedRefunds] retry failed for payment", payment.id, err);
      const nextRetryCount = payment.refundRetryCount + 1;
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "REFUND_FAILED",
          refundFailureReason: err?.message?.slice(0, 500) ?? "Erreur inconnue",
          refundAttemptedAt: new Date(),
          refundRetryCount: nextRetryCount,
        },
      });

      if (nextRetryCount >= MAX_RETRIES) {
        exhausted += 1;
        const salon = await prisma.salon.findFirst({ select: { email: true } });
        if (salon?.email) {
          const label = describePayment(payment);
          const email = customerEmail(payment);
          sendEmail({
            to: salon.email,
            subject: `⚠️ Remboursement Stripe toujours en échec après ${nextRetryCount} tentatives – ${label}`,
            text: `Le remboursement Stripe pour ${label}${email ? ` (client : ${email})` : ""} a échoué ${nextRetryCount} fois. Traitement manuel requis dans le dashboard Stripe — les nouvelles tentatives automatiques sont arrêtées pour ce paiement.`,
            html: `<p>Le remboursement Stripe pour ${label}${email ? ` (client : ${email})` : ""} a échoué ${nextRetryCount} fois. Traitement manuel requis dans le dashboard Stripe — les nouvelles tentatives automatiques sont arrêtées pour ce paiement.</p>`,
          }).catch((alertErr) => console.error("[retryFailedRefunds] exhausted-retry alert email failed:", alertErr));
        }
      }
    }
  }

  return { success: true, retried, succeeded, exhausted };
}
