/**
 * Which calendar days a staff member works — her weekly WorkingHour template,
 * its week-of-month rule, and the one-day exceptions (WorkingDayOverride).
 *
 *  - WorkingHour.weeksOfMonth: the occurrences of that weekday in the month
 *    she works (1 = the month's first Monday … 4 = its fourth). Empty = the
 *    four of them. Set once in « Définir les horaires de travail » — two
 *    staff members can share Saturdays (Julie the 1st and 3rd, Lyly the 2nd
 *    and 4th).
 *  - A 5th occurrence (a month's 5th Saturday) is NEVER in the rule, even
 *    for a staff member who works every week: it is extra work Marie agrees
 *    with someone directly (paid outside the app, sometimes). It belongs to
 *    nobody until Marie gives it to one or several of the staff members who
 *    work that weekday — an override isWorking true (actions/staff/fifth-day.js).
 *  - An override isWorking false still closes a day if one exists.
 *
 * Every availability check resolves a day's hours through workingHourForDate
 * / workingHourForDateKey. Pure — safe in client and server components.
 */

const WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKS_OF_MONTH = [1, 2, 3, 4];

function pad(n) {
  return String(n).padStart(2, "0");
}

export function isWorkingDayDateKey(value) {
  return typeof value === "string" && DATE_KEY.test(value);
}

/**
 * "YYYY-MM-DD" of a Date, read in the same frame as Date.getDay() — the frame
 * the availability code already reads weekdays in (parseLocalDateString,
 * calendar dates), so a date's key and its weekday always agree.
 */
export function localDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** WeekDay enum value of a "YYYY-MM-DD" key. */
export function weekDayOfDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEK_DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Which occurrence of its weekday the day is in its month: 1–5. */
export function weekOfMonthOfDateKey(dateKey) {
  return Math.ceil(Number(dateKey.slice(8, 10)) / 7);
}

/** A rule as stored: the weeks 1–4, sorted; all four (or none) = every week = []. The 5th is never in it. */
export function normalizeWeeksOfMonth(weeks) {
  const picked = [...new Set((weeks ?? []).map(Number))].filter((w) => WEEKS_OF_MONTH.includes(w)).sort();
  return picked.length === WEEKS_OF_MONTH.length ? [] : picked;
}

/** True when she works that weekday at all (any week) — and may so be given its 5th occurrences. */
export function worksWeekday(workingHour) {
  return Boolean(workingHour && !workingHour.isClosed);
}

/** The override recorded for that day, or null. */
export function overrideForDateKey(overrides, dateKey) {
  return (overrides || []).find((o) => o.dateKey === dateKey) ?? null;
}

/**
 * A staff member's hours on one calendar day: the override first, then the
 * template and its week-of-month rule.
 *
 * @param {Array<{ day: string, startTime: string, endTime: string, isClosed: boolean, weeksOfMonth?: number[] }>} workingHours
 * @param {Array<{ dateKey: string, isWorking: boolean, startTime?: string|null, endTime?: string|null }>} overrides
 * @param {string} dateKey - "YYYY-MM-DD"
 * @returns {{ day: string, startTime: string, endTime: string, isClosed: false } | null} null when she does not work
 */
export function workingHourForDateKey(workingHours, overrides, dateKey) {
  const day = weekDayOfDateKey(dateKey);
  const override = overrideForDateKey(overrides, dateKey);
  const wh = (workingHours || []).find((w) => w.day === day);
  if (override) {
    if (!override.isWorking) return null;
    if (override.startTime && override.endTime) {
      return { day, startTime: override.startTime, endTime: override.endTime, isClosed: false };
    }
    if (wh && !wh.isClosed) return wh;
  }
  if (!wh || wh.isClosed) return null;
  const week = weekOfMonthOfDateKey(dateKey);
  // The 5th occurrence is only ever worked when it was given to her (above).
  if (week === 5) return null;
  const weeks = wh.weeksOfMonth ?? [];
  if (weeks.length > 0 && !weeks.includes(week)) return null;
  return wh;
}

/** workingHourForDateKey for a Date (see localDateKey for the frame). */
export function workingHourForDate(workingHours, overrides, date) {
  return workingHourForDateKey(workingHours, overrides, localDateKey(date));
}

/**
 * True when the day falls on a weekday she normally works but is not hers:
 * not one of her weeks, a 5th occurrence not assigned to her, or closed by
 * an override. A weekday she never works is NOT "given away".
 */
export function isDayGivenAway(workingHours, overrides, dateKey) {
  const wh = (workingHours || []).find((w) => w.day === weekDayOfDateKey(dateKey));
  if (!wh || wh.isClosed) return overrideForDateKey(overrides, dateKey)?.isWorking === false;
  return !workingHourForDateKey(workingHours, overrides, dateKey);
}
