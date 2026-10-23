import { addDaysToDateKey, brusselsDateKey } from "@/lib/formations/custom-date-availability";
import { weekDayOfDateKey, weekOfMonthOfDateKey, worksFifthByRule, worksWeekday } from "@/lib/working-day-overrides";

/**
 * A month's 5th occurrence of a weekday (its 5th Saturday, say): extra work
 * beyond the usual four weeks. It is hers when her rule for that weekday has
 * « 5e » ticked, unless Marie took that one day away; Marie can also give one
 * to a staff member without « 5e » (overrides, actions/staff/fifth-day.js).
 * A 5th day nobody has is not bookable with anyone — the dashboard warns.
 *
 * Kept out of any "use server" module — plain query-building.
 */

/** The 5th-occurrence days between two Brussels days, inclusive. */
export function fifthDayKeysBetween(fromKey, toKey) {
  const keys = [];
  for (let key = fromKey; key <= toKey; key = addDaysToDateKey(key, 1)) {
    if (weekOfMonthOfDateKey(key) === 5) keys.push(key);
  }
  return keys;
}

/**
 * Every 5th day in the window that at least one staff member could work, with
 * those staff members (the candidates; byRule = « 5e » ticked) and the ones
 * who work it — by their rule or given that day.
 *
 * @param {object} db - Prisma client or transaction client
 * @param {{ from?: string, to?: string, dateKeys?: string[] }} params
 * @returns {Promise<Array<{ dateKey: string, day: string, candidates: Array<{ staffId: string, name: string, startTime: string, endTime: string, byRule: boolean }>, assignedStaffIds: string[] }>>}
 */
export async function loadFifthDays(db, { from, to, dateKeys } = {}) {
  const keys = dateKeys ?? fifthDayKeysBetween(from, to);
  if (keys.length === 0) return [];

  const staffList = await db.staff.findMany({
    where: { isActive: true, isDeleted: false, user: { isDeleted: false, isActive: true } },
    select: {
      id: true,
      user: { select: { fullName: true } },
      workingHours: { select: { day: true, startTime: true, endTime: true, isClosed: true, weeksOfMonth: true } },
      workingDayOverrides: { where: { dateKey: { in: keys } }, select: { dateKey: true, isWorking: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const days = [];
  for (const dateKey of keys) {
    if (weekOfMonthOfDateKey(dateKey) !== 5) continue;
    const day = weekDayOfDateKey(dateKey);
    const candidates = [];
    const assignedStaffIds = [];
    for (const staff of staffList) {
      const wh = staff.workingHours.find((w) => w.day === day);
      if (!worksWeekday(wh)) continue;
      const byRule = worksFifthByRule(wh);
      candidates.push({ staffId: staff.id, name: staff.user?.fullName ?? "", startTime: wh.startTime, endTime: wh.endTime, byRule });
      const override = staff.workingDayOverrides.find((o) => o.dateKey === dateKey);
      if (override ? override.isWorking : byRule) assignedStaffIds.push(staff.id);
    }
    if (candidates.length > 0) days.push({ dateKey, day, candidates, assignedStaffIds });
  }
  return days;
}

/** The 5th days in the next `withinDays` days that nobody has been given yet. */
export async function loadUnassignedFifthDays(db, { withinDays = 21, now = new Date() } = {}) {
  const from = brusselsDateKey(now);
  const days = await loadFifthDays(db, { from, to: addDaysToDateKey(from, withinDays) });
  return days.filter((d) => d.assignedStaffIds.length === 0);
}
