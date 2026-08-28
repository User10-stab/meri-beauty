/**
 * Calendar utility helpers — pure functions, no React.
 */

// ─── Week helpers ─────────────────────────────────────────────────────────────

/** Return Monday of the ISO week that contains `date`. */
export function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return an array of 7 Date objects (Mon–Sun) for the week containing `date`. */
export function getWeekDays(date) {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// ─── Month helpers ────────────────────────────────────────────────────────────

/** Return the first day of the month. */
export function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Return the last day of the month. */
export function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Return a 6×7 grid of Date objects that fills the calendar month view
 * (starting on Monday, padding with days from adjacent months).
 */
export function getMonthGrid(date) {
  const firstDay = getMonthStart(date);
  const lastDay = getMonthEnd(date);

  // Start grid on the Monday on or before the 1st
  const gridStart = getWeekStart(firstDay);

  // Build 42 cells (6 rows × 7 cols)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// ─── Date range helpers ───────────────────────────────────────────────────────

/** ISO date string of the start of a day (00:00:00). */
export function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** ISO date string of the end of a day (23:59:59). */
export function dayEnd(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/** Return {from, to} ISO strings covering the entire week containing `date`. */
export function weekRange(date) {
  const days = getWeekDays(date);
  return { from: dayStart(days[0]), to: dayEnd(days[6]) };
}

/** Return {from, to} ISO strings covering the entire month (+ padding days). */
export function monthRange(date) {
  const grid = getMonthGrid(date);
  return { from: dayStart(grid[0]), to: dayEnd(grid[grid.length - 1]) };
}

/** Return {from, to} ISO strings for a single day. */
export function dayRange(date) {
  return { from: dayStart(date), to: dayEnd(date) };
}

// ─── Time grid helpers ────────────────────────────────────────────────────────

/**
 * Parse a "HH:MM" time string into { hour, minute }.
 * @param {string} t  e.g. "09:00"
 */
export function parseTime(t) {
  const [h, m] = (t ?? "00:00").split(":").map(Number);
  return { hour: h || 0, minute: m || 0 };
}

/**
 * Build an array of time slot labels between openingTime and closingTime
 * at 1-hour intervals (09:00, 10:00, 11:00, …).
 * @param {string} openingTime   "HH:MM"
 * @param {string} closingTime   "HH:MM"
 * @returns {string[]}  e.g. ["09:00", "10:00", "11:00", ...]
 */
export function buildTimeSlots(openingTime = "09:00", closingTime = "19:00") {
  const slots = [];
  const { hour: startH, minute: startM } = parseTime(openingTime);
  const { hour: endH, minute: endM } = parseTime(closingTime);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  for (let m = startMin; m <= endMin; m += 60) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

// ─── Staff-based timeline derivation ─────────────────────────────────────────

const JS_TO_WEEKDAY = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/**
 * Derive the opening/closing times for a single day based on staff working
 * hours and any events (formations, ateliers) scheduled that day.
 *
 * The salon has no global working hours — each staff member has their own.
 * This function finds the earliest start and latest end across the relevant
 * staff, then extends further if events (formations/ateliers) go beyond.
 *
 * @param {Date}   date       The calendar date to compute for
 * @param {Array}  staffList  Staff members with workingHours[]
 * @param {Array}  events     Activity events (formations, ateliers)
 * @returns {{ openingTime: string, closingTime: string }}
 */
export function deriveDayTimeline(date, staffList, events = []) {
  const dayName = JS_TO_WEEKDAY[date.getDay()];

  let earliestMin = Infinity;
  let latestMin = -Infinity;

  // Check staff working hours for this day
  for (const staff of staffList) {
    const wh = (staff.workingHours || []).find((w) => w.day === dayName);
    if (!wh || wh.isClosed) continue;

    const { hour: sh, minute: sm } = parseTime(wh.startTime);
    const { hour: eh, minute: em } = parseTime(wh.endTime);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (startMin < earliestMin) earliestMin = startMin;
    if (endMin > latestMin) latestMin = endMin;
  }

  // Also consider events that might extend beyond staff hours
  const dayKey = localDateKey(date);
  for (const ev of events) {
    const raw = ev.startTime || ev.start;
    if (!raw) continue;
    // Only consider events on this day
    if (brusselsDateKey(new Date(raw)) !== dayKey) continue;

    const { hour: eh, minute: em } = getBrusselTimeComponents(raw);
    const evStartMin = eh * 60 + em;
    if (evStartMin < earliestMin) earliestMin = evStartMin;

    const endRaw = ev.endTime || ev.end;
    if (endRaw) {
      const { hour: eeh, minute: eem } = getBrusselTimeComponents(endRaw);
      const evEndMin = eeh * 60 + eem;
      if (evEndMin > latestMin) latestMin = evEndMin;
    }
  }

  // Fallback if no staff or events found
  if (earliestMin === Infinity) earliestMin = 9 * 60; // 09:00
  if (latestMin === -Infinity) latestMin = 19 * 60; // 19:00

  // Round down opening to nearest 30-min slot
  const roundedStart = Math.floor(earliestMin / 30) * 30;
  // Round up closing to nearest 30-min slot
  const roundedEnd = Math.ceil(latestMin / 30) * 30;

  return {
    openingTime: fmtTimeSlot(roundedStart),
    closingTime: fmtTimeSlot(roundedEnd),
  };
}

/**
 * Derive the opening/closing times for an entire week by computing
 * each day's timeline and taking the global min/max.
 *
 * @param {Date}   weekDate   Any date within the target week
 * @param {Array}  staffList  Staff members with workingHours[]
 * @param {Array}  events     Activity events
 * @returns {{ openingTime: string, closingTime: string }}
 */
export function deriveWeekTimeline(weekDate, staffList, events = []) {
  const days = getWeekDays(weekDate);

  let globalEarliest = Infinity;
  let globalLatest = -Infinity;

  for (const day of days) {
    const { openingTime, closingTime } = deriveDayTimeline(day, staffList, events);
    const { hour: oh, minute: om } = parseTime(openingTime);
    const { hour: ch, minute: cm } = parseTime(closingTime);
    const dayStart = oh * 60 + om;
    const dayEnd = ch * 60 + cm;

    if (dayStart < globalEarliest) globalEarliest = dayStart;
    if (dayEnd > globalLatest) globalLatest = dayEnd;
  }

  // Fallback
  if (globalEarliest === Infinity) globalEarliest = 9 * 60;
  if (globalLatest === -Infinity) globalLatest = 19 * 60;

  // Round down opening, round up closing
  const roundedStart = Math.floor(globalEarliest / 30) * 30;
  const roundedEnd = Math.ceil(globalLatest / 30) * 30;

  return {
    openingTime: fmtTimeSlot(roundedStart),
    closingTime: fmtTimeSlot(roundedEnd),
  };
}

/** Format total minutes as "HH:MM". */
function fmtTimeSlot(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Convert a UTC ISO timestamp to Brussels local time components.
 * 
 * @param {string} isoString - ISO timestamp (e.g. "2026-08-25T07:00:00.000Z")
 * @returns {{ hour: number, minute: number }}
 */
function getBrusselTimeComponents(isoString) {
  const dt = new Date(isoString);
  
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Brussels",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  
  const parts = formatter.formatToParts(dt);
  let hour = 0, minute = 0;
  
  for (const part of parts) {
    if (part.type === "hour") hour = parseInt(part.value, 10);
    if (part.type === "minute") minute = parseInt(part.value, 10);
  }
  
  return { hour, minute };
}

/**
 * Given an appointment's startTime ISO string and the grid's opening time,
 * return the top offset in pixels based on the appointment's start time
 * relative to the opening time.
 *
 * Correctly handles timezone conversion to Europe/Brussels.
 * The calculation is: (minutesFromOpening / 60) × hourHeight
 * where hourHeight is pixels per 1-hour row.
 *
 * @param {string} startTimeISO
 * @param {string} openingTime  "HH:MM" in Brussels time
 * @param {number} hourHeight   px per 1-hour slot (default 64)
 */
export function getTopOffset(startTimeISO, openingTime = "09:00", hourHeight = 64) {
  if (!startTimeISO) return 0;
  
  const { hour: apptHour, minute: apptMinute } = getBrusselTimeComponents(startTimeISO);
  const apptMinutes = apptHour * 60 + apptMinute;
  
  const { hour: oh, minute: om } = parseTime(openingTime);
  const openMinutes = oh * 60 + om;
  
  const delta = apptMinutes - openMinutes;
  
  // 1 hour = hourHeight px  →  px per minute = hourHeight / 60
  return Math.max(0, (delta * hourHeight) / 60);
}

/**
 * Return the event height in pixels based on its real duration.
 * Duration is computed from the actual UTC instant difference (timezone-correct),
 * so a 09:00→12:00 Brussels appointment is exactly 3 hours tall regardless of
 * the viewer's device timezone.
 *
 * Height is exact: 1 hour = hourHeight px (e.g. 09:00→12:00 = 3 × hourHeight).
 * If start and end times are the same or duration is invalid, returns a minimum
 * height of 1 hour to ensure visibility.
 *
 * @param {string} startTimeISO
 * @param {string} endTimeISO
 * @param {number} hourHeight   px per 1-hour slot (default 64)
 */
export function getEventHeight(startTimeISO, endTimeISO, hourHeight = 64) {
  if (!startTimeISO || !endTimeISO) return hourHeight; // fallback: 1 hour
  const start = new Date(startTimeISO);
  const end = new Date(endTimeISO);
  const durationMin = (end - start) / 60000;
  
  // If duration is 0 or negative (same time or invalid), return minimum height (1 hour)
  if (durationMin <= 0) return hourHeight;
  
  return (durationMin * hourHeight) / 60;
}

/**
 * Minutes-since-midnight of an ISO instant interpreted in Europe/Brussels.
 * Use this (NOT Date.getHours()*60 + Date.getMinutes()) for overlap/column
 * math so it stays consistent with getTopOffset/getEventHeight, which are
 * also Brussels-based. Returns null when the instant is missing.
 */
export function getBrusselsMinutesOfDay(isoString) {
  if (!isoString) return null;
  const { hour, minute } = getBrusselTimeComponents(isoString);
  return hour * 60 + minute;
}

// ─── Appointment grouping ─────────────────────────────────────────────────────

/**
 * TIMEZONE STRATEGY FOR MERI BEAUTY CALENDAR
 * ============================================
 * 
 * Meri Beauty is a single-location, single-timezone (Europe/Brussels) business.
 * All calendar logic must judge "which day" an appointment belongs on using
 * Brussels wall-clock time, NEVER the viewing device's timezone.
 * 
 * Background:
 * - `appt.date` and `appt.startTime`/`appt.endTime` are stored as UTC ISO strings
 * - Example: A 09:00 Brussels appointment is stored as "07:00Z" (summer) or "08:00Z" (winter)
 * - Using plain Date methods like getFullYear/getMonth/getDate() re-interprets the UTC
 *   instant through the device's local timezone — correct for Brussels devices, but wrong
 *   (off by a day for appointments near midnight) on devices set to other timezones.
 * 
 * Solution:
 * - Use brusselsDateKey() to compare UTC timestamps in Brussels timezone
 * - Use localDateKey() for grid cells (pure calendar math with no UTC instant)
 * - All appointment/event filtering uses brusselsDateKey() for accuracy
 * - All closure date checking uses brusselsDateKey() for consistency
 * 
 * Grid cells (weeks, months, days) are pure calendar arithmetic with no real instant,
 * so they use localDateKey() which is device-timezone agnostic.
 */

// Meri Beauty is a single-location, single-timezone (Europe/Brussels)
// business — "which day" an appointment belongs on must always be judged by
// Brussels wall-clock time, never by the viewing device's own clock/OS
// timezone. `appt.date`/`ev.start` are real UTC instants (e.g. a 09:00
// Brussels appointment is stored as "07:00Z" in summer, "08:00Z" in winter);
// reading them back with plain getFullYear/getMonth/getDate() re-interprets
// that instant through *whatever timezone the browser happens to be set to*
// — correct for a Brussels-based device, silently wrong (by a day, for
// appointments near midnight, or just by presence in edge cases) on any
// device set to a different timezone, which is exactly the kind of
// misconfiguration a staff laptop can have without anyone noticing. The
// calendar GRID's own day cells (built in calendarUtils' getMonthGrid/
// getWeekDays below) are pure local calendar arithmetic with no real
// instant behind them, so they don't need this — only real timestamps do.
const BRUSSELS_TZ = "Europe/Brussels";
const brusselsKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: BRUSSELS_TZ });

function brusselsDateKey(date) {
  return brusselsKeyFormatter.format(date); // "YYYY-MM-DD"
}

function localDateKey(date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

/**
 * Return only appointments whose `date` field falls on `targetDate`,
 * comparing calendar days in Europe/Brussels regardless of the viewer's
 * device timezone.
 *
 * @param {Array<object>} appointments
 * @param {Date} targetDate
 */
export function appointmentsForDay(appointments, targetDate) {
  const targetKey = localDateKey(targetDate);

  return appointments.filter((appt) => {
    if (!appt.date) return false;
    return brusselsDateKey(new Date(appt.date)) === targetKey;
  });
}

/**
 * Return only activity events (ateliers/formations, shaped by
 * getCalendarEvents — { start, end, ... }, no "date" field) whose start
 * falls on `targetDate`, compared in Europe/Brussels (see appointmentsForDay).
 *
 * @param {Array<{ start: string }>} events
 * @param {Date} targetDate
 */
export function activityEventsForDay(events, targetDate) {
  const targetKey = localDateKey(targetDate);

  return events.filter((ev) => {
    if (!ev.start) return false;
    return brusselsDateKey(new Date(ev.start)) === targetKey;
  });
}

// ─── Label formatters ─────────────────────────────────────────────────────────

const FR_DAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const FR_DAYS_LONG = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const FR_MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const FR_MONTHS_SHORT = [
  "jan", "fév", "mar", "avr", "mai", "jun",
  "jul", "août", "sep", "oct", "nov", "déc",
];

export function formatDayHeader(date) {
  // "Lun. 4 août"
  return `${FR_DAYS_SHORT[date.getDay()]}. ${date.getDate()} ${FR_MONTHS_SHORT[date.getMonth()]}`;
}

export function formatDayFull(date) {
  return `${FR_DAYS_LONG[date.getDay()]} ${date.getDate()} ${FR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatWeekLabel(date) {
  const days = getWeekDays(date);
  const start = days[0];
  const end = days[6];
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} ${FR_MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${FR_MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${FR_MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

export function formatMonthLabel(date) {
  return `${FR_MONTHS[date.getMonth()].charAt(0).toUpperCase()}${FR_MONTHS[date.getMonth()].slice(1)} ${date.getFullYear()}`;
}

export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date) {
  return isSameDay(date, new Date());
}

// ─── Staff / TimeOff helpers ──────────────────────────────────────────────────

/**
 * Return the working-hours record for a staff member on a given day.
 *
 * @param {Array<{ day: string, startTime: string, endTime: string, isClosed: boolean }>} workingHours
 * @param {Date} date
 * @returns {{ startTime: string, endTime: string } | null}  null when staff is closed
 */
export function getStaffWorkingHoursForDay(workingHours, date) {
  const dayName = JS_TO_WEEKDAY[date.getDay()];
  const wh = (workingHours || []).find((w) => w.day === dayName);
  if (!wh || wh.isClosed) return null;
  return { startTime: wh.startTime, endTime: wh.endTime };
}

/**
 * Return time-offs that overlap a given calendar day.
 *
 * @param {Array<{ id: string, startDate: string, endDate: string, isFullDay: boolean, reason: string | null }>} timeOffs
 * @param {Date} targetDate
 * @returns {Array<object>}
 */
export function timeOffsForDay(timeOffs, targetDate) {
  if (!timeOffs || timeOffs.length === 0) return [];
  const targetKey = localDateKey(targetDate);
  return timeOffs.filter((to) => {
    const startKey = brusselsDateKey(new Date(to.startDate));
    const endKey = brusselsDateKey(new Date(to.endDate));
    return targetKey >= startKey && targetKey <= endKey;
  });
}

/**
 * Compute the availability status text for a staff member on a specific day.
 *
 * @param {object}  staffMember  – { workingHours[], timeOffs[] }
 * @param {Date}    date
 * @returns {{ label: string, kind: "open" | "closed" | "unavailable" }}
 */
export function getStaffAvailabilityStatus(staffMember, date) {
  const wh = getStaffWorkingHoursForDay(staffMember.workingHours || [], date);
  if (!wh) {
    return { label: "Fermé", kind: "closed" };
  }

  const dayTimeOffs = timeOffsForDay(staffMember.timeOffs || [], date);
  const hasFullDayOff = dayTimeOffs.some((to) => to.isFullDay !== false);
  if (hasFullDayOff) {
    return { label: "Indisponible", kind: "unavailable" };
  }

  return { label: "Disponible", kind: "open" };
}

/**
 * Build the displayed time range string for a staff member on a day.
 *
 * @param {object} staffMember
 * @param {Date}   date
 * @returns {string}  e.g. "09:00 – 18:00" or "Fermé"
 */
export function staffWorkingHoursLabel(staffMember, date) {
  const wh = getStaffWorkingHoursForDay(staffMember.workingHours || [], date);
  if (!wh) return "Fermé";
  return `${wh.startTime} – ${wh.endTime}`;
}

/**
 * Check if a date falls within a salon closure period.
 * Handles full-day closures (endDate omitted) and partial closures (date range).
 * Uses Brussels timezone for accurate date comparison.
 *
 * @param {Date} date - The date to check
 * @param {Array<{ startDate: string, endDate?: string }>} closures - Salon closures from getSalon()
 * @returns {boolean} - True if the date is a closure day
 */
export function isClosureDay(date, closures = []) {
  if (!closures || closures.length === 0) return false;
  
  const dateKey = localDateKey(date);
  
  return closures.some((closure) => {
    // Parse closure dates in Brussels timezone to match appointment comparison logic
    const startKey = brusselsDateKey(new Date(closure.startDate));
    const endKey = closure.endDate
      ? brusselsDateKey(new Date(closure.endDate))
      : startKey; // Full-day closure if endDate is missing
    
    return dateKey >= startKey && dateKey <= endKey;
  });
}
