/**
 * Staff Availability Helper
 *
 * Contains ALL business rules for determining whether a staff member
 * is currently available for booking.
 *
 * A staff member is available only if ALL of these conditions are met:
 *  - staff.isActive === true
 *  - staff.isDeleted === false
 *  - user.isDeleted === false
 *  - has at least one WorkingHour record
 *  - has an ACTIVE contract
 *  - today >= contract.startDate
 *  - contract.endDate is null or >= today
 *
 * This helper is designed to be easy to extend in the future with:
 *  - checking appointments / overlapping reservations
 *  - checking salon closures
 *  - checking booking limits
 */

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