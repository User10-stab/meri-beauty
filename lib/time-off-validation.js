import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";

/**
 * Server-side validation for TimeOff (indisponibilité) creation/update.
 *
 * Run immediately before writing a TimeOff so a staff member can never be
 * marked unavailable over a period where they are already booked. All checks
 * use real start/end instants (not whole calendar days), so a reservation on
 * the same date but outside the requested hours does NOT block creation.
 *
 * Overlap rule is deliberately the same half-open predicate used everywhere
 * else in the availability system (see findConflictingAppointment in
 * lib/appointment-scheduling.js and the slot generation in
 * lib/slot-availability.js): intervals that only touch at the boundary
 * (09:00–12:00 + 12:00–18:00) do NOT overlap.
 */

/**
 * Half-open interval overlap: [aStart, aEnd) overlaps [bStart, bEnd) iff
 * aStart < bEnd && aEnd > bStart. Touching boundaries are non-overlapping.
 *
 * @param {Date|string} aStart
 * @param {Date|string} aEnd
 * @param {Date|string} bStart
 * @param {Date|string} bEnd
 * @returns {boolean}
 */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return (
    new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(aEnd).getTime() > new Date(bStart).getTime()
  );
}

// Same weekday map as buildAvailabilityForDate in lib/slot-availability.js —
// WorkingHour.day is a WeekDay enum, Date.getDay() is 0 (Sunday) – 6.
const DAY_MAP = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function workingHourForDate(workingHours, date) {
  const weekDay = DAY_MAP[new Date(date).getDay()];
  const wh = (workingHours || []).find((w) => w.day === weekDay);
  if (!wh || wh.isClosed) return null;
  return wh;
}

function timeToMinutes(timeStr) {
  const [h, m] = String(timeStr).split(":").map(Number);
  return h * 60 + m;
}

/**
 * Validate a requested TimeOff interval against everything that can already
 * occupy the staff member: active appointments (reservations), formation
 * sessions they animate, other TimeOffs, and their working hours.
 *
 * @param {object} db - prisma client (or transaction client) with
 *   staff/appointment/animator/formationSession/timeOff delegates.
 * @param {object} params
 * @param {string} params.staffId
 * @param {Date} params.newStart - requested TimeOff start (local instant, as built by buildDateTime)
 * @param {Date} params.newEnd - requested TimeOff end
 * @param {boolean} params.isFullDay
 * @param {string|null} [params.excludeTimeOffId] - skip this TimeOff (update path) so
 *   editing a TimeOff without moving it never conflicts with itself.
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string }>}
 */
