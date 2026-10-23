/**
 * Which calendar days a staff member works — her weekly WorkingHour template,
 * its week-of-month rule, and the one-day exceptions (WorkingDayOverride).
 *
 *  - WorkingHour.weeksOfMonth: the occurrences of that weekday in the month
 *    she works (1 = the month's first Monday … 5 = its fifth). Empty = the
 *    first four. Set once in « Définir les horaires de travail » — two staff
 *    members can share Saturdays (Julie the 1st and 3rd, Lyly the 2nd and
 *    4th).
 *  - The 5th occurrence (a month's 5th Saturday) is extra work beyond the
 *    usual four weeks: hers only when Marie ticked « 5e » for that weekday.
 *    Since 2026-10-23 that tick is the rule — Marie no longer has to give
 *    each 5th day by hand.
 *  - A one-day exception (override) wins over the rule, both ways: give one
 *    5th day to someone without « 5e » (isWorking true), or take one away
 *    from someone with it (isWorking false). See actions/staff/fifth-day.js.
 *
 * Every availability check resolves a day's hours through workingHourForDate
 * / workingHourForDateKey. Pure — safe in client and server components.
 */

const WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKS_OF_MONTH = [1, 2, 3, 4, 5];
/** What an empty rule means: the first four weeks, not the 5th. */
const DEFAULT_WEEKS = [1, 2, 3, 4];

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

/** A rule as stored: the weeks 1–5, sorted; exactly the first four (or none) = [] (the default). */
export function normalizeWeeksOfMonth(weeks) {
  const picked = [...new Set((weeks ?? []).map(Number))].filter((w) => WEEKS_OF_MONTH.includes(w)).sort();
  return picked.join() === DEFAULT_WEEKS.join() ? [] : picked;
}

/** The weeks a rule covers, the empty default spelled out. */
export function weeksOfRule(workingHour) {
  return workingHour?.weeksOfMonth?.length ? workingHour.weeksOfMonth : DEFAULT_WEEKS;
}

/** True when she works that weekday at all (any week) — and may so be given its 5th occurrences. */
export function worksWeekday(workingHour) {
  return Boolean(workingHour && !workingHour.isClosed);
}

/** True when her rule for that weekday includes its 5th occurrences (« 5e » ticked). */
export function worksFifthByRule(workingHour) {
  return worksWeekday(workingHour) && weeksOfRule(workingHour).includes(5);
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
  if (!weeksOfRule(wh).includes(weekOfMonthOfDateKey(dateKey))) return null;
  return wh;
}

/** workingHourForDateKey for a Date (see localDateKey for the frame). */
export function workingHourForDate(workingHours, overrides, date) {
  return workingHourForDateKey(workingHours, overrides, localDateKey(date));
}

/**
 * True when the day falls on a weekday she normally works but is not hers:
 * not one of her weeks (a 5th occurrence without « 5e »), or taken away by
 * an override. A weekday she never works is NOT "given away".
 */
export function isDayGivenAway(workingHours, overrides, dateKey) {
  const wh = (workingHours || []).find((w) => w.day === weekDayOfDateKey(dateKey));
  if (!wh || wh.isClosed) return overrideForDateKey(overrides, dateKey)?.isWorking === false;
  return !workingHourForDateKey(workingHours, overrides, dateKey);
}
