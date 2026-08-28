"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildTimeSlots,
  parseTime,
  getTopOffset,
  getEventHeight,
  getBrusselsMinutesOfDay,
  appointmentsForDay,
  activityEventsForDay,
  timeOffsForDay,
  getStaffWorkingHoursForDay,
  getStaffAvailabilityStatus,
  staffWorkingHoursLabel,
  formatDayFull,
  isToday,
  isClosureDay,
} from "./calendarUtils";
import { AppointmentCard } from "./AppointmentCard";
import { CalendarEventCard } from "./CalendarEventCard";
import { TimeOffCard } from "./TimeOffCard";
import { StaffColumnHeader } from "./StaffColumnHeader";
import { Calendar } from "lucide-react";

// 1 hour = HOUR_HEIGHT pixels. The visible scale is hourly (09:00, 10:00, …).
const HOUR_HEIGHT = 80;
const TIME_COL_W = 70;
const STAFF_COL_MIN_W = 160;
const GRID_TOP_PAD = 0;
const STAFF_HEADER_H = 48;
const EVENT_PADDING = 6; // horizontal padding inside columns for events

/**
 * Calculate positions for overlapping events.
 * All events get full column width (totalCols=1). Overlapping events are
 * vertically stacked: each event is assigned a slot (row) and a vertical
 * offset within its time range, so events never visually overlap.
 */
