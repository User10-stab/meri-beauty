import { customSessionWindows, formatSessionDateRange } from "@/lib/formations/custom-date-availability";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationReservationReminderEmail } from "@/lib/email-templates";

/**
 * For the /api/cron job runner, not called from the UI. Deliberately kept
 * out of any "use server" module — every export from a "use server" file is
 * a public, unauthenticated POST endpoint, and this mass-emails every
 * customer with an upcoming reservation on each call.
 *
 * One reminder per journée (2026-10-09). Until then a formation got a single
 * reminder, the day before its first day — but its journées no longer have
 * to follow each other (lib/formations/custom-date-availability.js), and a
 * third journée ten days after the second was never announced. Each journée
 * is now reminded the day before it, on its own.
 */
const REMINDER_HOURS_BEFORE = 24;
const REMINDER_WINDOW_MS = REMINDER_HOURS_BEFORE * 60 * 60 * 1000;
/** No session runs longer than this from its first day to its last. */
const LONGEST_SESSION_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * The journée of this session due a reminder now: it starts within the next
 * 24 h and has not been reminded yet. The reservation keeps a single
 * `reminderSentAt`; a reminder for a journée is necessarily sent in the 24 h
 * before it, so a marker older than that belongs to an earlier journée.
 *
 * @param {object} params
 * @param {{ startDate: Date, endDate: Date|null, customDateKeys?: string[] }} params.session
 * @param {Date|null} params.reminderSentAt
 * @param {Date} [params.now]
 * @returns {{ number: number, count: number, start: Date, end: Date } | null}
 */
export function journeeToRemind({ session, reminderSentAt, now = new Date() }) {
  const days = customSessionWindows(session);
  // A session that merely runs past midnight is one sitting, not two journées.
  const windows = days.length > 1 && days.some((day) => day.end <= day.start) ? days.slice(0, 1) : days;
  for (let index = 0; index < windows.length; index += 1) {
    const { start, end } = windows[index];
    const opens = start.getTime() - REMINDER_WINDOW_MS;
    if (start.getTime() <= now.getTime() || opens > now.getTime()) continue;
    if (reminderSentAt && new Date(reminderSentAt).getTime() > opens) return null;
    return { number: index + 1, count: windows.length, start, end };
  }
  return null;
}

export async function sendFormationReservationReminders() {
  const now = new Date();
  const cutoff = new Date(now.getTime() + REMINDER_WINDOW_MS);

  const reservations = await prisma.formationReservation.findMany({
    where: {
      status: "CONFIRMED",
      // Started or not: a later journée of a session already begun is still
      // ahead. journeeToRemind decides which reservations are due.
      session: {
        startDate: { lte: cutoff, gt: new Date(now.getTime() - LONGEST_SESSION_MS) },
        OR: [{ endDate: { gt: now } }, { endDate: null, startDate: { gt: now } }],
      },
    },
    include: {
      customer: { select: { fullName: true, email: true } },
      session: { select: { startDate: true, endDate: true, customDateKeys: true, formation: { select: { title: true } } } },
    },
  });

  let sentCount = 0;

  for (const reservation of reservations) {
    const journee = journeeToRemind({ session: reservation.session, reminderSentAt: reservation.reminderSentAt, now });
    if (!journee) continue;

    // A formation over several days names all of them, not just the first.
    const range = formatSessionDateRange(reservation.session);
    const sessionDate = range.multiDay ? `${range.days} (${range.hours})` : reservation.session.startDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Brussels",
    });

    // Atomic claim, gated on the marker still being the one read above — a
    // plain update() here let two job runners (the in-process interval in
    // lib/background-jobs.js, an HTTP-triggered /api/cron hit, or simply a
    // second `next dev` process on the same shared database) both read this
    // reservation as unsent in the findMany above and both e-mail the
    // customer. Mirrors sendAppointmentReminders, which already claims.
    const claim = await prisma.formationReservation.updateMany({
      where: { id: reservation.id, reminderSentAt: reservation.reminderSentAt },
      data: { reminderSentAt: now },
    });
    if (claim.count === 0) continue;

    sendEmail({
      to: reservation.customer.email,
      ...formationReservationReminderEmail({
        customerName: reservation.customer.fullName,
        formationTitle: reservation.session.formation.title,
        sessionDate,
        journee: journee.count > 1 ? { number: journee.number, count: journee.count, date: journeeLabel(journee) } : null,
      }),
    }).catch((err) => console.error("[sendFormationReservationReminders] email failed:", err));

    sentCount += 1;
  }

  return { success: true, sentCount };
}

/** "vendredi 27 novembre 2026, 10:00 – 17:00" */
function journeeLabel({ start, end }) {
  const day = start.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
  const time = (value) => value.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return end > start ? `${day}, ${time(start)} – ${time(end)}` : `${day}, ${time(start)}`;
}
