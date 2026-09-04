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
  if (!date) return null;
  const d = new Date(date);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * Check if a date falls within the date range of a time-off.
 * 
 * Note: This checks if the DATE (calendar day) falls within the time-off range,
 * NOT if the specific time falls within the time-off hours.
 * 
 * For partial-day time-offs, the time-off's startDate and endDate will be
 * set to the same day, so this function correctly identifies which calendar
 * days are affected by time-offs.
 * 
 * @param {Date} date - The calendar day to check
 * @param {Date} start - The start of the time-off period
 * @param {Date} end - The end of the time-off period
 * @returns {boolean}
 */
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
function minutesSinceBaseDay(date, baseDate) {
  const value = new Date(date);
  const base = parseLocalDateString(baseDate);
  const valueDay = new Date(value);
  valueDay.setHours(0, 0, 0, 0);
  const dayOffset = Math.round((valueDay.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
  return dayOffset * 1440 + value.getHours() * 60 + value.getMinutes();
}

function buildOccupiedIntervals(appointments, selectedDate) {
  return appointments
    .map((apt) => {
      const aptEnd = new Date(apt.endTime);
      
      // Include margin (rest time) in the occupied period
      const marginMinutes = apt.staffService?.margin 
        ? Number(apt.staffService.margin) 
        : 0;
      const aptEndWithMargin = new Date(aptEnd);
      aptEndWithMargin.setMinutes(aptEndWithMargin.getMinutes() + marginMinutes);
      
      const startMinutes = minutesSinceBaseDay(apt.startTime, selectedDate);
      const endMinutes = minutesSinceBaseDay(aptEndWithMargin, selectedDate);
      
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
    if (occupied.end <= workStartMinutes) continue;
    if (occupied.start >= workEndMinutes) break;

    const occupiedStart = Math.max(occupied.start, workStartMinutes);
    const occupiedEnd = Math.min(occupied.end, workEndMinutes);

    if (currentStart < occupiedStart) {
      // There's free time before this occupied interval
      freeIntervals.push({ start: currentStart, end: occupiedStart });
    }
    // Move the pointer past this occupied interval
    currentStart = Math.max(currentStart, occupiedEnd);
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

function formatMinutesAsDisplayTime(minutes) {
  const dayOffset = Math.floor(minutes / 1440);
  const minutesInDay = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
  return dayOffset > 0 ? `${time} (J+${dayOffset})` : time;
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
        label: `${formatMinutesAsDisplayTime(windowStart)} → ${formatMinutesAsDisplayTime(windowEnd)}`,
      });

      windowStart = windowEnd;
    }
  }

  return windows;
}

/**
 * Generate ALL possible time slots across the working hours at a fixed interval,
 * marking each as available or unavailable based on whether the FULL service
 * duration can fit starting from that time.
 *
 * This shows the complete timeline to the client at regular intervals (e.g., 30 min)
 * regardless of service duration. A slot is marked available only if:
 * 1. The slot start time + full service duration fits within free intervals
 * 2. No occupied time blocks the service
 *
 * @param {number} workStartMinutes - working day start (minutes from midnight)
 * @param {number} workEndMinutes - working day end (minutes from midnight)
 * @param {number} slotInterval - display interval in minutes (e.g., 30)
 * @param {number} serviceDuration - actual service duration in minutes
 * @param {Array<{ start: number, end: number }>} freeIntervals - calculated free gaps
 * @returns {Array<{
 *   startTime: string,
 *   endTime: string,
 *   startMinutes: number,
 *   endMinutes: number,
 *   label: string,
 *   available: boolean,
 * }>} all possible slots with availability flag
 */
function generateAllTimeSlots(workStartMinutes, workEndMinutes, slotInterval, serviceDuration, freeIntervals) {
  const allSlots = [];
  let slotStart = workStartMinutes;

  // Generate slots at fixed intervals across the full working hours
  while (slotStart < workEndMinutes) {
    const serviceEnd = slotStart + serviceDuration;
    
    // Display the slot itself (just the start time marker)
    const startTime = formatMinutesAsTime(slotStart);
    
    // Check if the FULL service duration can fit in free intervals starting from this time
    // A slot is available if the entire service window [slotStart, serviceEnd] fits within free time
    const available = freeIntervals.some(
      (free) => slotStart >= free.start && serviceEnd <= free.end
    );

    allSlots.push({
      startTime,
      endTime: formatMinutesAsTime(serviceEnd),
      startMinutes: slotStart,
      endMinutes: serviceEnd,
      label: `${formatMinutesAsDisplayTime(slotStart)}`,
      available,
    });

    slotStart += slotInterval;
  }

  return allSlots;
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
 * Remove reservation windows whose start time has already passed today.
 * The availability endpoint uses this for displayed slots; the booking
 * validation still performs its own exact Date.now() check server-side.
 */
export function filterFutureReservationWindows(reservationWindows, selectedDate, now = new Date()) {
  const selected = new Date(selectedDate);
  const current = new Date(now);
  if (
    selected.getFullYear() !== current.getFullYear() ||
    selected.getMonth() !== current.getMonth() ||
    selected.getDate() !== current.getDate()
  ) {
    return reservationWindows;
  }

  const nowMinutes = current.getHours() * 60 + current.getMinutes();
  return reservationWindows.filter((window) => window.startMinutes > nowMinutes);
}

/**
 * Filter all time slots (including unavailable ones) to remove past slots today.
 * Same logic as filterFutureReservationWindows but works on the allTimeSlots array.
 */
export function filterFutureTimeSlots(allTimeSlots, selectedDate, now = new Date()) {
  const selected = new Date(selectedDate);
  const current = new Date(now);
  if (
    selected.getFullYear() !== current.getFullYear() ||
    selected.getMonth() !== current.getMonth() ||
    selected.getDate() !== current.getDate()
  ) {
    return allTimeSlots;
  }

  const nowMinutes = current.getHours() * 60 + current.getMinutes();
  return allTimeSlots.filter((slot) => slot.startMinutes > nowMinutes);
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

  // ─── Validate this staff+service's own allowed weekdays (independent of
  // the staff's general working hours below) ──────────────────────────────
  if (staffService.availableDays && staffService.availableDays.length > 0 && !staffService.availableDays.includes(weekDay)) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Service not offered by this staff member on this day",
    };
  }

  // ─── Note: Salon working days and closures only affect the boutique/shop ───
  // Staff availability is independent of salon opening hours. Each staff member
  // has their own working schedule via WorkingHour records and TimeOff.

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

  const timeOffsForDay = staffService.staff.timeOffs.filter((timeOff) =>
    isDateInRange(selectedDate, timeOff.startDate, timeOff.endDate)
  );

  // Full-day time-offs block the entire day
  const hasFullDayTimeOff = timeOffsForDay.some((to) => to.isFullDay === true);
  if (hasFullDayTimeOff) {
    return {
      isAvailable: false,
      reservationWindows: [],
      freeIntervals: [],
      occupiedIntervals: [],
      isWorkingDay: false,
      reason: "Staff on time off",
    };
  }

  // Partial-day time-offs will be added as occupied intervals below

  // ─── Note: Salon closures only affect the boutique/shop ─────────────────
  // Staff availability is independent of salon closures. Each staff member
  // can work according to their own schedule even when the boutique is closed.

  // ─── Calculate available reservation windows ────────────────────────────

  const duration = staffService.duration;
  const [startHour, startMinute] = workingHour.startTime.split(":").map(Number);
  const [endHour, endMinute] = workingHour.endTime.split(":").map(Number);

  const workStartMinutes = startHour * 60 + startMinute;
  let workEndMinutes = endHour * 60 + endMinute;
  if (workEndMinutes <= workStartMinutes) {
    workEndMinutes += 24 * 60;
  }

  // Step 1: Convert appointments to occupied intervals (with margins)
  const occupiedIntervals = buildOccupiedIntervals(existingAppointments, selectedDate);

  // Add partial-day time-offs as occupied intervals
  for (const timeOff of timeOffsForDay) {
    if (timeOff.isFullDay === false) {
      const toStart = new Date(timeOff.startDate);
      const toEnd = new Date(timeOff.endDate);
      const startMinutes = minutesSinceBaseDay(toStart, selectedDate);
      const endMinutes = minutesSinceBaseDay(toEnd, selectedDate);
      if (endMinutes > startMinutes) {
        occupiedIntervals.push({ start: startMinutes, end: endMinutes });
      }
    }
  }

  // Step 2: Merge overlapping occupied intervals
  const mergedOccupied = mergeIntervals(occupiedIntervals);

  // Step 3: Calculate free intervals
  const freeIntervals = calculateFreeIntervals(workStartMinutes, workEndMinutes, mergedOccupied);

  // Step 4: Generate ALL time slots at fixed 30-minute intervals
  // Each slot is marked available if the full service duration can fit starting from that time
  const SLOT_INTERVAL_MINUTES = 30; // Fixed display interval
  const allSlots = generateAllTimeSlots(workStartMinutes, workEndMinutes, SLOT_INTERVAL_MINUTES, duration, freeIntervals);
  
  // Also keep the old generateReservationWindows output for backward compatibility
  // (used by auto-proposal paths and validation that expect only available windows)
  const reservationWindows = generateReservationWindows(freeIntervals, duration);

  return {
    isAvailable: reservationWindows.length > 0,
    reservationWindows,
    allTimeSlots: allSlots, // New: complete timeline at fixed intervals with availability flags
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
