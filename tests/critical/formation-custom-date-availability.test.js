import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  addDaysToDateKey,
  customDatePerDayMinutes,
  customDateWindows,
  customSessionWindows,
  formatSessionDateRange,
  freeStartTimes,
  isDateKey,
  sessionDayCount,
} from "@/lib/formations/custom-date-availability";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// « Date libre » (2026-10-02): a private formation's client picks her own day,
// for one journée or two, among the days its animator is free. These pin the
// calendar arithmetic — what is offered and what is not — independently of
// the database. 23/11/2026 is a Monday, in winter time (Brussels = UTC+1).

const MONDAY = "2026-11-23";
const SATURDAY = "2026-11-28";
const SUNDAY = "2026-11-22";
const BEFORE = new Date("2026-10-01T08:00:00Z");

// Marie's real week: Monday to Saturday 10:00–20:00, closed on Sunday.
const WORKING_HOURS = [
  ...["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"].map((day) => ({
    day,
    startTime: "10:00",
    endTime: "20:00",
    isClosed: false,
  })),
  { day: "SUNDAY", startTime: "10:00", endTime: "20:00", isClosed: true },
];

/** A Brussels winter wall-clock time on a given day, as an instant. */
const at = (dateKey, time) => new Date(`${dateKey}T${time}:00+01:00`);

function times({ dateKey = MONDAY, days = 1, durationMinutes = 240, busy = [], now = BEFORE, workingHours = WORKING_HOURS } = {}) {
  return freeStartTimes({ dateKey, days, durationMinutes, workingHours, busy, now });
}

