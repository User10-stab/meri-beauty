import { parseBrusselsInputValue, toBrusselsInputValue } from "@/lib/datetime/brussels-input";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { liveSeatFilter } from "@/lib/reservations/session-occupancy";

/**
 * « Date libre » — a PRIVATE formation's client picks her own date.
 *
 * Until 2026-10-02 a private formation could only be booked on the dates the
 * salon had typed into it, so a client whose diary did not match one of them
 * could not book at all. Now a private formation can be published with no
 * date, or with some: either way the client may also take any day its
 * animator is free.
 *
 * "Free" is the animator's own calendar, the same sources the rendez-vous
 * slots and the indisponibilité check read:
 *   - her working hours (a closed weekday is never offered),
 *   - her indisponibilités — which is also where the jours fériés live,
 *   - the salon's fermetures exceptionnelles,
 *   - her rendez-vous (with their margin),
 *   - the formation and atelier sessions she already animates.
 *
 * A date picked this way becomes a FormationSession flagged
 * `customerRequested`, created with the booking. Like every other seat
 * (lib/reservations/session-occupancy.js) it only counts once it is PAID —
 * deposit or full: an unpaid pick blocks nobody, and the payment fulfilment
 * re-checks the calendar before confirming (customSessionConflict below).
 *
 * A journée is always 10:00 → 17:00 (decided with the salon, 2026-10-05:
 * no flexible hours any more). The formation's duration is its TOTAL, and it
 * sets the number of journées: one per 7 h started — a 4 h or a 7 h
 * formation is one journée, 10 h is two, 21 h is three. The client only
 * picks the first day.
 *
 * The journées need not be consecutive (2026-10-09): until then they had to
 * be, so a three-journée formation could never be booked with an animator
 * who works Monday, Tuesday and Friday. The first journée is the day the
 * client picked; each following one is the animator's next day that she
 * works over 10:00–17:00 and is free all of it — a closed weekday, a
 * fermeture, an indisponibilité or a day with a rendez-vous is stepped over.
 * The exact days are stored on the session (`customDateKeys`): they cannot
 * be rebuilt later from its start and end, her calendar moves.
 *
 * Kept out of any "use server" module: every export of such a file is a
 * public POST endpoint, and most of this is calendar arithmetic shared by the
 * booking action, the payment fulfilment and the public pages.
 */

/** Every journée starts and ends at these hours (Brussels). */
export const CUSTOM_DATE_DAY_START = "10:00";
export const CUSTOM_DATE_DAY_END = "17:00";
/** 10:00 → 17:00. */
export const CUSTOM_DATE_DAY_MINUTES = 7 * 60;
/** Hard ceiling on the number of journées, whatever the duration. */
export const CUSTOM_DATE_MAX_DAYS = 30;
/** Start times are tried every half hour inside the working day. */
export const CUSTOM_DATE_SLOT_STEP_MINUTES = 30;
/** The last journée is at most this many days after the first. */
export const CUSTOM_DATE_MAX_SPAN_DAYS = 60;
/** How far ahead a client may pick a date. */
export const CUSTOM_DATE_HORIZON_DAYS = 365;

export const CUSTOM_DATE_UNAVAILABLE_MESSAGE =
  "Cette date n'est plus disponible. Veuillez en choisir une autre.";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MINUTE = 60 * 1000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * How long each day of the booking lasts: always the full journée,
 * 10:00 → 17:00, whatever the formation's total.
 */
export function customDatePerDayMinutes(totalMinutes, days) {
  const total = Number(totalMinutes);
  const count = Number(days);
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(count) || count < 1) return 0;
  return CUSTOM_DATE_DAY_MINUTES;
}

/** How many journées a formation of this total duration takes: one per 7 h started. */
export function customDateDayCount(totalMinutes) {
  const total = Number(totalMinutes);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / CUSTOM_DATE_DAY_MINUTES);
}

/**
 * The numbers of journées this formation may be booked over — a single one,
 * set by its duration (none beyond CUSTOM_DATE_MAX_DAYS). Kept as a list so
 * the slots stay keyed by journée count.
 */
