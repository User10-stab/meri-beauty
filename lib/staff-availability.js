/**
 * Staff Availability Helper
 *
 * Contains ALL business rules for determining whether a staff member
 * is currently available for booking.
 *
 * There are two distinct concerns handled here:
 *
 *  1. Visibility (isStaffBookable / isStaffServiceBookable): whether a
 *     staff member's category/service should be shown at all on the
 *     reservation page. This does NOT check contract start/end dates —
 *     a staff member whose contract starts in the future must still be
 *     shown, since they *will* become bookable later.
 *
 *  2. Date availability (isStaffAvailable / isStaffServiceAvailable):
 *     whether a staff member can be booked on a specific date. This DOES
 *     check contract start/end dates against the reference date:
 *      - referenceDate >= contract.startDate
 *      - contract.endDate is null or >= referenceDate
 *
 * This helper is designed to be easy to extend in the future with:
 *  - checking appointments / overlapping reservations
 *  - checking salon closures
 *  - checking booking limits
 */

/**
 * Check if a staff member should be shown on the reservation page
 * (category/service visibility). Ignores contract start/end dates —
 * those only affect which specific dates are bookable.
 *
 * @param {object} staff - Staff object with relations: workingHours, contracts, user
 * @returns {{ available: boolean, reasons: string[] }}
 */
export function isStaffBookable(staff) {
  const reasons = [];

  if (!staff) {
    return { available: false, reasons: ["Staff not found"] };
  }

  if (!staff.isActive) {
    reasons.push("Staff is not active");
  }

  if (staff.isDeleted) {
    reasons.push("Staff is deleted");
  }

  if (staff.user?.isDeleted) {
    reasons.push("User is deleted");
  }

  if (staff.user?.isActive === false) {
    reasons.push("User is not active");
  }

  const workingHours = staff.workingHours || [];
  if (workingHours.length === 0) {
    reasons.push("No working hours configured");
  }

  const contracts = staff.contracts || [];
  const activeContract = contracts.find((c) => c.status === "ACTIVE");
  if (!activeContract) {
    reasons.push("No active contract");
  }

  return {
    available: reasons.length === 0,
    reasons,
  };
}

/**
 * Check if a staff-service record should be shown on the reservation page.
 * Validates the staffService itself (active, valid price/duration) plus
 * its staff member's visibility rules. Ignores contract start/end dates.
 *
 * @param {object} staffService - StaffService record with nested staff relation
 * @returns {{ available: boolean, reasons: string[] }}
 */
export function isStaffServiceBookable(staffService) {
  if (!staffService) {
    return { available: false, reasons: ["StaffService not found"] };
  }

  const reasons = [];

  if (!staffService.isActive) {
    reasons.push("StaffService is not active");
  }

  // "Assign to me" creates isActive: true rows with price/duration 0, meant
  // to be configured before going live — must stay hidden until then.
  const price = Number(staffService.price);
  if (staffService.price == null || Number.isNaN(price) || price < 0) {
    reasons.push("Invalid price");
  }

  const duration = Number(staffService.duration);
  if (staffService.duration == null || Number.isNaN(duration) || duration <= 0) {
    reasons.push("Invalid duration");
  }

  const staffResult = isStaffBookable(staffService.staff);
  if (!staffResult.available) {
    reasons.push(...staffResult.reasons);
  }

  return { available: reasons.length === 0, reasons };
}

/**
 * Filter an array of StaffService records to return only those that
 * should be shown on the reservation page (visibility check, no dates).
 *
 * @param {Array<object>} staffServices - Array of StaffService records with nested staff
 * @returns {Array<object>} - StaffService records that should be visible
 */
export function getBookableStaffServices(staffServices) {
  if (!staffServices || !Array.isArray(staffServices)) {
    return [];
  }

  return staffServices.filter((ss) => isStaffServiceBookable(ss).available);
}

/**
 * Check if a single staff member is available for booking today.
 *
 * @param {object} staff - Staff object with relations: workingHours, contracts, user
 * @param {Date}   [referenceDate] - Optional date to check against (defaults to today)
 * @returns {{ available: boolean, reasons: string[] }}
 */
export function isStaffAvailable(staff, referenceDate = new Date()) {
  const reasons = [];

  if (!staff) {
    return { available: false, reasons: ["Staff not found"] };
  }

  const date = new Date(referenceDate);
  date.setHours(0, 0, 0, 0);

  // ── 1. Staff is active ─────────────────────────────────────────────
  if (!staff.isActive) {
    reasons.push("Staff is not active");
  }

  // ── 2. Staff is not deleted ────────────────────────────────────────
  if (staff.isDeleted) {
    reasons.push("Staff is deleted");
  }

  // ── 3. User is not deleted ─────────────────────────────────────────
  if (staff.user?.isDeleted) {
    reasons.push("User is deleted");
  }

  // ── 4. Has at least one WorkingHour ────────────────────────────────
  const workingHours = staff.workingHours || [];
  if (workingHours.length === 0) {
    reasons.push("No working hours configured");
  }

  // ── 5. Has an ACTIVE contract ──────────────────────────────────────
  const contracts = staff.contracts || [];
  const activeContract = contracts.find((c) => c.status === "ACTIVE");

  if (!activeContract) {
    reasons.push("No active contract");
  } else {
    // ── 6. Contract start date has been reached ────────────────────────
    const contractStart = new Date(activeContract.startDate);
    contractStart.setHours(0, 0, 0, 0);
    if (date < contractStart) {
      reasons.push("Contract has not started yet");
    }

    // ── 7. Contract end date has not passed ────────────────────────────
    if (activeContract.endDate) {
      const contractEnd = new Date(activeContract.endDate);
      contractEnd.setHours(23, 59, 59, 999);
      if (date > contractEnd) {
        
        reasons.push("Contract has expired");
      }
    }
  }

  return {
    available: reasons.length === 0,
    reasons,
  };
}

/**
 * Filter an array of staff members to return only those available for booking.
 *
 * @param {Array<object>} staffArray - Array of staff objects with relations
 * @param {Date}          [referenceDate] - Optional date (defaults to today)
 * @returns {Array<object>} - The staff members that are available
 */
export function getAvailableStaff(staffArray, referenceDate = new Date()) {
  if (!staffArray || !Array.isArray(staffArray)) {
    return [];
  }

  return staffArray.filter((staff) => {
    const result = isStaffAvailable(staff, referenceDate);
    return result.available;
  });
}

/**
 * Check if a staff-service record's staff member is available for booking.
 *
 * @param {object} staffService - StaffService record with nested staff relation
 * @param {Date}   [referenceDate] - Optional date (defaults to today)
 * @returns {{ available: boolean, reasons: string[] }}
 */
export function isStaffServiceAvailable(staffService, referenceDate = new Date()) {
  if (!staffService) {
    return { available: false, reasons: ["StaffService not found"] };
  }

  return isStaffAvailable(staffService.staff, referenceDate);
}

/**
 * Filter an array of StaffService records to return only those
 * whose staff member is available for booking.
 *
 * @param {Array<object>} staffServices - Array of StaffService records with nested staff
 * @param {Date}          [referenceDate] - Optional date (defaults to today)
 * @returns {Array<object>} - Available StaffService records
 */
export function getAvailableStaffServices(staffServices, referenceDate = new Date()) {
  if (!staffServices || !Array.isArray(staffServices)) {
    return [];
  }

  return staffServices.filter((ss) => {
    const result = isStaffServiceAvailable(ss, referenceDate);
    return result.available;
  });
}