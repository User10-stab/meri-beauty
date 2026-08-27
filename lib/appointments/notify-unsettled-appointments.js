import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

/**
 * For the /api/cron job runner, not called from the UI. Deliberately kept
 * out of any "use server" module — every export from a "use server" file is
 * a public, unauthenticated POST endpoint (see lib/payments/retry-failed-refunds.js
 * for the same note).
 *
 * No job ever auto-completes a CONFIRMED appointment whose time has passed —
 * completion needs a human to confirm how the balance was actually settled
 * (cash, card terminal, or already paid online). This job only surfaces
 * what's been sitting unsettled, in a daily digest, so staff don't forget
 * and an appointment doesn't stay indefinitely cancellable-with-refund.
 */
const STALE_HOURS = 24;

// Keeps the digest genuinely daily regardless of how often the job runner
// ticks (every 5min in-process via lib/background-jobs.js, plus whatever
// external HTTP cron cadence is configured).
const DIGEST_MIN_INTERVAL_HOURS = 20;

export async function notifyUnsettledAppointments() {
  const now = new Date();
  const digestCutoff = new Date(now.getTime() - DIGEST_MIN_INTERVAL_HOURS * 60 * 60 * 1000);

  // Atomic claim — without it, the in-process interval and an
  // externally-triggered HTTP cron firing around the same moment could both
  // pass a plain read-then-check and both send the same digest.
  const claim = await prisma.salon.updateMany({
    where: {
      id: "main-salon",
      OR: [{ unsettledAppointmentsDigestSentAt: null }, { unsettledAppointmentsDigestSentAt: { lt: digestCutoff } }],
    },
    data: { unsettledAppointmentsDigestSentAt: now },
  });
  if (claim.count === 0) {
    return { staleCount: 0, emailSent: false, skipped: "not due yet" };
  }

  const staleCutoff = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000);
  const stale = await prisma.appointment.findMany({
    where: { status: "CONFIRMED", isDeleted: false, endTime: { lt: staleCutoff } },
    include: {
      user: { select: { fullName: true } },
      staffService: {
        include: {
          service: { select: { name: true } },
          staff: { include: { user: { select: { fullName: true, email: true } } } },
        },
      },
    },
    orderBy: { endTime: "asc" },
    take: 200, // a runaway digest email helps no one; cap it defensively
  });

  if (stale.length === 0) {
    return { staleCount: 0, emailSent: false };
  }

  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
  if (!salon?.email) {
    return { staleCount: stale.length, emailSent: false };
  }

  const describe = (appt) => {
    const dateStr = appt.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" });
    const serviceName = appt.staffService?.service?.name ?? "—";
    const staffName = appt.staffService?.staff?.user?.fullName ?? "—";
    const staffEmail = appt.staffService?.staff?.user?.email ?? "—";
    const customerName = appt.user?.fullName ?? "—";
    return { dateStr, serviceName, staffName, staffEmail, customerName };
  };

  const text =
    `${stale.length} rendez-vous confirmé(s) sont passés depuis plus de ${STALE_HOURS}h sans être soldés (ni terminé, ni annulé) :\n\n` +
    stale.map((appt) => {
      const { dateStr, serviceName, staffName, customerName } = describe(appt);
      return `- ${dateStr} — ${customerName} — ${serviceName} (${staffName})`;
    }).join("\n") +
    `\n\nOuvrez le calendrier pour les clôturer (Terminer, ou Marquer absente si le client n'est pas venu).`;

  const html =
    `<p>${stale.length} rendez-vous confirmé(s) sont passés depuis plus de ${STALE_HOURS}h sans être soldés (ni terminé, ni annulé) :</p>` +
    `<ul>${stale.map((appt) => {
      const { dateStr, serviceName, staffName, customerName } = describe(appt);
      return `<li>${dateStr} — ${customerName} — ${serviceName} (${staffName})</li>`;
    }).join("")}</ul>` +
    `<p>Ouvrez le calendrier pour les clôturer (Terminer, ou Marquer absente si le client n'est pas venu).</p>`;

  // Salon inbox, not a per-staff address: this is ONE digest listing every
  // unsettled appointment across all staff, so there is no single staff
  // recipient it could belong to. (A per-staff digest would mean grouping
  // `stale` by staffId and sending one email each — a different feature.)
  const result = await sendEmail({
    to: salon.email,
    subject: `${stale.length} rendez-vous à clôturer — Meri Beauty`,
    text,
    html,
  });

  return { staleCount: stale.length, emailSent: Boolean(result?.success) };
}
