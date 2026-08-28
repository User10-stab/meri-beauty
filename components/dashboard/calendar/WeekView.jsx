"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getWeekDays,
  buildTimeSlots,
  parseTime,
  getTopOffset,
  getEventHeight,
  getBrusselsMinutesOfDay,
  appointmentsForDay,
  activityEventsForDay,
  timeOffsForDay,
  isToday,
  isClosureDay,
} from "./calendarUtils";
import { AppointmentCard } from "./AppointmentCard";
import { CalendarEventCard } from "./CalendarEventCard";
import { TimeOffCard } from "./TimeOffCard";

// 1 hour = HOUR_HEIGHT pixels. The visible scale is hourly (09:00, 10:00, …).
const HOUR_HEIGHT = 80;
const TIME_COL_W = 70;
const HEADER_H = 60; // day date header height
const GRID_TOP_PAD = 0;
const EVENT_PADDING = 6; // horizontal padding inside day columns for events

/**
 * Modern admin calendar week view - clean unified interface.
 * Displays all appointments, formations, events, and ateliers without
 * staff column separation. Handles overlapping events gracefully.
 * For staff calendar: filters to show only that staff's data.
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
 *   onDayClick: (date: Date) => void,
 * }} props
 */
export function WeekView({
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
  onDayClick,
}) {
  const t = useTranslations();
  const days = getWeekDays(currentDate);

  const slots = buildTimeSlots(openingTime, closingTime); // hourly labels
  const gridRef = useRef(null);
  const [nowTop, setNowTop] = useState(null);

  // ── Current time indicator ───────────────────────────────────────────────
  function computeNowTop() {
    const now = new Date();
    const { hour: oh, minute: om } = parseTime(openingTime);
    const openMin = oh * 60 + om;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const delta = nowMin - openMin;
    if (delta < 0) return null;
    const closingParsed = parseTime(closingTime);
    const closeMin = closingParsed.hour * 60 + closingParsed.minute;
    if (nowMin > closeMin) return null;
    return (delta * HOUR_HEIGHT) / 60;
  }

  useEffect(() => {
    const update = () => setNowTop(computeNowTop());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [openingTime, closingTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to current time on mount
  useEffect(() => {
    if (gridRef.current && nowTop !== null) {
      gridRef.current.scrollTop = Math.max(0, nowTop - 120);
    }
  }, [currentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrentWeek = days.some((d) => isToday(d));

  // ── Closed-day lookup ────────────────────────────────────────────────────
  function isDayClosed(date) {
    return isClosureDay(date, closures);
  }

  const activitiesByDay = days.map((day) =>
    showActivityLane ? activityEventsForDay(activityEvents, day) : [],
  );

  // Map day index (0-6, where 0 is Sunday) to translation key
  const dayIndexToKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function getDayAbbr(dayIndex) {
    const key = dayIndexToKey[dayIndex];
    return t(`monthView.${key}`).substring(0, 3);
  }

  // ── Calculate overlapping event positions ───────────────────────────────
  // All events get full column width (totalCols=1). Overlapping events are
  // vertically stacked: each event is assigned a slot (row) and a vertical
  // offset within its time range, so events never visually overlap.
  // This matches MonthView's vertical list behavior.
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

    // 1) Build overlap graph — two events overlap if their time ranges intersect.
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

    // 3) Within each component, assign vertical slots (rows) so events
    //    never overlap in time at the same slot.
    const slotFor = new Array(n).fill(0);
    const slotsInComponent = new Array(n).fill(1);

    for (const comp of components) {
      const placed = []; // { slot, _start, _end }
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

    // 4) Compute slotTop (pixel offset) and constrained height for each event.
    //    Each slot gets an equal share of the event's time-range height.
    //    Events are stacked top-to-bottom within overlapping time ranges.
    for (let i = 0; i < n; i++) {
      const ev = withTimes[i];
      const totalSlots = slotsInComponent[i];
      const slot = slotFor[i];

      // The time-span height this event's slot can use
      const rangeHeight = ((ev._end - ev._start) * HOUR_HEIGHT) / 60;
      const slotHeight = rangeHeight / totalSlots;

      ev.slotTop = slot * slotHeight;
      ev.slotHeight = slotHeight;
      ev.totalCols = 1; // full width
      ev.colIndex = 0;
    }

    return withTimes;
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark">
      {/* ── Clean day headers row ──────────────────────────────────────────── */}
      <div
        className="grid border-b border-gray-200/80 bg-gradient-to-b from-gray-50 to-white dark:border-gray-700/80 dark:from-gray-800/40 dark:to-gray-800/20"
        style={{
          gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
        }}
      >
        {/* Time col header */}
        <div className="border-r border-gray-200/80 dark:border-gray-700/80" style={{ height: HEADER_H }} />

        {days.map((day) => {
          const today = isToday(day);
          const closed = isDayClosed(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`flex flex-col items-center justify-center gap-1 border-r border-gray-200/80 last:border-r-0 transition-all hover:bg-gray-100/60 dark:border-gray-700/80 dark:hover:bg-gray-700/30 ${
                today && !closed ? "bg-[#303c2f]/5 dark:bg-[#303c2f]/10" : ""
              } ${closed ? "bg-gray-100/40 dark:bg-gray-800/40" : ""}`}
              style={{ height: HEADER_H }}
            >
              <span className={`text-[11px] font-bold uppercase tracking-wider ${closed ? "text-gray-300 dark:text-gray-600" : "text-gray-400 dark:text-gray-500"}`}>
                {getDayAbbr(day.getDay())}
              </span>
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-bold transition-all ${
                  today && !closed
                    ? "bg-[#303c2f] text-white shadow-sm dark:bg-[#303c2f]"
                    : closed
                    ? "text-gray-300 dark:text-gray-600"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50"
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Clean scrollable time grid ─────────────────────────────────────── */}
      <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
            minHeight: `${slots.length * HOUR_HEIGHT}px`,
          }}
        >
          {/* ── Time labels column ─────────────────────────────────────── */}
          <div className="relative border-r border-gray-200/80 bg-gradient-to-b from-gray-50/80 to-gray-50/40 dark:border-gray-700/80 dark:from-gray-800/30 dark:to-gray-800/10">
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

          {/* ── Unified day columns (no staff separation) ─────────────────── */}
          {days.map((day, colIdx) => {
            const dayAppts = appointmentsForDay(appointments, day);
            const dayActivities = activitiesByDay[colIdx];
            const today = isToday(day);
            const closed = isDayClosed(day);
            const showNow = today && isCurrentWeek && nowTop !== null;

            // Get TimeOff for selected staff (if any)
            const dayTimeOffs = timeOffs.length > 0
              ? timeOffsForDay(timeOffs, day)
              : [];

            // Combine all events for positioning
            const allEvents = [
              ...dayAppts.map(a => ({ ...a, type: 'appointment' })),
              ...dayActivities.map(a => ({ ...a, type: 'activity' })),
              ...dayTimeOffs.map(to => ({ ...to, type: 'timeoff' }))
            ];

            const positionedEvents = calculateEventPositions(allEvents);

            return (
              <div
                key={day.toISOString()}
                className={`relative border-r border-gray-100/80 last:border-r-0 dark:border-gray-700/40 ${
                  today && !closed ? "bg-white dark:bg-gray-800/30" : "bg-gray-50/20 dark:bg-gray-800/10"
                }`}
                style={{ minHeight: `${slots.length * HOUR_HEIGHT}px` }}
              >
                {/* Hourly row lines */}
                {slots.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-b border-gray-100/60 dark:border-gray-700/20"
                    style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time indicator */}
                {showNow && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-30 flex items-center"
                    style={{ top: nowTop }}
                  >
                    <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-md ring-2 ring-white dark:ring-gray-800" />
                    <span className="h-[2px] flex-1 bg-red-500 shadow-sm" />
                  </div>
                )}

                {/* Closed-day overlay */}
                {closed && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-gray-50/95 dark:bg-gray-900/80">
                    <div
                      className="absolute inset-0 opacity-15 dark:opacity-10"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(135deg, #9ca3af 0px, #9ca3af 2px, transparent 2px, transparent 16px)",
                      }}
                    />
                    <span className="relative z-10 rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-400 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500">
                      Fermé
                    </span>
                  </div>
                )}

                {/* Unified event cards — full width, vertically stacked */}
                {!closed && positionedEvents.map((event) => {
                  const isTimeOff = event.type === 'timeoff';
                  const isFullDay = isTimeOff && event.isFullDay !== false;

                  // Full-day time off spans the entire working grid.
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
                      {event.type === 'appointment' ? (
                        <AppointmentCard
                          appointment={event}
                          onClick={onAppointmentClick}
                          compact={compact}
                        />
                      ) : event.type === 'timeoff' ? (
                        <TimeOffCard timeOff={event} compact={compact} />
                      ) : (
                        <CalendarEventCard event={event} compact={compact} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Clean legend ───────────────────────────────────────────────────── */}
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
