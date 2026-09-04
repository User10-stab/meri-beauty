import { describe, expect, test } from "vitest";
import {
  isStaffBookable,
  isStaffServiceBookable,
  getBookableStaffServices,
  isStaffAvailable,
  isStaffServiceAvailable,
} from "@/lib/staff-availability";

// A future contract.startDate must NOT hide a category/service from the
// reservation page, but it MUST still prevent booking dates before that
// start (and, symmetrically, an ended contract must still block dates
// after its endDate). See lib/staff-availability.js for the split between
// visibility (isStaffBookable) and date availability (isStaffAvailable).

function makeStaff({ contract } = {}) {
  return {
    isActive: true,
    isDeleted: false,
    user: { isActive: true, isDeleted: false },
    workingHours: [{ day: "MONDAY" }],
    contracts: contract ? [contract] : [],
  };
}

function makeStaffService(staff, overrides = {}) {
  return { isActive: true, price: 25, duration: 30, staff, ...overrides };
}

describe("staff contract: visibility vs. date availability", () => {
  test("1. contract starts today: visible and today is bookable", () => {
    const today = new Date();
    const staff = makeStaff({ contract: { status: "ACTIVE", startDate: today, endDate: null } });

    expect(isStaffBookable(staff).available).toBe(true);
    expect(isStaffAvailable(staff, today).available).toBe(true);
  });

  test("2. contract starts in the future: still visible, but pre-start dates are not bookable", () => {
    const future = new Date();
    future.setDate(future.getDate() + 14);
    const staff = makeStaff({ contract: { status: "ACTIVE", startDate: future, endDate: null } });

    // Visibility must NOT be affected by a future startDate.
    expect(isStaffBookable(staff).available).toBe(true);

    // Dates before the contract start must not be bookable.
    const dayBefore = new Date(future);
    dayBefore.setDate(dayBefore.getDate() - 1);
    expect(isStaffAvailable(staff, dayBefore).available).toBe(false);

    // The contract start date itself, and after, must be bookable.
    expect(isStaffAvailable(staff, future).available).toBe(true);
    const dayAfter = new Date(future);
    dayAfter.setDate(dayAfter.getDate() + 1);
    expect(isStaffAvailable(staff, dayAfter).available).toBe(true);
  });

  test("3. contract has ended: dates after the end are not bookable", () => {
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 1); // ended yesterday
    const staff = makeStaff({ contract: { status: "ACTIVE", startDate: start, endDate: end } });

    expect(isStaffAvailable(staff, new Date()).available).toBe(false);

    const beforeEnd = new Date(end);
    beforeEnd.setDate(beforeEnd.getDate() - 1);
    expect(isStaffAvailable(staff, beforeEnd).available).toBe(true);
  });

  test("4. no valid staff/service relationship: stays hidden", () => {
    const staffNoContract = makeStaff(); // no ACTIVE contract at all
    expect(isStaffBookable(staffNoContract).available).toBe(false);

    const staffService = makeStaffService(staffNoContract);
    expect(isStaffServiceBookable(staffService).available).toBe(false);
    expect(getBookableStaffServices([staffService])).toHaveLength(0);
  });

  test("5. multiple staff, same service, different contract start dates: service stays visible, dates computed per staff", () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 5);
    const later = new Date();
    later.setDate(later.getDate() + 20);

    const staffA = makeStaff({ contract: { status: "ACTIVE", startDate: soon, endDate: null } });
    const staffB = makeStaff({ contract: { status: "ACTIVE", startDate: later, endDate: null } });

    const staffServices = [makeStaffService(staffA), makeStaffService(staffB)];
    // Both remain visible regardless of their future start dates.
    expect(getBookableStaffServices(staffServices)).toHaveLength(2);

    // But each staff member's bookable dates depend on their own contract start.
    expect(isStaffServiceAvailable(staffServices[0], soon).available).toBe(true);
    expect(isStaffServiceAvailable(staffServices[1], soon).available).toBe(false);
    expect(isStaffServiceAvailable(staffServices[1], later).available).toBe(true);
  });

  test("6. service visibility requires a valid price (>= 0) and duration (> 0)", () => {
    const staff = makeStaff({ contract: { status: "ACTIVE", startDate: new Date(), endDate: null } });

    // Unconfigured placeholder (assign-service-to-me): price 0 AND duration 0.
    expect(isStaffServiceBookable(makeStaffService(staff, { price: 0, duration: 0 })).available).toBe(false);

    // Duration missing/zero alone must hide it, even with a real price.
    expect(isStaffServiceBookable(makeStaffService(staff, { duration: 0 })).available).toBe(false);

    // A free (price 0) service with a real duration is valid.
    expect(isStaffServiceBookable(makeStaffService(staff, { price: 0 })).available).toBe(true);

    // Negative price is invalid.
    expect(isStaffServiceBookable(makeStaffService(staff, { price: -5 })).available).toBe(false);

    // A fully configured staffService is bookable.
    expect(isStaffServiceBookable(makeStaffService(staff)).available).toBe(true);
  });
});
