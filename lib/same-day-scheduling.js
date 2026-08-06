/**
 * Pure same-day sequential scheduling helpers (no DB access).
 */

export const DEFAULT_MAX_PROPOSALS = 5;
export const MAX_SCHEDULES_TO_COLLECT = 100;

/** Format minutes-from-midnight as "HH:MM". */
export function formatMinutesAsTime(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Generate all permutations of draft indices (for small N only).
 * @param {number} n
 * @returns {number[][]}
 */
export function permuteDraftOrders(n) {
  if (n <= 1) return [[0]];

  const results = [];

  function permute(arr) {
    if (arr.length === n) {
      results.push([...arr]);
      return;
    }
    for (let i = 0; i < n; i++) {
      if (arr.includes(i)) continue;
      arr.push(i);
      permute(arr);
      arr.pop();
    }
  }

  permute([]);
  return results;
}

/**
 * Find all valid sequential schedules for a fixed draft order.
 *
 * @param {Array<Array<{ startTime: string, endTime: string, startMinutes: number, endMinutes: number, label?: string }>>} perDraftSlots
 * @param {number[]} draftOrder — indices into perDraftSlots defining scheduling sequence
 * @param {{ maxSchedules?: number }} [options]
 * @returns {Array<Array<{ draftIndex: number, time: string, endTime: string, startMinutes: number, endMinutes: number, label?: string }>>}
 */
export function findSequentialSchedulesForOrder(perDraftSlots, draftOrder, { maxSchedules = MAX_SCHEDULES_TO_COLLECT } = {}) {
  const n = draftOrder.length;
  const results = [];

  function search(position, notBefore, schedule) {
    if (results.length >= maxSchedules) return;

    if (position === n) {
      results.push([...schedule]);
      return;
    }

    const draftIdx = draftOrder[position];
    const reservationWindows = perDraftSlots[draftIdx].filter(
      (window) => window.startMinutes >= notBefore
    );

    for (const window of reservationWindows) {
      search(position + 1, window.endMinutes, [
        ...schedule,
        {
          draftIndex: draftIdx,
          time: window.startTime,
          endTime: window.endTime,
          label: window.label,
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
        },
      ]);
    }
  }

  search(0, 0, []);
  return results;
}

/**
 * Build a stable deduplication key for a schedule (sorted by start time).
 * @param {Array<{ draftIndex: number, time: string }>} appointments
 */
export function scheduleKey(appointments) {
  return [...appointments]
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((a) => `${a.draftIndex}@${a.time}`)
    .join("|");
}

/**
 * Compute schedule metrics for sorting and UI display.
 *
 * @param {Array<{ startMinutes: number, endMinutes: number }>} appointments — time-ordered
 */
export function computeScheduleMetrics(appointments) {
  if (!appointments.length) {
    return {
      startTime: null,
      finishTime: null,
      finishMinutes: 0,
      startMinutes: 0,
      totalDuration: 0,
      totalWaitingTime: 0,
      appointmentCount: 0,
    };
  }

  const sorted = [...appointments].sort((a, b) => a.startMinutes - b.startMinutes);
  const startMinutes = sorted[0].startMinutes;
  const finishMinutes = sorted[sorted.length - 1].endMinutes;

  let totalDuration = 0;
  let totalWaitingTime = 0;

  for (let i = 0; i < sorted.length; i++) {
    totalDuration += sorted[i].endMinutes - sorted[i].startMinutes;
    if (i > 0) {
      const gap = sorted[i].startMinutes - sorted[i - 1].endMinutes;
      if (gap > 0) totalWaitingTime += gap;
    }
  }

  return {
    startTime: formatMinutesAsTime(startMinutes),
    finishTime: formatMinutesAsTime(finishMinutes),
    finishMinutes,
    startMinutes,
    totalDuration,
    totalWaitingTime,
    appointmentCount: sorted.length,
  };
}

/**
 * Sort proposals: lowest waiting → earliest finish → earliest start.
 * @param {Array<object>} proposals
 */
export function sortScheduleProposals(proposals) {
  return [...proposals].sort((a, b) => {
    if (a.totalWaitingTime !== b.totalWaitingTime) {
      return a.totalWaitingTime - b.totalWaitingTime;
    }
    if (a.finishMinutes !== b.finishMinutes) {
      return a.finishMinutes - b.finishMinutes;
    }
    return a.startMinutes - b.startMinutes;
  });
}

/**
 * Collect, deduplicate, rank, and cap schedule proposals across draft orderings.
 *
 * @param {Array<Array<{ startTime: string, endTime: string, startMinutes: number, endMinutes: number, label?: string }>>} perDraftSlots
 * @param {{ maxProposals?: number, tryAllOrderings?: boolean }} [options]
 */
export function buildScheduleProposals(perDraftSlots, { maxProposals = DEFAULT_MAX_PROPOSALS, tryAllOrderings = true } = {}) {
  const n = perDraftSlots.length;
  if (n === 0) return [];

  const orders = tryAllOrderings && n <= 5 ? permuteDraftOrders(n) : [Array.from({ length: n }, (_, i) => i)];

  const seen = new Set();
  const proposals = [];

  for (const order of orders) {
    const schedules = findSequentialSchedulesForOrder(perDraftSlots, order);

    for (const appointments of schedules) {
      const key = scheduleKey(appointments);
      if (seen.has(key)) continue;
      seen.add(key);

      const metrics = computeScheduleMetrics(appointments);
      proposals.push({
        appointments: [...appointments].sort((a, b) => a.startMinutes - b.startMinutes),
        ...metrics,
      });
    }
  }

  const ranked = sortScheduleProposals(proposals);
  return ranked.slice(0, maxProposals).map((proposal, index) => ({
    ...proposal,
    recommended: index === 0,
  }));
}

/**
 * Backward-compatible helper — returns the best single schedule or null.
 */
export function findEarliestSequentialSchedule(perDraftSlots) {
  const proposals = buildScheduleProposals(perDraftSlots, { maxProposals: 1, tryAllOrderings: true });
  return proposals[0]?.appointments ?? null;
}
