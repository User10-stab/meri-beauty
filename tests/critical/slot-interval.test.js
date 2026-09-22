import { describe, expect, test } from "vitest";
import { buildAvailabilityForDate } from "@/lib/slot-availability";

// Reservation timeline slots are generated every 15 minutes from the shared
// builder in lib/slot-availability.js — one central interval used by customer
// booking, manual booking and month availability alike. Service duration,
// TimeOff, appointment-conflict and working-hours rules are orthogonal and
// must keep working exactly as before.

function nextDateForWeekday(weekDayName) {
  const dayMap = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const targetIndex = dayMap.indexOf(weekDayName);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  while (date.getDay() !== targetIndex) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function makeStaffService({ duration = 60, timeOffs = [] } = {}) {
  const today = new Date();
  const contractStart = new Date(today);
  contractStart.setFullYear(contractStart.getFullYear() - 1);

  return {
    duration,
    availableDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    staff: {
      isActive: true,
      isDeleted: false,
      user: { isDeleted: false },
      workingHours: [{ day: "THURSDAY", startTime: "09:00", endTime: "18:00", isClosed: false }],
      timeOffs,
      contracts: [{ status: "ACTIVE", startDate: contractStart, endDate: null }],
    },
  };
}

function build({ duration, timeOffs, appointments = [] }) {
  return buildAvailabilityForDate({
    staffService: makeStaffService({ duration, timeOffs }),
    selectedDate: nextDateForWeekday("THURSDAY"),
    salon: {},
    existingAppointments: appointments,
  });
}

describe("reservation timeline uses 15-minute slots", () => {
  test("slots step every 15 minutes across working hours", () => {
    const { allTimeSlots } = build({ duration: 60 });

    // 09:00 → 18:00 at 15-minute steps = 9h * 4 = 36 slots.
    expect(allTimeSlots).toHaveLength(36);
    expect(allTimeSlots.slice(0, 5).map((s) => s.startTime)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
    ]);
    for (let i = 1; i < allTimeSlots.length; i++) {
      expect(allTimeSlots[i].startMinutes - allTimeSlots[i - 1].startMinutes).toBe(15);
    }
  });

  test("quarter-hour starts appear (10:15, 10:45, 11:15, 11:45)", () => {
    const { allTimeSlots } = build({ duration: 60 });
    const starts = new Set(allTimeSlots.map((s) => s.startTime));

    for (const t of ["10:15", "10:45", "11:15", "11:45"]) {
      expect(starts.has(t)).toBe(true);
    }
  });

  test("availability still requires the full service duration to fit", () => {
    // 60-minute service, day ends 18:00: 17:00 fits exactly, 17:15 overflows.
    const { allTimeSlots } = build({ duration: 60 });
    const byStart = Object.fromEntries(allTimeSlots.map((s) => [s.startTime, s]));

    expect(byStart["17:00"].available).toBe(true);
    expect(byStart["17:15"].available).toBe(false);
    expect(byStart["17:30"].available).toBe(false);
    expect(byStart["17:45"].available).toBe(false);
  });

  test("appointments block overlapping quarter-hour slots (conflict logic unchanged)", () => {
    const day = nextDateForWeekday("THURSDAY");
    const at = (h, m = 0) => {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d;
    };
    const appointments = [{ startTime: at(10), endTime: at(11), staffService: {} }];

    const { allTimeSlots } = build({ duration: 30, appointments });
    const byStart = Object.fromEntries(allTimeSlots.map((s) => [s.startTime, s]));

    // 30-minute service: 09:30 ends exactly at 10:00 (fits), 09:45 would
    // overlap the appointment, 11:00 is free again.
    expect(byStart["09:30"].available).toBe(true);
    expect(byStart["09:45"].available).toBe(false);
    expect(byStart["10:00"].available).toBe(false);
    expect(byStart["10:15"].available).toBe(false);
    expect(byStart["10:30"].available).toBe(false);
    expect(byStart["10:45"].available).toBe(false);
    expect(byStart["11:00"].available).toBe(true);
  });

  test("partial-day TimeOff blocks overlapping quarter-hour slots", () => {
    const day = nextDateForWeekday("THURSDAY");
    const at = (h, m = 0) => {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      return d;
    };
    const timeOffs = [{ startDate: at(12), endDate: at(13), isFullDay: false }];

    const { allTimeSlots } = build({ duration: 30, timeOffs });
    const byStart = Object.fromEntries(allTimeSlots.map((s) => [s.startTime, s]));

    expect(byStart["11:30"].available).toBe(true);
    expect(byStart["11:45"].available).toBe(false);
    expect(byStart["12:00"].available).toBe(false);
    expect(byStart["12:45"].available).toBe(false);
    expect(byStart["13:00"].available).toBe(true);
  });
});