function calculateEventPositions(events) {
  if (!events || events.length === 0) return [];

  const withTimes = [...events]
    .map((event) => {
      const startMin =
        getBrusselsMinutesOfDay(event.startTime || event.start || event.startDate) ?? 0;
      let endMin =
        getBrusselsMinutesOfDay(event.endTime || event.end || event.endDate) ?? startMin + 60;
      
      // If start and end are the same, add minimum duration (60 minutes)
      if (endMin <= startMin) {
        endMin = startMin + 60;
      }
      
      return { ...event, _start: startMin, _end: endMin };
    })
    .sort((a, b) => a._start - b._start || (a._end - a._start) - (b._end - b._start));

  const n = withTimes.length;

  // 1) Build overlap graph.
  const adj = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (withTimes[i]._start < withTimes[j]._end && withTimes[j]._start < withTimes[i]._end) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // 2) Find connected components via BFS.
  const visited = new Array(n).fill(false);
  const components = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const comp = [];
    const queue = [i];
    visited[i] = true;
    while (queue.length > 0) {
      const cur = queue.shift();
      comp.push(cur);
      for (const nb of adj[cur]) {
        if (!visited[nb]) {
          visited[nb] = true;
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // 3) Assign vertical slots within each component.
  const slotFor = new Array(n).fill(0);
  const slotsInComponent = new Array(n).fill(1);

  for (const comp of components) {
    const placed = [];
    let maxSlot = 0;

    for (const idx of comp) {
      const ev = withTimes[idx];
      let slot = 0;
      while (true) {
        const collides = placed.some(
          (p) => p.slot === slot && p._start < ev._end && ev._start < p._end,
        );
        if (!collides) break;
        slot++;
      }
      placed.push({ slot, _start: ev._start, _end: ev._end });
      slotFor[idx] = slot;
      if (slot > maxSlot) maxSlot = slot;
    }

    const totalSlots = maxSlot + 1;
    for (const idx of comp) {
      slotsInComponent[idx] = totalSlots;
    }
  }

  // 4) Compute slotTop and slotHeight for each event.
  for (let i = 0; i < n; i++) {
    const ev = withTimes[i];
    const totalSlots = slotsInComponent[i];
    const slot = slotFor[i];
    const rangeHeight = ((ev._end - ev._start) * HOUR_HEIGHT) / 60;
    const slotHeight = rangeHeight / totalSlots;

    ev.slotTop = slot * slotHeight;
    ev.slotHeight = slotHeight;
    ev.totalCols = 1;
    ev.colIndex = 0;
  }

  return withTimes;
}

/**
 * Single-day view with time column, appointment cards, and current-time line.
 * For admin calendar: displays all events without staff separation.
 * For staff calendar: shows only that staff member's events.
 *
 * @param {{
 *   currentDate: Date,
 *   appointments: Array<object>,
 *   activityEvents: Array<object>,
 *   staff: Array<object>,
 *   showActivityLane: boolean,
 *   openingTime: string,
 *   closingTime: string,
 *   closures: Array<{ startDate: string, endDate?: string }>,
 *   onAppointmentClick: (appt: object) => void,
 * }} props
 */
export function DayView({
  currentDate,
  appointments,
  activityEvents = [],
  timeOffs = [],
  staff = [],
  showActivityLane = false,
  openingTime = "09:00",
  closingTime = "19:00",
  closures = [],
  onAppointmentClick,
}) {
  const t = useTranslations();
  const dayAppts = appointmentsForDay(appointments, currentDate);
  const dayActivities = showActivityLane ? activityEventsForDay(activityEvents, currentDate) : [];
  const isMultiStaff = showActivityLane && staff.length > 0 && staff[0]?.id;

  // Get TimeOff for selected staff (if any)
  const dayTimeOffs = timeOffs.length > 0
    ? timeOffsForDay(timeOffs, currentDate)
    : [];

  const slots = buildTimeSlots(openingTime, closingTime); // hourly labels
  const gridRef = useRef(null);
  const today = isToday(currentDate);
  const [nowTop, setNowTop] = useState(null);
  const hasEvents = dayAppts.length > 0 || dayActivities.length > 0 || dayTimeOffs.length > 0;

  // ── Closed-day check ─────────────────────────────────────────────────────
  const isClosed = isClosureDay(currentDate, closures);

  // ── Current time indicator ───────────────────────────────────────────────
  function computeNowTop() {
    if (!today) return null;
    const now = new Date();
    const { hour: oh, minute: om } = parseTime(openingTime);
    const openMin = oh * 60 + om;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const delta = nowMin - openMin;
    if (delta < 0) return null;
    const { hour: ch, minute: cm } = parseTime(closingTime);
    const closeMin = ch * 60 + cm;
    if (nowMin > closeMin) return null;
    return (delta * HOUR_HEIGHT) / 60;
  }

  useEffect(() => {
    const update = () => setNowTop(computeNowTop());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [currentDate, openingTime, closingTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to current time / first event on mount
  useEffect(() => {
    if (!gridRef.current) return;
    if (nowTop !== null) {
      gridRef.current.scrollTop = Math.max(0, nowTop - 120);
    } else if (hasEvents) {
      const allStarts = [
        ...dayAppts.map((a) => a.startTime),
        ...dayActivities.map((e) => e.start),
      ].filter(Boolean).sort();
      if (allStarts.length > 0) {
        const firstTop = getTopOffset(allStarts[0], openingTime, HOUR_HEIGHT);
        gridRef.current.scrollTop = Math.max(0, firstTop - 60);
      }
    }
  }, [currentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Staff-specific data ────────────────────────────────────────────────────
  // When in multi-staff mode, partition appointments and timeOffs by staff.
  // For admin calendar (showActivityLane true but no staff data), use single column.
  const staffColumns = isMultiStaff && staff.length > 0
    ? staff.map((member) => ({
        ...member,
        appointments: dayAppts.filter((a) => a.staffId === member.id),
        activities: dayActivities.filter((a) => !a.staffId || a.staffId === member.id),
        timeOffs: timeOffsForDay(member.timeOffs || [], currentDate),
      }))
    : [];

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {/* ── Closed state ──────────────────────────────────────────────── */}
          {isClosed ? (
            <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden py-24 text-center">
              <div
                className="absolute inset-0 opacity-15 dark:opacity-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, #9ca3af 0px, #9ca3af 2px, transparent 2px, transparent 16px)",
                }}
              />
              <div className="relative z-10 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <Calendar className="h-8 w-8 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
              </div>
              <p className="relative z-10 text-sm font-semibold text-gray-400 dark:text-gray-500">
                Le salon est fermé ce jour.
              </p>
            </div>
          ) : /* ── Empty state ─────────────────────────────────────────────────── */
          !hasEvents && !isMultiStaff ? (
            <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                <Calendar className="h-8 w-8 text-gray-400" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("calendarView.noReservations")}
              </p>
            </div>
          ) : (
            /* ── Scrollable time grid ──────────────────────────────────────── */
            <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
              {isMultiStaff && staffColumns.length > 0 ? (
                /* ── Multi-staff layout (staff calendar) ──────────────────────── */
                <div
                  className="relative flex"
                  style={{ minHeight: `${slots.length * HOUR_HEIGHT}px` }}
                >
                  {/* Time column */}
                  <div
                    className="relative flex-shrink-0 border-r border-gray-200/80 bg-gradient-to-b from-gray-50/80 to-gray-50/40 dark:border-gray-700/80 dark:from-gray-800/30 dark:to-gray-800/10"
                    style={{ width: TIME_COL_W }}
                  >
                    {/* Spacer matching staff header height */}
                    <div style={{ height: STAFF_HEADER_H }} />
                    {slots.map((slot, i) => (
                      <div
                        key={slot}
                        className="flex items-center justify-end border-b border-gray-100/60 pr-3 text-right dark:border-gray-700/30"
                        style={{ height: HOUR_HEIGHT }}
                      >
                        <span className="text-[13px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                          {slot}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Staff columns */}
                  {staffColumns.map((member) => {
                    const whLabel = staffWorkingHoursLabel(member, currentDate);
                    const availability = getStaffAvailabilityStatus(member, currentDate);

                    return (
                      <div
                        key={member.id}
                        className="relative flex flex-col border-r border-gray-200/80 last:border-r-0 dark:border-gray-700/80"
                        style={{ minWidth: STAFF_COL_MIN_W, flex: 1 }}
                      >
                        {/* Staff header */}
                        <StaffColumnHeader
                          staff={member}
                          workingHoursLabel={whLabel}
                          availability={availability}
                        />

                        {/* Time grid area */}
                        <div className="relative flex-1 bg-white dark:bg-gray-800/30">
                          {/* Row lines */}
                          {slots.map((_, i) => (
                            <div
                              key={i}
                              className="absolute left-0 right-0 border-b border-gray-100/60 dark:border-gray-700/20"
                              style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                            />
                          ))}

                          {/* TimeOff / activity / appointment cards */}
                          {(() => {
                            const positionedTimeOffs = member.timeOffs.map((to) => ({
                              ...to,
                              _renderType: 'timeoff',
                              _isFullDay: to.isFullDay !== false,
                            }));
                            const allEvents = [
                              ...member.activities.map((ev) => ({ ...ev, _renderType: 'activity' })),
                              ...member.appointments.map((a) => ({ ...a, _renderType: 'appointment' })),
                            ];
                            const positionedEvents = calculateEventPositions(allEvents);
                            const allPositioned = [...positionedTimeOffs, ...positionedEvents];

                            return allPositioned.map((event) => {
                              const isFullDay = event._renderType === 'timeoff' && event._isFullDay;

                              // Full-day time off spans the whole working grid.
                              if (isFullDay) {
                                return (
                                  <div
                                    key={`to-${event.id}`}
                                    className="absolute z-15"
                                    style={{
                                      top: 0,
                                      height: `${slots.length * HOUR_HEIGHT}px`,
                                      left: EVENT_PADDING,
                                      right: EVENT_PADDING,
                                    }}
                                  >
                                    <TimeOffCard timeOff={event} fullDay />
                                  </div>
                                );
                              }

                              const startTime = event.startTime || event.start || event.startDate;
                              const endTime = event.endTime || event.end || event.endDate;
                              const top = getTopOffset(startTime, openingTime, HOUR_HEIGHT);
                              
                              // Calculate base height from actual duration
                              const calculatedHeight = getEventHeight(startTime, endTime, HOUR_HEIGHT);
                              
                              // Use slotHeight if assigned by overlap algorithm, otherwise use calculated height
                              // Ensure minimum height of 48px and maximum of calculated height
                              let height;
                              if (event.slotHeight && event.slotHeight > 0) {
                                // For overlapping events, respect the slot height but cap it
                                height = Math.min(event.slotHeight, calculatedHeight);
                              } else {
                                height = calculatedHeight;
                              }
                              
                              // Apply minimum and ensure we don't exceed original duration
                              height = Math.max(Math.min(height - 4, calculatedHeight), 48);
                              
                              const slotTopOffset = event.slotTop || 0;
                              const compact = height < 60;

                              return (
                                <div
                                  key={event.id}
                                  className="absolute z-15"
                                  style={{
                                    top: `${top + slotTopOffset + 2}px`,
                                    height: `${height}px`,
                                    left: EVENT_PADDING,
                                    right: EVENT_PADDING,
                                  }}
                                >
                                  {event._renderType === 'timeoff' ? (
                                    <TimeOffCard timeOff={event} compact={compact} />
                                  ) : event._renderType === 'activity' ? (
                                    <CalendarEventCard event={event} compact={compact} />
                                  ) : (
                                    <AppointmentCard
                                      appointment={event}
                                      onClick={onAppointmentClick}
                                      compact={compact}
                                    />
                                  )}
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                    );
                  })}

                  {/* Current time indicator — spans across all staff columns */}
                  {today && nowTop !== null && (
                    <div
                      className="pointer-events-none absolute z-30 flex items-center"
                      style={{ top: STAFF_HEADER_H + nowTop, left: TIME_COL_W, right: 0 }}
                    >
                      <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-md ring-2 ring-white dark:ring-gray-800" />
                      <span className="h-[2px] flex-1 bg-red-500 shadow-sm" />
                    </div>
                  )}
                </div>
              ) : (
                /* ── Single-column layout (admin calendar or staff view) ──────────── */
                <div
                  className="relative flex"
                  style={{ minHeight: `${slots.length * HOUR_HEIGHT}px` }}
                >
                  {/* Time column */}
                  <div
                    className="relative flex-shrink-0 border-r border-gray-200/80 bg-gradient-to-b from-gray-50/80 to-gray-50/40 dark:border-gray-700/80 dark:from-gray-800/30 dark:to-gray-800/10"
                    style={{ width: TIME_COL_W }}
                  >
                    {slots.map((slot, i) => (
                      <div
                        key={slot}
                        className="flex items-center justify-end border-b border-gray-100/60 pr-3 text-right dark:border-gray-700/30"
                        style={{ height: HOUR_HEIGHT }}
                      >
                        <span className="text-[13px] font-semibold tabular-nums text-gray-400 dark:text-gray-500">
                          {slot}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Event column */}
                  <div className="relative flex-1 bg-white dark:bg-gray-800/30">
                    {/* Row lines */}
                    {slots.map((_, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 border-b border-gray-100/60 dark:border-gray-700/20"
                        style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Current time indicator */}
                    {today && nowTop !== null && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-30 flex items-center"
                        style={{ top: nowTop }}
                      >
                        <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-md ring-2 ring-white dark:ring-gray-800" />
                        <span className="h-[2px] flex-1 bg-red-500 shadow-sm" />
                      </div>
                    )}

                    {/* Activity event cards */}
                    {(() => {
                      const positionedTimeOffs = dayTimeOffs.map((to) => ({
                        ...to,
                        _renderType: 'timeoff',
                        _isFullDay: to.isFullDay !== false,
                      }));
                      const allEvents = [
                        ...dayActivities.map((ev) => ({ ...ev, _renderType: 'activity' })),
                        ...dayAppts.map((a) => ({ ...a, _renderType: 'appointment' })),
                      ];
                      const positionedEvents = calculateEventPositions(allEvents);
                      const allPositioned = [...positionedTimeOffs, ...positionedEvents];

                      return allPositioned.map((event) => {
                        const isFullDay = event._renderType === 'timeoff' && event._isFullDay;

                        // Full-day time off spans the whole working grid.
                        if (isFullDay) {
                          return (
                            <div
                              key={`to-${event.id}`}
                              className="absolute z-15"
                              style={{
                                top: 0,
                                height: `${slots.length * HOUR_HEIGHT}px`,
                                left: EVENT_PADDING,
                                right: EVENT_PADDING,
                              }}
                            >
                              <TimeOffCard timeOff={event} fullDay />
                            </div>
                          );
                        }

                        const startTime = event.startTime || event.start || event.startDate;
                        const endTime = event.endTime || event.end || event.endDate;
                        const top = getTopOffset(startTime, openingTime, HOUR_HEIGHT);
                        
                        // Calculate base height from actual duration
                        const calculatedHeight = getEventHeight(startTime, endTime, HOUR_HEIGHT);
                        
                        // Use slotHeight if assigned by overlap algorithm, otherwise use calculated height
                        // Ensure minimum height of 48px and maximum of calculated height
                        let height;
                        if (event.slotHeight && event.slotHeight > 0) {
                          // For overlapping events, respect the slot height but cap it
                          height = Math.min(event.slotHeight, calculatedHeight);
                        } else {
                          height = calculatedHeight;
                        }
                        
                        // Apply minimum and ensure we don't exceed original duration
                        height = Math.max(Math.min(height - 4, calculatedHeight), 48);
                        
                        const slotTopOffset = event.slotTop || 0;
                        const compact = height < 60;

                        return (
                          <div
                            key={event.id}
                            className="absolute z-15"
                            style={{
                              top: `${top + slotTopOffset + 2}px`,
                              height: `${height}px`,
                              left: EVENT_PADDING,
                              right: EVENT_PADDING,
                            }}
                          >
                            {event._renderType === 'timeoff' ? (
                              <TimeOffCard timeOff={event} compact={compact} />
                            ) : event._renderType === 'activity' ? (
                              <CalendarEventCard event={event} compact={compact} />
                            ) : (
                              <AppointmentCard
                                appointment={event}
                                onClick={onAppointmentClick}
                                compact={compact}
                              />
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6 border-t border-gray-200/80 bg-gradient-to-b from-white to-gray-50/50 px-6 py-3.5 dark:border-gray-700/80 dark:from-gray-800/30 dark:to-gray-800/10">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#303c2f] shadow-sm ring-1 ring-[#303c2f]/20" />
          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400">Aujourd'hui</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-500 shadow-sm ring-1 ring-red-500/20" />
          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400">Heure actuelle</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-4 w-4 items-center justify-center rounded border border-dashed border-red-300 bg-red-50 dark:border-red-600 dark:bg-red-900/20">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-red-500 dark:text-red-400">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400">Indisponible</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-900/10">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600 dark:text-blue-400">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-400">Formation / Atelier</span>
        </div>
      </div>
    </div>
  );
}