describe("date libre — which start times a day offers", () => {
  test("the fixture dates are the weekdays the tests assume", () => {
    const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay();
    expect(weekday(MONDAY)).toBe(1);
    expect(weekday(SATURDAY)).toBe(6);
    expect(weekday(SUNDAY)).toBe(0);
  });

  test("a free working day offers every half hour the formation still fits in", () => {
    // 10:00–20:00 with an 8h formation: the last start is 12:00.
    expect(times({ durationMinutes: 480 })).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00"]);
  });

  test("a formation longer than the working day is never offered", () => {
    expect(times({ durationMinutes: 601 })).toEqual([]);
  });

  test("a weekday the animator does not work is never offered", () => {
    expect(times({ dateKey: SUNDAY })).toEqual([]);
    expect(times({ workingHours: [] })).toEqual([]);
  });

  test("a full-day indisponibilité (or jour férié) closes the day", () => {
    const busy = [{ start: at(MONDAY, "00:00"), end: at(MONDAY, "23:59") }];
    expect(times({ busy })).toEqual([]);
    // …and only that day.
    expect(times({ dateKey: "2026-11-24", busy }).length).toBeGreaterThan(0);
  });

  test("a rendez-vous only removes the start times that would overlap it", () => {
    // 14:00–15:00 taken, 4h formation: 10:00–14:00 touches it and is fine,
    // anything from 10:30 to 14:30 collides, 15:00 onwards is free again.
    const busy = [{ start: at(MONDAY, "14:00"), end: at(MONDAY, "15:00") }];
    expect(times({ busy })).toEqual(["10:00", "15:00", "15:30", "16:00"]);
  });

  test("a day already begun only offers what is still ahead, and a past day nothing", () => {
    expect(times({ now: at(MONDAY, "12:10") })).toEqual(["12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]);
    expect(times({ now: at("2026-11-24", "09:00") })).toEqual([]);
  });

  test("malformed input offers nothing rather than throwing", () => {
    expect(times({ dateKey: "2026-02-30" })).toEqual([]);
    expect(times({ days: 3 })).toEqual([]);
    expect(times({ durationMinutes: 0 })).toEqual([]);
    expect(isDateKey("2026-11-23")).toBe(true);
    expect(isDateKey("23/11/2026")).toBe(false);
  });
});

describe("date libre — the duration is the formation's total", () => {
  test("one journée runs it whole, two journées split it in half", () => {
    expect(customDatePerDayMinutes(240, 1)).toBe(240);
    expect(customDatePerDayMinutes(240, 2)).toBe(120);
    expect(customDatePerDayMinutes(900, 2)).toBe(450);
    expect(customDatePerDayMinutes(425, 2)).toBe(213);
    expect(customDatePerDayMinutes(0, 2)).toBe(0);
  });

  test("a formation longer than a working day is never one journée, only two", () => {
    // 15 h against a 10 h day: nothing on one day, 7 h 30 a day on two.
    expect(times({ days: 1, durationMinutes: customDatePerDayMinutes(900, 1) })).toEqual([]);
    expect(times({ days: 2, durationMinutes: customDatePerDayMinutes(900, 2) })).toEqual(
      ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30"],
    );
  });

  test("the calendar and the booking both use that per-day length", () => {
    const availability = source("lib/formations/custom-date-availability.js");
    expect(availability.split("customDatePerDayMinutes(formation.duration, ").length - 1).toBe(5);
    expect(availability).toContain("if (!one && !two) continue;");
  });
});

describe("date libre — two journées", () => {
  test("two days are offered when the next day is free at the same hours", () => {
    expect(times({ days: 2 })).toEqual(times({ days: 1 }));
  });

  test("the second day being taken refuses two journées but keeps one", () => {
    const busy = [{ start: at("2026-11-24", "00:00"), end: at("2026-11-24", "23:59") }];
    expect(times({ days: 1, busy }).length).toBeGreaterThan(0);
    expect(times({ days: 2, busy })).toEqual([]);
  });

  test("a start time must be free on BOTH days", () => {
    // Day 2 has a rendez-vous at 10:00–11:00: starting at 10:00 or 10:30 is
    // fine on day 1 alone, but not for the two-day booking.
    const busy = [{ start: at("2026-11-24", "10:00"), end: at("2026-11-24", "11:00") }];
    expect(times({ days: 1, busy })).toContain("10:00");
    expect(times({ days: 2, busy })).toEqual(["11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00"]);
  });

  test("a second day that is not worked (Saturday → Sunday) refuses two journées", () => {
    expect(times({ dateKey: SATURDAY, days: 1 }).length).toBeGreaterThan(0);
    expect(times({ dateKey: SATURDAY, days: 2 })).toEqual([]);
  });

  test("each day keeps the same wall-clock hours, across the winter-time change too", () => {
    // 24–25/10/2026: the clocks go back in the night between the two days.
    const windows = customDateWindows({ dateKey: "2026-10-24", time: "10:00", days: 2, durationMinutes: 240 });
    expect(windows.map((w) => [w.start.toISOString(), w.end.toISOString()])).toEqual([
      ["2026-10-24T08:00:00.000Z", "2026-10-24T12:00:00.000Z"],
      ["2026-10-25T09:00:00.000Z", "2026-10-25T13:00:00.000Z"],
    ]);
  });

  test("a stored session gives back the day windows it was booked with", () => {
    const booked = customDateWindows({ dateKey: MONDAY, time: "10:30", days: 2, durationMinutes: 300 });
    const session = { startDate: booked[0].start, endDate: booked[1].end };
    expect(customSessionWindows(session)).toEqual(booked);
    expect(sessionDayCount(session)).toBe(2);
    expect(sessionDayCount({ startDate: booked[0].start, endDate: booked[0].end })).toBe(1);
    expect(formatSessionDateRange(session).multiDay).toBe(true);
    expect(formatSessionDateRange(session).days).toBe("lundi 23 novembre 2026 et mardi 24 novembre 2026");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

// The rules that live in the database paths — pinned at the source level, the
// same way the other formation contracts are.
describe("date libre — the rules around the calendar", () => {
  const availability = source("lib/formations/custom-date-availability.js");
  const booking = source("actions/formations/create-formation-reservation.js");
  const fulfilment = source("lib/formations/fulfill-formation-reservation-payment.js");
  const formationActions = source("actions/formations/create-formation.js");

  test("the calendar reads working hours, indisponibilités, closures, rendez-vous and sessions", () => {
    for (const read of ["db.appointment.findMany", "db.timeOff.findMany", "db.salonClosure.findMany", "db.formationSession.findMany", "db.workshopSession.findMany"]) {
      expect(availability).toContain(read);
    }
    expect(availability).toContain("workingHours");
  });

  test("another client's picked date only blocks once it is paid", () => {
    expect(availability).toContain("{ OR: [{ customerRequested: false }, { reservations: { some: liveSeatFilter() } }] }");
  });

  test("only a private formation takes a date libre, and the date is re-validated server-side", () => {
    expect(booking).toContain('formation.type !== "PRIVATE"');
    expect(booking).toContain("resolveCustomDateRequest(prisma, { formation, customDate })");
    // The session is created with the hold, flagged, for one person.
    expect(booking).toContain("customerRequested: true");
    // Another client's own date cannot be booked through its session id.
    expect(booking).toContain("session.customerRequested");
  });

  test("the payment that confirms the date re-checks the calendar first", () => {
    const check = fulfilment.indexOf("customSessionConflict(tx, reservation.session)");
    const confirm = fulfilment.indexOf('data: { status: "CONFIRMED", holdExpiresAt: null }');
    expect(check).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(check);
    expect(fulfilment).toContain('"CUSTOM_DATE_TAKEN"');
    expect(fulfilment).toContain("date libre devenue indisponible avant la confirmation du paiement");
  });

  test("a private formation can be published with no date; a group one cannot", () => {
    expect(formationActions).toContain('return data.status === "PUBLISHED" && data.type !== "PRIVATE";');
    expect(formationActions).toContain("requiresScheduledSession(rest) && sessions.length === 0");
  });

  test("saving the formation form never deletes a date a client picked", () => {
    expect(formationActions).toContain("include: { sessions: { where: { customerRequested: false } } }");
  });
});
