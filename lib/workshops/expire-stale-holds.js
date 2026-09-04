import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { confirmWorkshopReservationPayment } from "@/lib/workshops/fulfill-workshop-reservation-payment";

/**
 * For the /api/cron job runner, not called from the UI: cancels abandoned
 * PENDING_DEPOSIT workshop reservation holds once holdExpiresAt has passed.
 *
 * Not a seat-leak fix — checkWorkshopSessionAvailability already excludes
 * expired holds from its capacity count live, so nothing was ever
 * oversold. This is pure data hygiene: without it, abandoned holds just
 * accumulate in the dashboard/reporting forever instead of reflecting that
 * the customer never actually paid.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-cancels reservations and emails customers on each call.
 */
export async function expireStaleWorkshopHolds() {
  const now = new Date();

  const stale = await prisma.workshopReservation.findMany({
    where: { status: "PENDING_DEPOSIT", holdExpiresAt: { lt: now } },
    select: {
      id: true,
      customer: { select: { fullName: true, email: true } },
      session: { select: { workshop: { select: { title: true } } } },
      payment: { select: { transactionReference: true } },
    },
  });

  let expiredCount = 0;

  for (const reservation of stale) {
    if (reservation.payment?.transactionReference) {
      try {
        const stripeSession = await stripe.checkout.sessions.retrieve(reservation.payment.transactionReference);
        if (stripeSession.payment_status === "paid") {
          await confirmWorkshopReservationPayment(stripeSession);
          continue;
        }
        if (stripeSession.status === "open") await stripe.checkout.sessions.expire(stripeSession.id);
      } catch (error) {
        // Keep the hold while Stripe cannot prove that its hosted checkout
        // is inert; otherwise a late card payment becomes unfulfillable.
        console.error("[expireStaleWorkshopHolds] Stripe session check failed, deferring expiry:", reservation.id, error);
        continue;
      }
    }

    // Atomic claim gated on the status read above — if the customer paid
    // (or the reservation was cancelled some other way) between the
    // findMany and here, this affects zero rows and the email below is
    // skipped, so a last-second payment never gets a false "expired" email.
    const claim = await prisma.workshopReservation.updateMany({
      where: { id: reservation.id, status: "PENDING_DEPOSIT" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (claim.count === 0) continue;

    sendEmail({
      to: reservation.customer.email,
      subject: `Réservation expirée – ${reservation.session.workshop.title} – Meri Beauty`,
      text:
        `Bonjour ${reservation.customer.fullName},\n\n` +
        `Votre réservation pour l'atelier "${reservation.session.workshop.title}" a expiré faute de paiement dans le délai imparti. ` +
        `Vous pouvez réserver à nouveau à tout moment si des places sont encore disponibles.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${reservation.customer.fullName},</p>` +
        `<p>Votre réservation pour l'atelier "${reservation.session.workshop.title}" a expiré faute de paiement dans le délai imparti. ` +
        `Vous pouvez réserver à nouveau à tout moment si des places sont encore disponibles.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[expireStaleWorkshopHolds] email failed:", err));

    expiredCount += 1;
  }

  return { success: true, expiredCount };
}
