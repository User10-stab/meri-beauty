import { buildAvailabilityForDate } from "@/lib/slot-availability";
import { buildScheduleProposals } from "@/lib/same-day-scheduling";

/** Return a copy of `date` at local midnight. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Add `days` calendar days to a date (midnight-normalised). */
export function addDays(date, days) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** True when both dates fall on the same local calendar day. */
export function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Keep only bookable slots that have not already passed on the current day.
 */
export function filterBookableFutureSlots(slots, selectedDate, now = new Date()) {
  const available = slots.filter((s) => s.available);
  if (!isSameCalendarDay(selectedDate, now)) return available;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return available.filter((s) => s.startMinutes > nowMinutes);
}

/**
 * Build per-draft slot arrays for one date using pre-loaded entities.
 */
export function buildPerDraftSlotsForDate({
  drafts,
  selectedDate,
  salon,
  ssById,
  apptsByStaffServiceId,
  now = new Date(),
}) {
  const perDraftSlots = [];
  const unavailable = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const ssId = draft.staffService.id;
    const ss = ssById[ssId];

    if (!ss) {
      unavailable.push({ draftIndex: i, reason: "Service introuvable" });
      perDraftSlots.push([]);
      continue;
    }

    const result = buildAvailabilityForDate({
      staffService: { ...ss, duration: draft.staffService.duration ?? ss.duration },
      selectedDate,
      salon,
      existingAppointments: apptsByStaffServiceId[ssId] ?? [],
    });

    if (!result.isWorkingDay) {
      unavailable.push({ draftIndex: i, reason: result.reason });
      perDraftSlots.push([]);
    } else {
      perDraftSlots.push(filterBookableFutureSlots(result.slots, selectedDate, now));
    }
  }

  return { perDraftSlots, unavailable };
}

/**
 * Same-day schedule proposals for one date (pure, uses pre-loaded data).
 */
export function getSameDayProposalsForDate(ctx, { maxProposals = 5 } = {}) {
  const { perDraftSlots, unavailable } = buildPerDraftSlotsForDate(ctx);

  if (unavailable.length > 0) {
    return { proposals: [], unavailable };
  }

  const proposals = buildScheduleProposals(perDraftSlots, { maxProposals });
  return { proposals, unavailable: [] };
}

/**
 * Group flat appointment rows by staffServiceId then calendar date key.
 * @param {Array<{ staffServiceId: string, date: Date, startTime: Date, endTime: Date }>} appointments
 */
