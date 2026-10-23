import { describe, expect, test } from "vitest";
import { buildAvailabilityForDate } from "@/lib/slot-availability";
import { freeStartTimes } from "@/lib/formations/custom-date-availability";
import { getStaffAvailabilityStatus } from "@/components/dashboard/calendar/calendarUtils";
import {
  isDayGivenAway,
  normalizeWeeksOfMonth,
  weekOfMonthOfDateKey,
  workingHourForDateKey,
  worksFifthByRule,
} from "@/lib/working-day-overrides";

// 2026-10-22: the weekly template (« Lundi 10:00–18:00 ») could not say "not
// this Monday" or "this one Wednesday too". Marie now blocks or adds single
// dates in « Définir les horaires de travail » (WorkingDayOverride), and every
// availability check must read them before the template.

/** Server-local wall clock, the convention lib/slot-availability.js works in. */
const local = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0, 0);

// Julie: lundi, mardi, vendredi 10:00–18:00.
const WORKING_HOURS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].map((day) => {
  const works = ["MONDAY", "TUESDAY", "FRIDAY"].includes(day);
  return { day, startTime: works ? "10:00" : "00:00", endTime: works ? "18:00" : "00:00", isClosed: !works };
});

// Monday 02/11 blocked, Wednesday 04/11 added 09:00–17:00.
const OVERRIDES = [
  { dateKey: "2026-11-02", isWorking: false, startTime: null, endTime: null },
  { dateKey: "2026-11-04", isWorking: true, startTime: "09:00", endTime: "17:00" },
];

function staffService(overrides) {
  return {
    duration: 60,
    availableDays: [],
    staff: {
      isActive: true,
      isDeleted: false,
      user: { isDeleted: false },
      workingHours: WORKING_HOURS,
      workingDayOverrides: overrides,
      timeOffs: [],
      contracts: [{ status: "ACTIVE", startDate: local(2020, 1, 1), endDate: null }],
    },
  };
}

const availabilityOn = (date, overrides = OVERRIDES) =>
  buildAvailabilityForDate({ staffService: staffService(overrides), selectedDate: date, salon: null, existingAppointments: [] });

describe("rendez-vous booking reads the day overrides", () => {
  test("a blocked usual day offers nothing", () => {
    const result = availabilityOn(local(2026, 11, 2));
    expect(result.isWorkingDay).toBe(false);
    expect(result.reservationWindows).toEqual([]);
  });

  test("the same weekday without an override still follows the template", () => {
    const result = availabilityOn(local(2026, 11, 9));
    expect(result.isWorkingDay).toBe(true);
    expect(result.workingHours).toEqual({ start: "10:00", end: "18:00" });
  });

  test("an added day off is bookable, with the added day's hours", () => {
    const result = availabilityOn(local(2026, 11, 4));
    expect(result.isWorkingDay).toBe(true);
    expect(result.workingHours).toEqual({ start: "09:00", end: "17:00" });
    expect(result.reservationWindows.length).toBeGreaterThan(0);
  });

  test("the other Wednesdays stay closed", () => {
    expect(availabilityOn(local(2026, 11, 11)).isWorkingDay).toBe(false);
  });

  test("no overrides loaded behaves exactly like before", () => {
    expect(availabilityOn(local(2026, 11, 2), null).isWorkingDay).toBe(true);
    expect(availabilityOn(local(2026, 11, 4), null).isWorkingDay).toBe(false);
  });
});

describe("the other readers agree", () => {
  test("formation « date libre » start times", () => {
    const args = { days: 1, durationMinutes: 60, workingHours: WORKING_HOURS, overrides: OVERRIDES, busy: [], now: new Date("2026-10-01T00:00:00Z") };
    expect(freeStartTimes({ ...args, dateKey: "2026-11-02" })).toEqual([]);
    expect(freeStartTimes({ ...args, dateKey: "2026-11-04" })[0]).toBe("09:00");
  });

  test("dashboard calendar status", () => {
    const member = { workingHours: WORKING_HOURS, workingDayOverrides: OVERRIDES, timeOffs: [] };
    expect(getStaffAvailabilityStatus(member, local(2026, 11, 2)).kind).toBe("closed");
    expect(getStaffAvailabilityStatus(member, local(2026, 11, 4)).kind).toBe("open");
  });

  test("an added day without hours falls back to the template", () => {
    expect(workingHourForDateKey(WORKING_HOURS, [{ dateKey: "2026-11-03", isWorking: true }], "2026-11-03")?.startTime).toBe("10:00");
  });
});

