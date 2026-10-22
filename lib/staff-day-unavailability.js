import { addDaysToDateKey, brusselsDateKey, loadStaffBusyIntervals } from "@/lib/formations/custom-date-availability";
import { parseBrusselsInputValue } from "@/lib/datetime/brussels-input";
import { isDayGivenAway } from "@/lib/working-day-overrides";

/**
 * "Is she free to work then?" for the paths that do not go through the
 * booking availability (lib/slot-availability.js): scheduling a formation or
 * atelier session she animates, recording a walk-in at the till — and, the
 * other way round, "what is already booked on these days?" before a day is
 * taken away from her.
 *
 * Two things make a staff member unavailable here:
 *  - a day on a weekday she works that is not hers (not one of her weeks of
 *    the month, a 5th occurrence assigned to someone else — see
 *    lib/working-day-overrides.js#isDayGivenAway);
 *  - an indisponibilité (TimeOff) overlapping the time.
 *
 * A weekday she never works is NOT a refusal: formations and ateliers are
 * routinely scheduled outside a staff member's usual rendez-vous days.
 *
 * Kept out of any "use server" module — plain query-building.
 */

const MINUTE = 60 * 1000;

export function formatDateKey(dateKey) {
  const [, m, d] = dateKey.split("-");
  return `${d}/${m}`;
}

/** Every Brussels calendar day the interval [start, end) touches. */
function dayKeysOf(start, end) {
  const first = brusselsDateKey(start);
  const last = brusselsDateKey(new Date(Math.max(start.getTime(), end.getTime() - 1)));
  const keys = [first];
  while (keys[keys.length - 1] < last) keys.push(addDaysToDateKey(keys[keys.length - 1], 1));
  return keys;
}

/** The staff member behind an animator: its own link, else the staff account with its e-mail. */
async function staffOfAnimator(db, animatorId) {
  const animator = await db.animator.findUnique({
    where: { id: animatorId },
    select: { staffId: true, email: true },
  });
  if (!animator) return null;
  const select = { id: true, user: { select: { fullName: true } } };
  if (animator.staffId) return db.staff.findUnique({ where: { id: animator.staffId }, select });
  if (!animator.email) return null;
  return db.staff.findFirst({
    where: { isDeleted: false, user: { email: { equals: animator.email, mode: "insensitive" } } },
    select,
  });
}

/** The first of these days that falls on her weekday but is not hers, or null. */
async function firstGivenAwayDay(db, staffId, dateKeys) {
  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: {
      workingHours: { select: { day: true, startTime: true, endTime: true, isClosed: true, weeksOfMonth: true } },
      workingDayOverrides: {
        where: { dateKey: { in: dateKeys } },
        select: { dateKey: true, isWorking: true, startTime: true, endTime: true },
      },
    },
  });
  return dateKeys.find((key) => isDayGivenAway(staff?.workingHours, staff?.workingDayOverrides, key)) ?? null;
}

/**
 * Why this staff member cannot work during [start, end), or null.
 *
 * @param {object} db - Prisma client or transaction client
 * @param {{ staffId: string, staffName?: string|null, start: Date, end: Date }} params
 * @returns {Promise<string|null>} a sentence for the admin, or null when she is free
 */
export async function staffUnavailabilityReason(db, { staffId, staffName, start, end }) {
  const who = staffName || "Ce membre du personnel";

  const givenAway = await firstGivenAwayDay(db, staffId, dayKeysOf(start, end));
  if (givenAway) {
    return `${who} ne travaille pas le ${formatDateKey(givenAway)} : ce n'est pas l'une de ses semaines dans ses horaires de travail.`;
  }

  const timeOff = await db.timeOff.findFirst({
    where: { staffId, startDate: { lt: end }, endDate: { gt: start } },
    orderBy: { startDate: "asc" },
    select: { startDate: true },
  });
  if (timeOff) {
    const day = brusselsDateKey(timeOff.startDate < start ? start : timeOff.startDate);
    return `${who} est indisponible le ${formatDateKey(day)} (indisponibilité enregistrée).`;
  }

  return null;
}

// The sessions a save would (re)schedule, as the instants the animator is
// needed. On an edit only new sessions and those whose date or animator
// changed are read — an untouched session never blocks an unrelated edit.
export function scheduledSessions(sessions, { defaultAnimatorId, existingById = new Map(), existingDefaultAnimatorId = null }) {
  return sessions
    .map((s) => ({
      id: s.id,
      animatorId: s.animatorId || defaultAnimatorId || null,
      startDate: s.startDate ? parseBrusselsInputValue(s.startDate) : null,
      endDate: s.endDate ? parseBrusselsInputValue(s.endDate) : null,
    }))
    .filter((s) => {
      const before = s.id ? existingById.get(s.id) : null;
      if (!before) return true;
      return (
        new Date(before.startDate).getTime() !== s.startDate?.getTime() ||
        (before.endDate ? new Date(before.endDate).getTime() : null) !== (s.endDate?.getTime() ?? null) ||
        (before.animatorId || existingDefaultAnimatorId || null) !== s.animatorId
      );
    });
}