export async function validateTimeOffSlot(
  db,
  { staffId, newStart, newEnd, isFullDay, excludeTimeOffId = null }
) {
  const start = new Date(newStart);
  const end = new Date(newEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) {
    return {
      ok: false,
      code: "INVALID_RANGE",
      message: "La période d'indisponibilité est invalide.",
    };
  }

  // Staff record, read once and reused below: working hours for the
  // partial-day check, account e-mail for the animator/formation resolution.
  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { workingHours: true, user: { select: { email: true } } },
  });

  // ─── Working hours (partial-day only) ───────────────────────────────────
  // Reuses the staff's own WorkingHour records — the same source
  // buildAvailabilityForDate reads. Full-day leaves intentionally skip this:
  // they legitimately span closed days/weekends.
  if (isFullDay === false) {
    const wh = workingHourForDate(staff?.workingHours, start);
    if (!wh) {
      return {
        ok: false,
        code: "OUTSIDE_WORKING_HOURS",
        message: "Ce membre du personnel ne travaille pas à cette date.",
      };
    }
    const workStart = timeToMinutes(wh.startTime);
    const workEnd = timeToMinutes(wh.endTime);
    const reqStart = start.getHours() * 60 + start.getMinutes();
    const reqEnd = end.getHours() * 60 + end.getMinutes();
    // The request must intersect working hours — a TimeOff entirely outside
    // (e.g. 20:00–22:00 for a 09:00–18:00 day) is rejected, while a TimeOff
    // that starts before opening (07:00–11:30) is kept, since it does occupy
    // bookable time.
    if (reqEnd <= workStart || reqStart >= workEnd) {
      return {
        ok: false,
        code: "OUTSIDE_WORKING_HOURS",
        message: "La période demandée est en dehors des heures de travail de ce membre du personnel.",
      };
    }
  }

  // ─── 1. Existing reservations/appointments ──────────────────────────────
  // Same scope as the availability system: active statuses only, soft-deleted
  // rows ignored, and each appointment occupies its duration plus its own
  // post-service margin (see findConflictingAppointment).
  const appointments = await db.appointment.findMany({
    where: {
      staffId,
      isDeleted: false,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      startTime: { lt: end },
      endTime: { gt: start },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      staffService: { select: { margin: true } },
    },
  });

  const conflictingAppointment = appointments.find((appt) => {
    const occupiedEnd = new Date(appt.endTime);
    occupiedEnd.setMinutes(occupiedEnd.getMinutes() + Number(appt.staffService?.margin ?? 0));
    return intervalsOverlap(start, end, new Date(appt.startTime), occupiedEnd);
  });

  if (conflictingAppointment) {
    return {
      ok: false,
      code: "APPOINTMENT_CONFLICT",
      message: "Ce membre du personnel a déjà une réservation sur ce créneau.",
    };
  }

  // ─── 2. Existing formations ─────────────────────────────────────────────
  // A staff member animates a session either directly (session animator) or
  // through the parent formation's animator — same fallback as
  // lib/payments/resolve-payee.js. Cancelled sessions never block.
  //
  // The animator directory is matched by e-mail (staff account e-mail →
  // animator e-mail): the same heuristic getActivityNotificationRecipients
  // (lib/notifications.js) uses, and the same e-mail Animator.staffId itself
  // is derived from (staffIdForAnimatorEmail in lib/payments/resolve-payee.js),
  // so both resolutions agree on consistent data. E-mail matching
  // deliberately avoids querying Animator.staffId, which does not exist on
  // databases/clients predating the 20260917150000 migration — a direct
  // staffId lookup throws PrismaClientValidationError there and would block
  // every TimeOff creation with a generic error.
  const animatorIds = new Set();
  const staffEmail = staff?.user?.email ?? null;
  if (staffEmail) {
    const linkedAnimators = await db.animator.findMany({
      where: { email: { equals: staffEmail, mode: "insensitive" } },
      select: { id: true },
    });
    for (const linked of linkedAnimators ?? []) {
      if (linked?.id) animatorIds.add(linked.id);
    }
  }

  if (animatorIds.size > 0) {
    const ids = [...animatorIds];
    const sessions = await db.formationSession.findMany({
      where: {
        status: { not: "CANCELLED" },
        startDate: { lt: end },
        AND: [
          { OR: [{ animatorId: { in: ids } }, { formation: { animatorId: { in: ids } } }] },
          {
            OR: [
              { endDate: { gt: start } },
              { endDate: null, startDate: { gte: start, lt: end } },
            ],
          },
        ],
      },
      select: { id: true, startDate: true, endDate: true },
    });

    // Sessions without an endDate are point events — same convention as the
    // dashboard calendar ((s.endDate ?? s.startDate)).
    const conflictingSession = sessions.find((s) =>
      intervalsOverlap(start, end, new Date(s.startDate), new Date(s.endDate ?? s.startDate))
    );

    if (conflictingSession) {
      return {
        ok: false,
        code: "FORMATION_CONFLICT",
        message: "Ce membre du personnel a déjà une formation sur ce créneau.",
      };
    }
  }

  // ─── 3. Existing TimeOff / indisponibilités ──────────────────────────────
  // Strict instant overlap (lt/gt): same-date TimeOffs outside the requested
  // hours, and adjacent periods (09:00–12:00 + 12:00–18:00), do NOT block.
  const overlappingTimeOff = await db.timeOff.findFirst({
    where: {
      staffId,
      ...(excludeTimeOffId ? { id: { not: excludeTimeOffId } } : {}),
      startDate: { lt: end },
      endDate: { gt: start },
    },
    select: { id: true },
  });

  if (overlappingTimeOff) {
    return {
      ok: false,
      code: "TIME_OFF_CONFLICT",
      message: "Une indisponibilité existe déjà sur ce créneau.",
    };
  }

  return { ok: true };
}

/**
 * Build the user-facing message for a TimeOff conflict, contextualized by the
 * attempted operation. Reservation/formation conflicts are prefixed with what
 * the user was trying to do ("créer" / "modifier"); TimeOff and working-hours
 * conflicts already read as standalone sentences and are returned as-is.
 *
 * Single place that owns this wording so the 4 write actions (self-service +
 * admin, create + update) can never drift apart or fall back to a generic
 * message for a known validation outcome.
 *
 * @param {"créer"|"modifier"} operation
 * @param {{ ok: false, code: string, message: string }} conflict
 * @returns {string}
 */
export function formatTimeOffConflict(operation, conflict) {
  if (conflict.code === "APPOINTMENT_CONFLICT" || conflict.code === "FORMATION_CONFLICT") {
    const verb = operation === "modifier" ? "modifier" : "créer";
    const reason = conflict.message.charAt(0).toLowerCase() + conflict.message.slice(1);
    return `Impossible de ${verb} cette indisponibilité : ${reason}`;
  }
  return conflict.message;
}