export function customDateDayOptions(totalMinutes) {
  const count = customDateDayCount(totalMinutes);
  return count >= 1 && count <= CUSTOM_DATE_MAX_DAYS ? [count] : [];
}

function isDayCount(days) {
  return Number.isInteger(days) && days >= 1 && days <= CUSTOM_DATE_MAX_DAYS;
}

// ─── Calendar-day arithmetic (Brussels wall clock, no server-timezone use) ──

export function isDateKey(value) {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isTimeOfDay(value) {
  return typeof value === "string" && TIME.test(value);
}

export function addDaysToDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekDayOf(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEK_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The Brussels calendar day an instant falls on. */
export function brusselsDateKey(instant) {
  return toBrusselsInputValue(instant).slice(0, 10);
}

function brusselsTimeOfDay(instant) {
  return toBrusselsInputValue(instant).slice(11, 16);
}

function minutesOf(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

function timeOf(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Brussels wall clock "YYYY-MM-DD" + minutes from midnight → the instant. */
function instantAt(dateKey, minutes) {
  // 24:00 is the next day's midnight — a datetime-local string cannot say it.
  if (minutes >= 1440) return instantAt(addDaysToDateKey(dateKey, 1), minutes - 1440);
  return parseBrusselsInputValue(`${dateKey}T${timeOf(minutes)}`);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

// ─── The slots themselves (pure) ────────────────────────────────────────────

/**
 * The instants one booking occupies: one window per day, same hours each day.
 * `dateKeys` are the booking's own days; without them, `days` consecutive
 * ones from `dateKey`.
 *
 * @returns {{ start: Date, end: Date }[]}
 */
export function customDateWindows({ dateKey, dateKeys, time, days, durationMinutes }) {
  const startMinutes = minutesOf(time);
  const dayKeys = dateKeys ?? Array.from({ length: days }, (_, index) => addDaysToDateKey(dateKey, index));
  return dayKeys.map((dayKey) => ({
    start: instantAt(dayKey, startMinutes),
    end: instantAt(dayKey, startMinutes + durationMinutes),
  }));
}

/**
 * The start times a booking of `days` day(s) beginning on `dateKey` may take.
 *
 * A time is offered only when it holds on every day of the booking: inside
 * that day's working hours, clear of everything in `busy`, and — for the
 * first day — still in the future.
 *
 * @param {object} params
 * @param {string} params.dateKey - first day, "YYYY-MM-DD"
 * @param {number} params.days - number of consecutive journées
 * @param {number} params.durationMinutes - how long EACH day lasts (customDatePerDayMinutes)
 * @param {{ day: string, startTime: string, endTime: string, isClosed: boolean }[]} params.workingHours
 * @param {{ start: Date, end: Date }[]} params.busy
 * @param {Date} [params.now]
 * @returns {string[]} "HH:mm" start times, ascending
 */
export function freeStartTimes({ dateKey, days, durationMinutes, workingHours, busy, now = new Date() }) {
  if (!isDateKey(dateKey) || !isDayCount(days)) return [];
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];

  const dayKeys = Array.from({ length: days }, (_, index) => addDaysToDateKey(dateKey, index));

  // The stretch of the clock that is working time on every day of the booking.
  let earliest = 0;
  let latest = 1440;
  for (const dayKey of dayKeys) {
    const hours = (workingHours ?? []).find((wh) => wh.day === weekDayOf(dayKey));
    if (!hours || hours.isClosed) return [];
    const open = minutesOf(hours.startTime);
    let close = minutesOf(hours.endTime);
    // A closing time at or before the opening one means "past midnight"; the
    // day itself still ends at 24:00 for a formation.
    if (close <= open) close = 1440;
    earliest = Math.max(earliest, open);
    latest = Math.min(latest, close);
  }

  const times = [];
  const step = CUSTOM_DATE_SLOT_STEP_MINUTES;
  for (let start = Math.ceil(earliest / step) * step; start + durationMinutes <= latest; start += step) {
    const windows = dayKeys.map((dayKey) => ({
      start: instantAt(dayKey, start),
      end: instantAt(dayKey, start + durationMinutes),
    }));
    if (windows[0].start.getTime() <= now.getTime()) continue;
    const taken = windows.some((window) =>
      busy.some((interval) => overlaps(window.start, window.end, interval.start, interval.end))
    );
    if (!taken) times.push(timeOf(start));
  }
  return times;
}

/**
 * The days a booking of `days` journées beginning on `dateKey` takes: that
 * day, then the animator's next free working days — the ones in between are
 * stepped over. [] when the first day itself is not a free journée, or when
 * the journées do not fit within CUSTOM_DATE_MAX_SPAN_DAYS.
 *
 * @param {object} params
 * @param {string} params.dateKey - first day, "YYYY-MM-DD"
 * @param {number} params.days - number of journées
 * @param {Map<string, boolean>} [params.freeDays] - memo of the days already
 *   read, shared by the calls of one calendar month
 * @returns {string[]} "YYYY-MM-DD" keys, ascending
 */
export function customDateDayKeys({ dateKey, days, workingHours, busy, now = new Date(), freeDays = new Map() }) {
  if (!isDateKey(dateKey) || !isDayCount(days)) return [];

  const isFree = (dayKey) => {
    if (!freeDays.has(dayKey)) {
      freeDays.set(
        dayKey,
        freeStartTimes({ dateKey: dayKey, days: 1, durationMinutes: CUSTOM_DATE_DAY_MINUTES, workingHours, busy, now })
          .includes(CUSTOM_DATE_DAY_START)
      );
    }
    return freeDays.get(dayKey);
  };

  if (!isFree(dateKey)) return [];
  const keys = [dateKey];
  for (let offset = 1; keys.length < days && offset <= CUSTOM_DATE_MAX_SPAN_DAYS; offset += 1) {
    const dayKey = addDaysToDateKey(dateKey, offset);
    if (isFree(dayKey)) keys.push(dayKey);
  }
  return keys.length === days ? keys : [];
}

/** First and last bookable days, as Brussels date keys. */
export function customDateRange(now = new Date()) {
  const today = brusselsDateKey(now);
  return { firstDateKey: today, lastDateKey: addDaysToDateKey(today, CUSTOM_DATE_HORIZON_DAYS) };
}

// ─── The animator's calendar (database) ─────────────────────────────────────

/**
 * The staff member whose calendar a private formation runs on: its animator
 * when she is a staff profile, otherwise the staff profile of whoever created
 * it. Null when neither exists (an outside animator, or a formation created
 * by an admin with nobody assigned) — a date libre is then not offered at
 * all, because there is no calendar to check it against.
 *
 * @param {object} db - Prisma client or transaction client
 * @param {{ animatorId: string|null, createdById: string|null }} formation
 */
export async function resolveFormationOwnerStaff(db, formation) {
  const select = {
    id: true,
    userId: true,
    isActive: true,
    isDeleted: true,
    workingHours: true,
    user: { select: { email: true, isActive: true, isDeleted: true } },
  };

  let staff = null;
  if (formation.animatorId) {
    const animator = await db.animator.findUnique({
      where: { id: formation.animatorId },
      select: { staffId: true, email: true },
    });
    if (animator?.staffId) {
      staff = await db.staff.findUnique({ where: { id: animator.staffId }, select });
    } else if (animator?.email) {
      staff = await db.staff.findFirst({
        where: { isDeleted: false, user: { email: { equals: animator.email, mode: "insensitive" } } },
        select,
      });
    }
  } else if (formation.createdById) {
    staff = await db.staff.findUnique({ where: { userId: formation.createdById }, select });
  }

  if (!staff || !staff.isActive || staff.isDeleted) return null;
  if (staff.user?.isDeleted || staff.user?.isActive === false) return null;
  if (!staff.workingHours?.some((wh) => !wh.isClosed)) return null;
  return staff;
}

/** Whether this formation lets the client pick her own date. */
export async function formationOffersCustomDates(db, formation) {
  if (formation?.type !== "PRIVATE") return false;
  return Boolean(await resolveFormationOwnerStaff(db, formation));
}

/**
 * Everything that occupies the staff member between `from` and `to`, as plain
 * intervals.
 *
 * @param {object} db
 * @param {object} params
 * @param {{ id: string, user?: { email?: string|null } }} params.staff
 * @param {Date} params.from
 * @param {Date} params.to
 * @param {string|null} [params.excludeSessionId] - the customer-requested
 *   session being confirmed, which must not conflict with itself.
 * @returns {Promise<{ start: Date, end: Date, kind: string }[]>}
 */
export async function loadStaffBusyIntervals(db, { staff, from, to, excludeSessionId = null }) {
  const animators = await db.animator.findMany({
    where: {
      OR: [
        { staffId: staff.id },
        ...(staff.user?.email ? [{ email: { equals: staff.user.email, mode: "insensitive" } }] : []),
      ],
    },
    select: { id: true },
  });
  const animatorIds = animators.map((animator) => animator.id);
  const ownFormationSessions = staff.userId
    ? [{ animatorId: null, customerRequested: true, formation: { animatorId: null, createdById: staff.userId } }]
    : [];

  const [appointments, timeOffs, closures, formationSessions, workshopSessions] = await Promise.all([
    db.appointment.findMany({
      where: {
        staffId: staff.id,
        isDeleted: false,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        startTime: { lt: to },
        endTime: { gt: new Date(from.getTime() - 24 * 60 * MINUTE) },
      },
      select: { startTime: true, endTime: true, staffService: { select: { margin: true } } },
    }),
    db.timeOff.findMany({
      where: { staffId: staff.id, startDate: { lt: to }, endDate: { gt: from } },
      select: { startDate: true, endDate: true },
    }),
    db.salonClosure.findMany({
      where: {
        startDate: { lt: to },
        OR: [{ endDate: { gt: new Date(from.getTime() - 24 * 60 * MINUTE) } }, { endDate: null }],
      },
      select: { startDate: true, endDate: true, isFullDay: true, openingTime: true, closingTime: true },
    }),
    animatorIds.length === 0 && ownFormationSessions.length === 0
      ? []
      : db.formationSession.findMany({
          where: {
            status: { not: "CANCELLED" },
            startDate: { lt: to },
            ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
            AND: [
              {
                OR: [
                  { animatorId: { in: animatorIds } },
                  { animatorId: null, formation: { animatorId: { in: animatorIds } } },
                  // A formation with no animator runs on its creator's
                  // calendar (resolveFormationOwnerStaff) — so do its dates.
                  ...ownFormationSessions,
                ],
              },
              // A date another client picked only counts once she has paid.
              { OR: [{ customerRequested: false }, { reservations: { some: liveSeatFilter() } }] },
            ],
          },
          select: {
            startDate: true,
            endDate: true,
            customerRequested: true,
            customDateKeys: true,
            formation: { select: { duration: true } },
          },
        }),
    animatorIds.length === 0
      ? []
      : db.workshopSession.findMany({
          where: {
            status: { not: "CANCELLED" },
            startDate: { lt: to },
            OR: [
              { animatorId: { in: animatorIds } },
              { animatorId: null, workshop: { animatorId: { in: animatorIds } } },
            ],
          },
          select: { startDate: true, endDate: true, workshop: { select: { duration: true } } },
        }),
  ]);

  const busy = [];

  for (const appointment of appointments) {
    const margin = Number(appointment.staffService?.margin ?? 0);
    busy.push({
      start: appointment.startTime,
      end: new Date(appointment.endTime.getTime() + margin * MINUTE),
      kind: "APPOINTMENT",
    });
  }

  for (const timeOff of timeOffs) {
    busy.push({ start: timeOff.startDate, end: timeOff.endDate, kind: "TIME_OFF" });
  }

  for (const closure of closures) {
    const firstDay = brusselsDateKey(closure.startDate);
    const lastDay = brusselsDateKey(closure.endDate ?? closure.startDate);
    const partial = !closure.isFullDay && isTimeOfDay(closure.openingTime) && isTimeOfDay(closure.closingTime);
    for (let dayKey = firstDay; dayKey <= lastDay; dayKey = addDaysToDateKey(dayKey, 1)) {
      if (!partial) {
        busy.push({ start: instantAt(dayKey, 0), end: instantAt(dayKey, 1440), kind: "CLOSURE" });
        continue;
      }
      // Exceptional opening hours: the salon is shut outside them.
      busy.push({ start: instantAt(dayKey, 0), end: instantAt(dayKey, minutesOf(closure.openingTime)), kind: "CLOSURE" });
      busy.push({ start: instantAt(dayKey, minutesOf(closure.closingTime)), end: instantAt(dayKey, 1440), kind: "CLOSURE" });
    }
  }

  for (const session of formationSessions) {
    // A client's own journées are separate days at the same hours: the
    // evenings, nights and stepped-over days between them stay free. A
    // session the salon scheduled over several days keeps its whole span.
    if (session.customerRequested) {
      for (const window of customSessionWindows(session)) busy.push({ ...window, kind: "FORMATION" });
      continue;
    }
    busy.push({
      start: session.startDate,
      end: session.endDate ?? new Date(session.startDate.getTime() + Number(session.formation.duration) * MINUTE),
      kind: "FORMATION",
    });
  }

  for (const session of workshopSessions) {
    busy.push({
      start: session.startDate,
      end: session.endDate ?? new Date(session.startDate.getTime() + Number(session.workshop.duration) * MINUTE),
      kind: "WORKSHOP",
    });
  }

  return busy.filter((interval) => overlaps(interval.start, interval.end, from, to));
}

/**
 * The days a booking starting on `dateKey` takes, keyed by the formation's
 * number of journées: its day keys when they can all be placed, [] otherwise.
 */
function dayKeysByDayCount({ formation, dateKey, workingHours, busy, now, freeDays }) {
  const dates = {};
  for (const days of customDateDayOptions(formation.duration)) {
    dates[days] = customDateDayKeys({ dateKey, days, workingHours, busy, now, freeDays });
  }
  return dates;
}

/** The fixed start time of each bookable journée count: ["10:00"] or []. */
function timesOf(dates) {
  return Object.fromEntries(
    Object.entries(dates).map(([days, keys]) => [days, keys.length > 0 ? [CUSTOM_DATE_DAY_START] : []])
  );
}

function emptyTimes(formation) {
  return Object.fromEntries(customDateDayOptions(formation.duration).map((days) => [days, []]));
}

/**
 * The free start times of one day, for every number of journées the
 * formation can be spread over, and the days each of those bookings takes.
 *
 * @returns {Promise<{ offered: boolean, times: Record<number, string[]>, dates: Record<number, string[]> }>}
 */
export async function getCustomDateSlots(db, { formation, dateKey, now = new Date() }) {
  if (!isDateKey(dateKey)) return { offered: false, times: {}, dates: {} };
  const staff = formation.type === "PRIVATE" ? await resolveFormationOwnerStaff(db, formation) : null;
  if (!staff) return { offered: false, times: {}, dates: {} };

  const { firstDateKey, lastDateKey } = customDateRange(now);
  if (dateKey < firstDateKey || dateKey > lastDateKey) {
    return { offered: true, times: emptyTimes(formation), dates: emptyTimes(formation) };
  }

  const busy = await loadStaffBusyIntervals(db, {
    staff,
    from: instantAt(dateKey, 0),
    // The following journées may land anywhere in the span.
    to: instantAt(addDaysToDateKey(dateKey, CUSTOM_DATE_MAX_SPAN_DAYS + 1), 0),
  });

  const dates = dayKeysByDayCount({ formation, dateKey, workingHours: staff.workingHours, busy, now });
  return { offered: true, times: timesOf(dates), dates };
}

/**
 * Which days of a month still have at least one free start time — what the
 * calendar greys out. `monthKey` is "YYYY-MM".
 *
 * @returns {Promise<{ offered: boolean, days: Record<string, Record<number, boolean>> }>}
 */
export async function getCustomDateMonth(db, { formation, monthKey, now = new Date() }) {
  if (typeof monthKey !== "string" || !/^\d{4}-\d{2}$/.test(monthKey) || !isDateKey(`${monthKey}-01`)) {
    return { offered: false, days: {} };
  }
  const staff = formation.type === "PRIVATE" ? await resolveFormationOwnerStaff(db, formation) : null;
  if (!staff) return { offered: false, days: {} };

  const firstOfMonth = `${monthKey}-01`;
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const { firstDateKey, lastDateKey } = customDateRange(now);

  const busy = await loadStaffBusyIntervals(db, {
    staff,
    from: instantAt(firstOfMonth, 0),
    // Past the month: the 31st can start a booking of several journées.
    to: instantAt(addDaysToDateKey(firstOfMonth, daysInMonth + CUSTOM_DATE_MAX_SPAN_DAYS + 1), 0),
  });

  const freeDays = new Map();
  const days = {};
  for (let index = 0; index < daysInMonth; index += 1) {
    const dateKey = addDaysToDateKey(firstOfMonth, index);
    if (dateKey < firstDateKey || dateKey > lastDateKey) continue;
    const times = timesOf(dayKeysByDayCount({ formation, dateKey, workingHours: staff.workingHours, busy, now, freeDays }));
    // A day is pickable when any number of journées can start on it — a
    // formation longer than one working day never has the one-journée answer.
    const counts = Object.fromEntries(Object.entries(times).map(([count, list]) => [count, list.length > 0]));
    if (!Object.values(counts).some(Boolean)) continue;
    days[dateKey] = counts;
  }
  return { offered: true, days };
}

/**
 * Validates the date a client submitted — never trusted from the form, the
 * booking action is a public endpoint — and returns the session it describes.
 *
 * The journées after the first depend on the animator's calendar at this
 * instant, so they may no longer be the ones the client was shown: the days
 * she saw come back in `customDate.dates` and must still be the answer.
 *
 * @returns {Promise<{ ok: true, startDate: Date, endDate: Date, dateKeys: string[], animatorId: string|null }
 *   | { ok: false, message: string }>}
 */
export async function resolveCustomDateRequest(db, { formation, customDate, now = new Date() }) {
  const dateKey = customDate?.date;
  const time = customDate?.time;
  const days = Number(customDate?.days);

  if (!isDateKey(dateKey) || !isTimeOfDay(time) || !customDateDayOptions(formation.duration).includes(days)) {
    return { ok: false, message: "Veuillez choisir une date, un nombre de journées et un horaire." };
  }

  const slots = await getCustomDateSlots(db, { formation, dateKey, now });
  if (!slots.offered) {
    return { ok: false, message: "Cette formation ne peut pas être réservée à une date libre." };
  }
  if (!(slots.times[days] ?? []).includes(time)) {
    return { ok: false, message: CUSTOM_DATE_UNAVAILABLE_MESSAGE };
  }

  const dateKeys = slots.dates[days];
  const shown = customDate?.dates;
  if (!Array.isArray(shown) || shown.length !== dateKeys.length || shown.some((key, index) => key !== dateKeys[index])) {
    return { ok: false, message: CUSTOM_DATE_UNAVAILABLE_MESSAGE };
  }

  const windows = customDateWindows({ dateKeys, time, durationMinutes: customDatePerDayMinutes(formation.duration, days) });
  return {
    ok: true,
    startDate: windows[0].start,
    endDate: windows[windows.length - 1].end,
    dateKeys,
    animatorId: formation.animatorId ?? null,
  };
}

/**
 * The Brussels days a session is held on: the days stored with a date libre
 * (`customDateKeys`), otherwise every day from its start to its end — a
 * session the salon scheduled, or a date libre booked before 2026-10-09,
 * when the journées were always consecutive.
 *
 * @returns {string[]} "YYYY-MM-DD" keys, ascending
 */
export function sessionDayKeys(session) {
  if (Array.isArray(session.customDateKeys) && session.customDateKeys.length > 0) {
    return [...session.customDateKeys].sort();
  }
  const firstDay = brusselsDateKey(session.startDate);
  const lastDay = brusselsDateKey(session.endDate ?? session.startDate);
  const keys = [];
  for (let dayKey = firstDay; dayKey <= lastDay; dayKey = addDaysToDateKey(dayKey, 1)) keys.push(dayKey);
  return keys;
}

/**
 * The day windows of an existing customer-requested session: the hours of
 * its start and end, on each of its days.
 */
export function customSessionWindows(session) {
  const open = minutesOf(brusselsTimeOfDay(session.startDate));
  const close = session.endDate ? minutesOf(brusselsTimeOfDay(session.endDate)) : open;
  return sessionDayKeys(session).map((dayKey) => ({
    start: instantAt(dayKey, open),
    end: instantAt(dayKey, close > open ? close : open),
  }));
}

/** How many days a session runs over — 1 for a same-day session. */
export function sessionDayCount(session) {
  return customSessionWindows(session).length;
}

/**
 * What now occupies a customer-requested session's hours, or null when the
 * animator is still free. Run by the payment fulfilment: the pick blocked
 * nobody while it was unpaid, so a rendez-vous, an indisponibilité or another
 * client's paid date may have taken the slot in the meantime.
 *
 * @param {object} db - the fulfilment's transaction client
 * @param {{ id: string, startDate: Date, endDate: Date|null, customDateKeys?: string[], formation: { animatorId: string|null, createdById: string|null } }} session
 * @returns {Promise<string|null>} the kind of the first conflict
 */
export async function customSessionConflict(db, session) {
  const staff = await resolveFormationOwnerStaff(db, session.formation);
  // Nobody's calendar to check any more (the animator left): nothing to refuse on.
  if (!staff) return null;

  // Serialise confirmations on one animator: two clients paying for the same
  // free day at the same moment must not both read "nothing booked yet".
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`formation-custom-date:${staff.id}`}))`;

  const windows = customSessionWindows(session);
  const busy = await loadStaffBusyIntervals(db, {
    staff,
    from: windows[0].start,
    to: windows[windows.length - 1].end,
    excludeSessionId: session.id,
  });
  const conflict = busy.find((interval) =>
    windows.some((window) => overlaps(window.start, window.end, interval.start, interval.end))
  );
  return conflict?.kind ?? null;
}

/**
 * " → 25 nov. 2026 (3 journées)" after a start date already shown, for a
 * session over several days; "" for a one-day session or without endDate.
 */
export function multiDaySuffix(session) {
  if (!session?.startDate || !session?.endDate) return "";
  const range = formatSessionDateRange(session);
  if (!range.multiDay) return "";
  const end = new Date(session.endDate).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
  return ` → ${end} (${range.dayCount} journées)`;
}

/**
 * "23 octobre 2026" / "23 et 24 octobre" / "du 23 au 26 octobre"-style label
 * parts for a session. Journées that do not follow each other are each
 * named — "du 23 au 27" would promise the days in between.
 */
export function formatSessionDateRange(session, locale = "fr-FR") {
  const day = (value) =>
    new Date(value).toLocaleDateString(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Brussels",
    });
  const time = (value) =>
    new Date(value).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

  const start = new Date(session.startDate);
  const end = session.endDate ? new Date(session.endDate) : null;
  const multiDay = Boolean(end) && brusselsDateKey(start) !== brusselsDateKey(end);
  const hours = end ? `${time(start)} – ${time(end)}` : time(start);
  if (!multiDay) return { multiDay: false, dayCount: 1, days: day(start), hours };
  const dayKeys = sessionDayKeys(session);
  const dayCount = dayKeys.length;
  const consecutive = dayKeys.every((key, index) => index === 0 || key === addDaysToDateKey(dayKeys[index - 1], 1));
  // Noon UTC is the same calendar day in Brussels, whatever the season.
  const named = dayKeys.map((key) => day(new Date(`${key}T12:00:00Z`)));
  return {
    multiDay: true,
    dayCount,
    days:
      dayCount === 2
        ? `${day(start)} et ${day(end)}`
        : consecutive
          ? `du ${day(start)} au ${day(end)}`
          : `${named.slice(0, -1).join(", ")} et ${named.at(-1)}`,
    hours: `${hours} chaque jour`,
  };
}
