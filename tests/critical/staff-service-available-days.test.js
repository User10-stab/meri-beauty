import { describe, expect, test } from "vitest";
import { buildAvailabilityForDate } from "@/lib/slot-availability";

// StaffService.availableDays restricts which weekdays a given staff+service
// pairing can be booked on. Empty/null = no restriction (existing behaviour).
// This is independent of the staff's general working hours/contract rules.

function makeStaffService({ availableDays, weekDay = "WEDNESDAY" }) {
  const today = new Date();
  const contractStart = new Date(today);
  contractStart.setFullYear(contractStart.getFullYear() - 1);

  return {
    duration: 30,
    availableDays,
    staff: {
      isActive: true,
      isDeleted: false,
      user: { isDeleted: false },
      workingHours: [{ day: weekDay, startTime: "09:00", endTime: "17:00", isClosed: false }],
      timeOffs: [],
      contracts: [{ status: "ACTIVE", startDate: contractStart, endDate: null }],
    },
  };
}

// Find the next date (from today) that falls on the given weekday name.
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

describe("buildAvailabilityForDate — StaffService.availableDays", () => {
  test("empty availableDays: keeps existing behaviour (no restriction)", () => {
    const wednesday = nextDateForWeekday("WEDNESDAY");
    const staffService = makeStaffService({ availableDays: [] });

    const result = buildAvailabilityForDate({
      staffService,
      selectedDate: wednesday,
      salon: {},
      existingAppointments: [],
    });

    expect(result.isWorkingDay).toBe(true);
  });

  test("null availableDays: keeps existing behaviour (no restriction)", () => {
    const wednesday = nextDateForWeekday("WEDNESDAY");
    const staffService = makeStaffService({ availableDays: null });

    const result = buildAvailabilityForDate({
      staffService,
      selectedDate: wednesday,
      salon: {},
      existingAppointments: [],
    });

    expect(result.isWorkingDay).toBe(true);
  });

  test("selected date matches an allowed day: normal availability rules apply", () => {
    const wednesday = nextDateForWeekday("WEDNESDAY");
    const staffService = makeStaffService({ availableDays: ["WEDNESDAY"] });

    const result = buildAvailabilityForDate({
      staffService,
      selectedDate: wednesday,
      salon: {},
      existingAppointments: [],
    });

    expect(result.isWorkingDay).toBe(true);
    expect(result.reservationWindows.length).toBeGreaterThan(0);
  });

  test("selected date does not match any allowed day: staff not available for this service", () => {
    const friday = nextDateForWeekday("FRIDAY");
    // Staff generally works Fridays too, but this service is Wednesday-only.
    const staffService = makeStaffService({ availableDays: ["WEDNESDAY"], weekDay: "FRIDAY" });

    const result = buildAvailabilityForDate({
      staffService,
      selectedDate: friday,
      salon: {},
      existingAppointments: [],
    });

    expect(result.isWorkingDay).toBe(false);
    expect(result.reason).toBe("Service not offered by this staff member on this day");
  });

  test("multiple allowed days: any of them is bookable", () => {
    const monday = nextDateForWeekday("MONDAY");
    const staffService = makeStaffService({ availableDays: ["MONDAY", "WEDNESDAY", "FRIDAY"], weekDay: "MONDAY" });

    const result = buildAvailabilityForDate({
      staffService,
      selectedDate: monday,
      salon: {},
      existingAppointments: [],
    });

    expect(result.isWorkingDay).toBe(true);
  });
});
