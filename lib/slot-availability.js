/**
 * Availability helpers — canonical business rules for date/window generation.
 *
 * Used by get-available-slots and same-day scheduling. Add new rules here only.
 */

/**
 * Parse a "YYYY-MM-DD" date string into a local-midnight Date object without
 * any timezone drift.
 *
 * `new Date("2026-08-11")` is parsed as UTC midnight which, when converted to
 * local time on a UTC+2 server, becomes "2026-08-10 22:00:00" — the wrong day.
 * Using the `new Date(year, month-1, day)` constructor always produces a local
 * midnight Date, making date arithmetic timezone-safe.
 *
 * All server actions that accept a date parameter must call this helper rather
 * than `new Date(date)` + `setHours(0,0,0,0)`.
 *
 * @param {string|Date} dateInput — "YYYY-MM-DD" string or an existing Date
 * @returns {Date} local midnight
 */
export function parseLocalDateString(dateInput) {
  if (dateInput instanceof Date) {
    // Already a Date — normalise to local midnight without shifting the day
    const d = new Date(dateInput);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // Accept both "YYYY-MM-DD" and ISO strings — extract the date portion only
  const datePart = String(dateInput).slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = datePart.split("-").map(Number);
  return new Date(year, month - 1, day); // local midnight, no UTC shift
}

/**
 * Format a Date (or local-midnight Date) to a "YYYY-MM-DD" string using local
 * date components — the inverse of parseLocalDateString.
 *
 * Always use this instead of date.toISOString().slice(0,10) which returns the
 * UTC date and can be one day off in timezones east of UTC.
 *
 * @param {Date} date
 * @returns {string} "YYYY-MM-DD"
 */
export function formatLocalDateKey(date) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

export function isDateInRange(date, start, end) {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const normalizedStart = new Date(start);
  normalizedStart.setHours(0, 0, 0, 0);
  const normalizedEnd = new Date(end);
  normalizedEnd.setHours(23, 59, 59, 999);
  return normalizedDate >= normalizedStart && normalizedDate <= normalizedEnd;
}

/**
 * Convert appointments to occupied time intervals, including margins.
 * 
 * @param {Array<{ startTime: Date, endTime: Date, staffService: { margin?: number } }>} appointments
 * @returns {Array<{ start: number, end: number }>} intervals in minutes from midnight
 */
function buildOccupiedIntervals(appointments) {
  return appointments
    .map((apt) => {
      const aptStart = new Date(apt.startTime);
      const aptEnd = new Date(apt.endTime);
      
      // Include margin (rest time) in the occupied period
      const marginMinutes = apt.staffService?.margin 
        ? Number(apt.staffService.margin) 
        : 0;
      const aptEndWithMargin = new Date(aptEnd);
      aptEndWithMargin.setMinutes(aptEndWithMargin.getMinutes() + marginMinutes);
      
      const startMinutes = aptStart.getHours() * 60 + aptStart.getMinutes();
      const endMinutes = aptEndWithMargin.getHours() * 60 + aptEndWithMargin.getMinutes();
      
      return { start: startMinutes, end: endMinutes };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * Merge overlapping or adjacent time intervals.
 * 
 * Example:
 *   [{ start: 540, end: 660 }, { start: 630, end: 720 }]
 *   → [{ start: 540, end: 720 }]
 * 
 * @param {Array<{ start: number, end: number }>} intervals - must be sorted by start
 * @returns {Array<{ start: number, end: number }>}
 */
function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  
  const merged = [];
  let current = { ...intervals[0] };
  
  for (let i = 1; i < intervals.length; i++) {
    const interval = intervals[i];
    
    if (interval.start <= current.end) {
      // Overlapping or adjacent - extend the current interval
      current.end = Math.max(current.end, interval.end);
    } else {
      // No overlap - push current and start a new one
      merged.push(current);
      current = { ...interval };
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Calculate free time intervals from working hours minus occupied intervals.
 * 
 * @param {number} workStartMinutes - working day start (minutes from midnight)
 * @param {number} workEndMinutes - working day end (minutes from midnight)
 * @param {Array<{ start: number, end: number }>} occupiedIntervals - merged occupied intervals
 * @returns {Array<{ start: number, end: number }>}
 */
function calculateFreeIntervals(workStartMinutes, workEndMinutes, occupiedIntervals) {
  const freeIntervals = [];
  let currentStart = workStartMinutes;

  for (const occupied of occupiedIntervals) {
    if (currentStart < occupied.start) {
      // There's free time before this occupied interval
      freeIntervals.push({ start: currentStart, end: occupied.start });
    }
    // Move the pointer past this occupied interval
    currentStart = Math.max(currentStart, occupied.end);
  }

  // Add remaining time after the last occupied interval
  if (currentStart < workEndMinutes) {
    freeIntervals.push({ start: currentStart, end: workEndMinutes });
  }

  return freeIntervals;
}

/**
 * Convert minutes from midnight to an "HH:MM" time string.
 *
 * @param {number} minutes
 * @returns {string}
 */
function formatMinutesAsTime(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

/**
 * Generate reservation windows inside the free intervals.
 *
 * Important business rule:
 * - We no longer generate rolling 30-minute slots.
 * - Each generated item is a complete reservation window.
 * - Windows are chained from the start of each free interval using the service
 *   duration as the step, which makes the output deterministic and ensures we
 *   never propose a window that partially overlaps occupied time.
 *
 * Example:
 *   Free interval: 11:30 → 18:00
 *   Service duration: 120 minutes
 *   Generated windows:
 *     11:30 → 13:30
 *     13:30 → 15:30
 *     15:30 → 17:30
 *
 * @param {Array<{ start: number, end: number }>} freeIntervals
 * @param {number} duration - service duration in minutes
 * @returns {Array<{
 *   startTime: string,
 *   endTime: string,
 *   startMinutes: number,
 *   endMinutes: number,
 *   label: string,
 * }>} reservation windows
 */
function generateReservationWindows(freeIntervals, duration) {
  const windows = [];

  for (const freeInterval of freeIntervals) {
    let windowStart = freeInterval.start;

    while (windowStart + duration <= freeInterval.end) {
      const windowEnd = windowStart + duration;
      const startTime = formatMinutesAsTime(windowStart);
      const endTime = formatMinutesAsTime(windowEnd);

      windows.push({
        startTime,
        endTime,
        startMinutes: windowStart,
        endMinutes: windowEnd,
        label: `${startTime} → ${endTime}`,
      });

      windowStart = windowEnd;
    }
  }

  return windows;
}

/**
 * Check whether a specific reservation window exists in the generated
 * availability for the day.
 *
 * @param {Array<{ startTime: string, endTime: string }>} reservationWindows
 * @param {string} startTime
 * @returns {boolean}
 */
export function hasReservationWindow(reservationWindows, startTime) {
  return reservationWindows.some((window) => window.startTime === startTime);
}

/**
 * Build available reservation windows for a staff service on a specific date.
 *
 * This algorithm:
 * 1. Loads all appointments for the staff member (regardless of service)
 * 2. Converts appointments to occupied intervals (including margins)
 * 3. Sorts occupied intervals
 * 4. Merges overlapping occupied intervals
 * 5. Calculates free intervals
 * 6. Generates reservation windows within those free intervals
 * 
 * @param {{
 *   staffService: { staff: object, duration: number },
 *   selectedDate: Date,
 *   salon: object,
 *   existingAppointments: Array<object>
 * }} params
 * 
 * @returns {{
 *   isAvailable: boolean,
 *   reservationWindows: Array<{
 *     startTime: string,
 *     endTime: string,
 *     startMinutes: number,
 *     endMinutes: number,
 *     label: string,
 *   }>,
 *   freeIntervals: Array<{ start: number, end: number }>,
 *   occupiedIntervals: Array<{ start: number, end: number }>,
 *   isWorkingDay: boolean,
 *   workingHours?: { start: string, end: string },
 *   reason: string | null,
 * }}
 */
export function buildAvailabilityForDate({ staffService, selectedDate, salon, existingAppointments }) {
  const dayMap = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const weekDay = dayMap[selectedDate.getDay()];

  // ─── Validate staff availability ────────────────────────────────────────

  if (!staffService.staff.isActive || staffService.staff.isDeleted) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Staff not available",
    };
  }

  if (staffService.staff.user?.isDeleted) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "User deleted",
    };
  }

  if (!staffService.staff.workingHours || staffService.staff.workingHours.length === 0) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "No working hours configured",
    };
  }

  const activeContract = staffService.staff.contracts?.find((c) => c.status === "ACTIVE");
  if (!activeContract) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "No active contract",
    };
  }

  const contractStart = new Date(activeContract.startDate);
  contractStart.setHours(0, 0, 0, 0);
  if (selectedDate < contractStart) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Contract has not started yet",
    };
  }

  if (activeContract.endDate) {
    const contractEnd = new Date(activeContract.endDate);
    contractEnd.setHours(23, 59, 59, 999);
    if (selectedDate > contractEnd) {
      return {
        isAvailable: false,
        reservationWindows: [],
        freeIntervals: [],
        occupiedIntervals: [],
        isWorkingDay: false,
        reason: "Contract has expired",
      };
    }
  }

  // ─── Validate salon is open ─────────────────────────────────────────────

  if (salon && salon.workingDays) {
    const salonWorkingDay = salon.workingDays.find((wd) => wd.day === weekDay);
    if (!salonWorkingDay || !salonWorkingDay.isOpen) {
      return {
        isAvailable: false,
        reservationWindows: [],
        freeIntervals: [],
        occupiedIntervals: [],
        isWorkingDay: false,
        reason: "Salon closed this day",
      };
    }
  }

  // ─── Validate staff working hours ───────────────────────────────────────

  const workingHour = staffService.staff.workingHours.find((wh) => wh.day === weekDay);

  if (!workingHour || workingHour.isClosed) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Staff not working this day",
    };
  }

  // ─── Check time off ─────────────────────────────────────────────────────

  const hasTimeOff = staffService.staff.timeOffs.some((timeOff) =>
    isDateInRange(selectedDate, timeOff.startDate, timeOff.endDate)
  );

  if (hasTimeOff) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Staff on time off",
    };
  }

  // ─── Check salon closures ───────────────────────────────────────────────

  if (salon) {
    const salonClosure = salon.closures.find((closure) => {
      const start = new Date(closure.startDate);
      const end = closure.endDate ? new Date(closure.endDate) : start;
      return isDateInRange(selectedDate, start, end);
    });

    if (salonClosure) {
      return {
        isAvailable: false,
        reservationWindows: [],
        freeIntervals: [],
        occupiedIntervals: [],
        isWorkingDay: false,
        reason: "Salon closure",
      };
    }
  }

  // ─── Calculate available reservation windows ────────────────────────────

  const duration = staffService.duration;
  const [startHour, startMinute] = workingHour.startTime.split(":").map(Number);
  const [endHour, endMinute] = workingHour.endTime.split(":").map(Number);

  const workStartMinutes = startHour * 60 + startMinute;
  const workEndMinutes = endHour * 60 + endMinute;

  // Step 1: Convert appointments to occupied intervals (with margins)
  const occupiedIntervals = buildOccupiedIntervals(existingAppointments);

  // Step 2: Merge overlapping occupied intervals
  const mergedOccupied = mergeIntervals(occupiedIntervals);

  // Step 3: Calculate free intervals
  const freeIntervals = calculateFreeIntervals(workStartMinutes, workEndMinutes, mergedOccupied);

  // Step 4: Generate reservation windows within free intervals
  const reservationWindows = generateReservationWindows(freeIntervals, duration);

  return {
    isAvailable: reservationWindows.length > 0,
    reservationWindows,
    freeIntervals,
    occupiedIntervals: mergedOccupied,
    isWorkingDay: true,
    workingHours: {
      start: workingHour.startTime,
      end: workingHour.endTime,
    },
    reason: null,
  };
}