/**
 * The first formation/atelier session whose animator cannot work then.
 *
 * @param {object} db
 * @param {Array<{ animatorId: string|null, startDate: Date, endDate?: Date|null }>} sessions
 * @param {{ durationMinutes: number }} options - a session with no end lasts this long
 * @returns {Promise<string|null>} the refusal message, or null
 */
export async function sessionAnimatorUnavailability(db, sessions, { durationMinutes }) {
  const staffByAnimator = new Map();
  for (const session of sessions) {
    if (!session.animatorId || !session.startDate) continue;
    if (!staffByAnimator.has(session.animatorId)) {
      staffByAnimator.set(session.animatorId, await staffOfAnimator(db, session.animatorId));
    }
    const staff = staffByAnimator.get(session.animatorId);
    if (!staff) continue;

    const start = new Date(session.startDate);
    const end = session.endDate
      ? new Date(session.endDate)
      : new Date(start.getTime() + Math.max(Number(durationMinutes) || 0, 1) * MINUTE);
    const reason = await staffUnavailabilityReason(db, {
      staffId: staff.id,
      staffName: staff.user?.fullName,
      start,
      end: end > start ? end : new Date(start.getTime() + MINUTE),
    });
    if (reason) return `${reason} Choisissez une autre date ou une autre animatrice.`;
  }
  return null;
}

/**
 * Why a walk-in cannot be recorded for this staff member today, or null: a
 * day on her weekday that is not hers, or a full-day indisponibilité.
 */
export async function walkInUnavailabilityReason(db, { staffId, staffName, now = new Date() }) {
  const today = brusselsDateKey(now);
  const dayStart = parseBrusselsInputValue(`${today}T00:00`);
  const dayEnd = parseBrusselsInputValue(`${addDaysToDateKey(today, 1)}T00:00`);
  const who = staffName || "Ce membre du personnel";

  if (await firstGivenAwayDay(db, staffId, [today])) {
    return `${who} ne travaille pas aujourd'hui (ce n'est pas l'une de ses semaines) : aucune prestation ne peut être enregistrée pour elle.`;
  }

  const dayOff = await db.timeOff.findFirst({
    where: { staffId, isFullDay: true, startDate: { lt: dayEnd }, endDate: { gt: dayStart } },
    select: { id: true },
  });
  if (dayOff) return `${who} est indisponible aujourd'hui (indisponibilité enregistrée) : aucune prestation ne peut être enregistrée pour elle.`;

  return null;
}

/**
 * What is already booked with her on these days: rendez-vous, and the
 * formation and atelier sessions she animates (the same reader the booking
 * uses). Read before a change takes days away from her.
 *
 * @param {object} db
 * @param {string} staffId
 * @param {string[]} dateKeys - Brussels days, any order
 * @returns {Promise<{ appointmentDays: string[], sessionDays: string[] }>}
 */
export async function bookedDays(db, staffId, dateKeys) {
  const keys = [...new Set(dateKeys)].sort();
  if (keys.length === 0) return { appointmentDays: [], sessionDays: [] };

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { id: true, userId: true, user: { select: { email: true } } },
  });
  if (!staff) return { appointmentDays: [], sessionDays: [] };

  const busy = await loadStaffBusyIntervals(db, {
    staff,
    from: parseBrusselsInputValue(`${keys[0]}T00:00`),
    to: parseBrusselsInputValue(`${addDaysToDateKey(keys[keys.length - 1], 1)}T00:00`),
  });
  const taken = (kinds) =>
    keys.filter((key) => {
      const dayStart = parseBrusselsInputValue(`${key}T00:00`);
      const dayEnd = parseBrusselsInputValue(`${addDaysToDateKey(key, 1)}T00:00`);
      return busy.some(
        (interval) => kinds.includes(interval.kind) && new Date(interval.start) < dayEnd && new Date(interval.end) > dayStart
      );
    });

  return { appointmentDays: taken(["APPOINTMENT"]), sessionDays: taken(["FORMATION", "WORKSHOP"]) };
}

/** The refusal for days that would be taken away while something is booked on them, or null. */
export function bookedDaysRefusal({ appointmentDays, sessionDays }, { who = "Elle" } = {}) {
  const list = (days) => days.slice(0, 6).map(formatDateKey).join(", ") + (days.length > 6 ? "…" : "");
  if (appointmentDays.length > 0) {
    return `${who} a déjà des rendez-vous le ${list(appointmentDays)} : déplacez-les ou annulez-les avant de lui retirer ces jours.`;
  }
  if (sessionDays.length > 0) {
    return `${who} anime déjà une formation ou un atelier le ${list(sessionDays)} : déplacez la session ou changez d'animatrice avant de lui retirer ces jours.`;
  }
  return null;
}
