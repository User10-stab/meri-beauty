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
 * at 30-minute intervals.
 * @param {string} openingTime   "HH:MM"
 * @param {string} closingTime   "HH:MM"
 * @returns {string[]}  e.g. ["09:00", "09:30", "10:00", ...]
 */
export function buildTimeSlots(openingTime = "09:00", closingTime = "19:00") {
  const slots = [];
  const { hour: startH, minute: startM } = parseTime(openingTime);
  const { hour: endH, minute: endM } = parseTime(closingTime);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  for (let m = startMin; m <= endMin; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

/**
 * Given an appointment's startTime ISO string and the grid's opening time,
 * return the top offset in pixels (60px per hour = 1px per minute).
 *
 * @param {string} startTimeISO
 * @param {string} openingTime  "HH:MM"
 * @param {number} slotHeight   px per 30-min slot (default 60)
 */
export function getTopOffset(startTimeISO, openingTime = "09:00", slotHeight = 60) {
  if (!startTimeISO) return 0;
  const dt = new Date(startTimeISO);
  const apptMinutes = dt.getHours() * 60 + dt.getMinutes();
  const { hour: oh, minute: om } = parseTime(openingTime);
  const openMinutes = oh * 60 + om;
  const delta = apptMinutes - openMinutes;
  // slotHeight px = 30 min  →  px per minute = slotHeight / 30
  return Math.max(0, (delta * slotHeight) / 30);
}

/**
 * Return the appointment height in pixels based on its duration.
 *
 * @param {string} startTimeISO
 * @param {string} endTimeISO
 * @param {number} slotHeight   px per 30-min slot (default 60)
 */
export function getEventHeight(startTimeISO, endTimeISO, slotHeight = 60) {
  if (!startTimeISO || !endTimeISO) return slotHeight; // default 30 min
  const start = new Date(startTimeISO);
  const end = new Date(endTimeISO);
  const durationMin = (end - start) / 60000;
  return Math.max(slotHeight / 2, (durationMin * slotHeight) / 30);
}

// ─── Appointment grouping ─────────────────────────────────────────────────────

/**
 * Return only appointments whose `date` field falls on `targetDate`.
 *
 * @param {Array<object>} appointments
 * @param {Date} targetDate
 */
export function appointmentsForDay(appointments, targetDate) {
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const d = targetDate.getDate();

  return appointments.filter((appt) => {
    if (!appt.date) return false;
    const dt = new Date(appt.date);
    return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
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