export function groupAppointmentsByStaffAndDate(appointments) {
  return appointments.reduce((acc, appt) => {
    const day = startOfDay(appt.date);
    const key = `${appt.staffServiceId}:${day.toISOString()}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(appt);
    return acc;
  }, {});
}

/** Resolve appointment rows for one staffService on one date from a flat list. */
export function appointmentsForStaffOnDate(allAppointments, staffServiceId, selectedDate) {
  return allAppointments.filter(
    (a) =>
      a.staffServiceId === staffServiceId &&
      isSameCalendarDay(new Date(a.date), selectedDate)
  );
}

/** Group appointments by staffServiceId for one calendar day. */
export function apptsByStaffServiceForDate(allAppointments, staffServiceIds, selectedDate) {
  return staffServiceIds.reduce((acc, id) => {
    acc[id] = appointmentsForStaffOnDate(allAppointments, id, selectedDate);
    return acc;
  }, {});
}

/** Strip internal sort fields before sending proposals to the client. */
export function toClientProposal(proposal, { date = null } = {}) {
  const { finishMinutes, startMinutes, ...rest } = proposal;
  return date ? { ...rest, date: date.toISOString() } : rest;
}

const DEFAULT_MAX_DAYS = 60;

/**
 * Nearest bookable slots for a single appointment (scan forward day by day).
 */
export function findNearestSingleSlots(
  ctx,
  { maxProposals = 5, maxDaysToScan = DEFAULT_MAX_DAYS } = {}
) {
  const draft = ctx.drafts[0];
  const ssId = draft.staffService.id;
  const ss = ctx.ssById[ssId];
  if (!ss) return [];

  const proposals = [];

  for (let day = 0; day < maxDaysToScan && proposals.length < maxProposals; day++) {
    const selectedDate = addDays(ctx.now, day);
    const result = buildAvailabilityForDate({
      staffService: { ...ss, duration: draft.staffService.duration ?? ss.duration },
      selectedDate,
      salon: ctx.salon,
      existingAppointments: apptsByStaffServiceForDate(ctx.allAppointments, [ssId], selectedDate)[ssId] ?? [],
    });

    if (!result.isWorkingDay) continue;

    const slots = filterBookableFutureSlots(result.slots, selectedDate, ctx.now);
    for (const slot of slots) {
      proposals.push({
        date: selectedDate.toISOString(),
        time: slot.time,
        recommended: proposals.length === 0,
      });
      if (proposals.length >= maxProposals) break;
    }
  }

  return proposals;
}

/**
 * Nearest same-day multi-appointment schedules (scan forward day by day).
 */
export function findNearestSameDaySchedules(
  ctx,
  { maxProposals = 5, maxDaysToScan = DEFAULT_MAX_DAYS, perDayCap = 3 } = {}
) {
  const staffServiceIds = ctx.drafts.map((d) => d.staffService.id);
  const proposals = [];

  for (let day = 0; day < maxDaysToScan && proposals.length < maxProposals; day++) {
    const selectedDate = addDays(ctx.now, day);
    const dayCtx = {
      ...ctx,
      selectedDate,
      apptsByStaffServiceId: apptsByStaffServiceForDate(ctx.allAppointments, staffServiceIds, selectedDate),
    };

    const { proposals: dayProposals, unavailable } = getSameDayProposalsForDate(dayCtx, {
      maxProposals: Math.min(perDayCap, maxProposals - proposals.length),
    });

    if (unavailable.length > 0 || dayProposals.length === 0) continue;

    for (const proposal of dayProposals) {
      proposals.push(toClientProposal(proposal, { date: selectedDate }));
      if (proposals.length >= maxProposals) break;
    }
  }

  return proposals.map((p, i) => ({ ...p, recommended: i === 0 }));
}

/**
 * Nearest independent slot per draft (multi-day mode).
 * Proposal k uses the k-th nearest slot for each draft.
 */
export function findNearestMultiDaySchedules(
  ctx,
  { maxProposals = 5, maxDaysToScan = DEFAULT_MAX_DAYS } = {}
) {
  const perDraftOptions = ctx.drafts.map((draft, draftIndex) => {
    const ssId = draft.staffService.id;
    const ss = ctx.ssById[ssId];
    if (!ss) return [];

    const options = [];

    for (let day = 0; day < maxDaysToScan && options.length < maxProposals; day++) {
      const selectedDate = addDays(ctx.now, day);
      const result = buildAvailabilityForDate({
        staffService: { ...ss, duration: draft.staffService.duration ?? ss.duration },
        selectedDate,
        salon: ctx.salon,
        existingAppointments: apptsByStaffServiceForDate(ctx.allAppointments, [ssId], selectedDate)[ssId] ?? [],
      });

      if (!result.isWorkingDay) continue;

      const slots = filterBookableFutureSlots(result.slots, selectedDate, ctx.now);
      for (const slot of slots) {
        options.push({
          draftIndex,
          date: selectedDate.toISOString(),
          time: slot.time,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
        });
        if (options.length >= maxProposals) break;
      }
    }

    return options;
  });

  if (perDraftOptions.some((opts) => opts.length === 0)) return [];

  const proposals = [];
  for (let k = 0; k < maxProposals; k++) {
    if (!perDraftOptions.every((opts) => opts[k])) break;

    proposals.push({
      recommended: k === 0,
      appointments: perDraftOptions.map((opts) => opts[k]),
    });
  }

  return proposals;
}
