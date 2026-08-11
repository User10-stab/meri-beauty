import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

/**
 * For the /api/cron job runner, not called from the UI: cancels abandoned
 * PENDING_DEPOSIT formation reservation holds once holdExpiresAt has
 * passed. Mirrors lib/workshops/expire-stale-holds.js exactly — same
 * reasoning (pure data hygiene, not a seat-leak fix; capacity is already
 * computed live excluding expired holds).
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-cancels reservations and emails customers on each call.
 */
export async function expireStaleFormationHolds() {
  const now = new Date();

  const stale = await prisma.formationReservation.findMany({
    where: { status: "PENDING_DEPOSIT", holdExpiresAt: { lt: now } },
    select: {
      id: true,
      customer: { select: { fullName: true, email: true } },
      session: { select: { formation: { select: { title: true } } } },
    },
  });

  let expiredCount = 0;

  for (const reservation of stale) {
    // Atomic claim gated on the status read above — if the customer paid
    // (or the reservation was cancelled some other way) between the
    // findMany and here, this affects zero rows and the email below is
    // skipped, so a last-second payment never gets a false "expired" email.
    const claim = await prisma.formationReservation.updateMany({
      where: { id: reservation.id, status: "PENDING_DEPOSIT" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    if (claim.count === 0) continue;

    sendEmail({
      to: reservation.customer.email,
      subject: `Réservation expirée – ${reservation.session.formation.title} – Meri Beauty`,
      text:
        `Bonjour ${reservation.customer.fullName},\n\n` +
        `Votre réservation pour la formation "${reservation.session.formation.title}" a expiré faute de paiement dans le délai imparti. ` +
        `Vous pouvez réserver à nouveau à tout moment si des places sont encore disponibles.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${reservation.customer.fullName},</p>` +
        `<p>Votre réservation pour la formation "${reservation.session.formation.title}" a expiré faute de paiement dans le délai imparti. ` +
        `Vous pouvez réserver à nouveau à tout moment si des places sont encore disponibles.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[expireStaleFormationHolds] email failed:", err));

    expiredCount += 1;
  }

  return { success: true, expiredCount };
}