// 2026-10-22: a weekday can be worked only some weeks of the month — Julie the
// 1st and 3rd Saturdays, Lyly the 2nd and 4th — set once in « Définir les
// horaires de travail ». A month's 5th Saturday is in nobody's rule — not even
// « every week »: it is extra work Marie agrees directly, so it is nobody's
// until she gives it (an override isWorking true).
describe("weeks of the month", () => {
  // November 2026: Saturdays 7 (1st), 14 (2nd), 21 (3rd), 28 (4th). August
  // 2026 has a 5th: the 29th.
  const julie = [{ day: "SATURDAY", startTime: "09:00", endTime: "18:00", isClosed: false, weeksOfMonth: [1, 3] }];
  const lyly = [{ day: "SATURDAY", startTime: "10:00", endTime: "19:00", isClosed: false, weeksOfMonth: [2, 4] }];
  const marie = [{ day: "SATURDAY", startTime: "10:00", endTime: "20:00", isClosed: false, weeksOfMonth: [] }];

  test("a day's rank in its month", () => {
    expect(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28", "2026-08-29"].map(weekOfMonthOfDateKey)).toEqual([1, 2, 3, 4, 5]);
  });

  test("each staff member works only her own Saturdays", () => {
    const works = (hours, key) => Boolean(workingHourForDateKey(hours, [], key));
    expect(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map((k) => works(julie, k))).toEqual([true, false, true, false]);
    expect(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map((k) => works(lyly, k))).toEqual([false, true, false, true]);
  });

  test("the 5th Saturday is nobody's, until it is given", () => {
    expect(workingHourForDateKey(julie, [], "2026-08-29")).toBeNull();
    expect(workingHourForDateKey(lyly, [], "2026-08-29")).toBeNull();
    const given = [{ dateKey: "2026-08-29", isWorking: true, startTime: "09:00", endTime: "18:00" }];
    expect(workingHourForDateKey(julie, given, "2026-08-29")?.startTime).toBe("09:00");
  });

  test("every week (empty rule) does NOT include the 5th — « 5e » is a tick of its own", () => {
    expect(workingHourForDateKey(marie, [], "2026-08-29")).toBeNull();
    expect(workingHourForDateKey(marie, [], "2026-08-22")?.startTime).toBe("10:00");
    const given = [{ dateKey: "2026-08-29", isWorking: true, startTime: "10:00", endTime: "20:00" }];
    expect(workingHourForDateKey(marie, given, "2026-08-29")?.startTime).toBe("10:00");
  });

  test("a rule is stored sorted, and exactly the first four weeks are stored as the default", () => {
    expect(normalizeWeeksOfMonth([3, 1, 3])).toEqual([1, 3]);
    expect(normalizeWeeksOfMonth([4, 3, 2, 1])).toEqual([]);
    expect(normalizeWeeksOfMonth([5, 4, 3, 2, 1])).toEqual([1, 2, 3, 4, 5]);
    expect(normalizeWeeksOfMonth([0, 6, 5, 2])).toEqual([2, 5]);
  });

  // 2026-10-23: « 5e » ticked = the 5th occurrences are hers too, by rule —
  // Marie no longer gives them one by one. A one-day override still wins.
  test("« 5e » ticked: every 5th Saturday is hers, with no action each month", () => {
    const julieFifth = [{ ...julie[0], weeksOfMonth: [1, 3, 5] }];
    expect(workingHourForDateKey(julieFifth, [], "2026-08-29")?.startTime).toBe("09:00");
    expect(workingHourForDateKey(julieFifth, [], "2026-10-31")?.startTime).toBe("09:00");
    expect(workingHourForDateKey(julieFifth, [], "2026-11-14")).toBeNull(); // still not her 2nd
    expect(isDayGivenAway(julieFifth, [], "2026-08-29")).toBe(false);
    expect(worksFifthByRule(julieFifth[0])).toBe(true);
    expect(worksFifthByRule(julie[0])).toBe(false);
    expect(worksFifthByRule({ ...julieFifth[0], isClosed: true })).toBe(false);
  });

  test("a one-day exception takes one 5th day away from « 5e », and only that one", () => {
    const julieFifth = [{ ...julie[0], weeksOfMonth: [1, 3, 5] }];
    const takenAway = [{ dateKey: "2026-08-29", isWorking: false }];
    expect(workingHourForDateKey(julieFifth, takenAway, "2026-08-29")).toBeNull();
    expect(isDayGivenAway(julieFifth, takenAway, "2026-08-29")).toBe(true);
    expect(workingHourForDateKey(julieFifth, takenAway, "2026-10-31")?.startTime).toBe("09:00");
  });

  test("only « 5e »: she works the 5th occurrences and nothing else", () => {
    const fifthOnly = [{ ...lyly[0], weeksOfMonth: [5] }];
    expect(workingHourForDateKey(fifthOnly, [], "2026-08-29")?.startTime).toBe("10:00");
    expect(["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].some((k) => workingHourForDateKey(fifthOnly, [], k))).toBe(false);
  });

  test("« given away » = her weekday but not her day; a weekday she never works is not", () => {
    expect(isDayGivenAway(julie, [], "2026-11-14")).toBe(true);
    expect(isDayGivenAway(julie, [], "2026-11-21")).toBe(false);
    expect(isDayGivenAway(julie, [], "2026-08-29")).toBe(true);
    expect(isDayGivenAway(julie, [], "2026-11-16")).toBe(false); // a Monday
  });
});
