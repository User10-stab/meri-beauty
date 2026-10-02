import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadStaffSessionBlocks } from "@/lib/formations/staff-session-blocks";
import { buildAvailabilityForDate, slotFitsInFreeIntervals } from "@/lib/slot-availability";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 2026-10-02: the rendez-vous booking only knew about other rendez-vous and
// indisponibilités, so a client could book a staff member in the middle of a
// formation she was giving — including a private formation a client had just
// paid for. Formation and atelier sessions now reach the slot computation as
// blocks shaped like appointments.

/** Server-local wall clock, the convention lib/slot-availability.js works in. */
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

const STAFF = { id: "staff-1", userId: "user-1", user: { email: "marie@example.test" } };

/** A Prisma stand-in returning fixed rows — the queries themselves are exercised by the e2e suite. */
function fakeDb({ formationSessions = [], workshopSessions = [] } = {}) {
  return {
    staff: { findMany: async () => [STAFF] },
    animator: { findMany: async () => [{ id: "animator-1" }] },
    appointment: { findMany: async () => [] },
    timeOff: { findMany: async () => [] },
    salonClosure: { findMany: async () => [] },
    formationSession: { findMany: async () => formationSessions },
    workshopSession: { findMany: async () => workshopSessions },
  };
}

const WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const staffService = {
  duration: 60,
  availableDays: [],
  staff: {
    isActive: true,
    isDeleted: false,
    user: { isDeleted: false },
    workingHours: WEEK.map((day) => ({ day, startTime: "10:00", endTime: "20:00", isClosed: false })),
    timeOffs: [],
    contracts: [{ status: "ACTIVE", startDate: local(2020, 1, 1), endDate: null }],
  },
};

function availabilityOn(day, blocks) {
  return buildAvailabilityForDate({
    staffService,
    selectedDate: day,
    salon: null,
    existingAppointments: blocks.filter((b) => b.date.getTime() === day.getTime()),
  });
}

describe("a formation session occupies its animator for rendez-vous booking", () => {
  const day = local(2026, 11, 23);

  test("a session becomes a block on the right staff member, shaped like an appointment", async () => {
    const db = fakeDb({
      formationSessions: [
        { startDate: local(2026, 11, 23, 13, 30), endDate: local(2026, 11, 23, 17, 30), customerRequested: true, formation: { duration: 240 } },
      ],
    });
    const blocks = await loadStaffSessionBlocks(db, { staffIds: ["staff-1"], from: day, to: local(2026, 11, 24) });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      isSessionBlock: true,
      startTime: local(2026, 11, 23, 13, 30),
      endTime: local(2026, 11, 23, 17, 30),
      staffService: { staffId: "staff-1", margin: 0 },
    });
    expect(blocks[0].date.getTime()).toBe(day.getTime());
  });

  test("no rendez-vous can be placed inside the formation, and the rest of the day stays bookable", async () => {
    const db = fakeDb({
      formationSessions: [
        { startDate: local(2026, 11, 23, 13, 30), endDate: local(2026, 11, 23, 17, 30), customerRequested: true, formation: { duration: 240 } },
      ],
    });
    const blocks = await loadStaffSessionBlocks(db, { staffIds: ["staff-1"], from: day, to: local(2026, 11, 24) });
    const { freeIntervals, allTimeSlots } = availabilityOn(day, blocks);

    // Free before 13:30 and from 17:30, nothing in between.
    expect(freeIntervals).toEqual([
      { start: 10 * 60, end: 13 * 60 + 30 },
      { start: 17 * 60 + 30, end: 20 * 60 },
    ]);
    expect(slotFitsInFreeIntervals("12:30", 60, freeIntervals)).toBe(true);
    for (const time of ["13:00", "13:30", "15:00", "17:00"]) {
      expect(slotFitsInFreeIntervals(time, 60, freeIntervals), `${time} was bookable during the formation`).toBe(false);
    }
    expect(slotFitsInFreeIntervals("17:30", 60, freeIntervals)).toBe(true);
    expect(allTimeSlots.find((slot) => slot.startTime === "14:00").available).toBe(false);
  });

  test("a scheduled session with no end time blocks the formation's duration; an atelier blocks too", async () => {
    const db = fakeDb({
      formationSessions: [{ startDate: local(2026, 11, 23, 10, 0), endDate: null, customerRequested: false, formation: { duration: 240 } }],
      workshopSessions: [{ startDate: local(2026, 11, 23, 18, 0), endDate: local(2026, 11, 23, 20, 0), workshop: { duration: 120 } }],
    });
    const blocks = await loadStaffSessionBlocks(db, { staffIds: ["staff-1"], from: day, to: local(2026, 11, 24) });
    expect(availabilityOn(day, blocks).freeIntervals).toEqual([{ start: 14 * 60, end: 18 * 60 }]);
  });

  test("a session running over two days is cut at midnight so each day gets its own block", async () => {
    const db = fakeDb({
      formationSessions: [
        { startDate: local(2026, 11, 23, 15, 0), endDate: local(2026, 11, 24, 12, 0), customerRequested: false, formation: { duration: 240 } },
      ],
    });
    const blocks = await loadStaffSessionBlocks(db, { staffIds: ["staff-1"], from: day, to: local(2026, 11, 25) });
    expect(blocks.map((b) => [b.date.getDate(), b.startTime.getHours(), b.endTime.getHours()])).toEqual([
      [23, 15, 0],
      [24, 0, 12],
    ]);
    expect(availabilityOn(day, blocks).freeIntervals).toEqual([{ start: 10 * 60, end: 15 * 60 }]);
    expect(availabilityOn(local(2026, 11, 24), blocks).freeIntervals).toEqual([{ start: 12 * 60, end: 20 * 60 }]);
  });

  test("a staff member who animates nothing gets no block", async () => {
    expect(await loadStaffSessionBlocks(fakeDb(), { staffIds: ["staff-1"], from: day, to: local(2026, 11, 24) })).toEqual([]);
    expect(await loadStaffSessionBlocks(fakeDb(), { staffIds: [], from: day, to: local(2026, 11, 24) })).toEqual([]);
  });
});

describe("every rendez-vous availability path reads the session blocks", () => {
  test.each([
    ["actions/reservation/get-available-slots.js", 2], // one day, and the month view
    ["lib/appointment-scheduling.js", 1], // the server-side re-validation of every booking
    ["actions/reservation/find-nearest-availability.js", 1],
    ["actions/reservation/get-same-day-schedule.js", 1],
  ])("%s", (path, calls) => {
    const code = source(path);
    expect(code).toContain('import { loadStaffSessionBlocks } from "@/lib/formations/staff-session-blocks";');
    expect(code.split("await loadStaffSessionBlocks(prisma, {").length - 1).toBe(calls);
  });

  test("every path that creates or moves a rendez-vous goes through that re-validation", () => {
    for (const path of [
      "actions/reservation/create-reservation.js",
      "actions/reservation/reschedule-appointment.js",
      "actions/appointment/create-manual-appointment.js",
      "actions/payment/createCheckoutSession.js",
    ]) {
      expect(source(path), path).toContain("await validateAppointmentSlot(");
    }
  });

  test("a client's own unpaid date never blocks a rendez-vous", () => {
    expect(source("lib/formations/custom-date-availability.js")).toContain(
      "{ OR: [{ customerRequested: false }, { reservations: { some: liveSeatFilter() } }] }"
    );
  });
});
