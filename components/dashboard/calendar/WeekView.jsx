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
const TIME_COL_W = 60;
const HEADER_H = 48; // day date header height
const GRID_TOP_PAD = 16;

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
  // Splits horizontal space between overlapping events based on their real
  // start/end minutes. Each column's width is proportional; cards never
  // hardcode a width, so they fill the available space without overflowing.
  function calculateEventPositions(events) {
    if (!events || events.length === 0) return [];

    const positioned = [...events]
      .map((event) => {
        const startMin =
          getBrusselsMinutesOfDay(event.startTime || event.start || event.startDate) ?? 0;
        const endMin =
          getBrusselsMinutesOfDay(event.endTime || event.end || event.endDate) ??
          startMin + 60;
        return { ...event, _start: startMin, _end: endMin };
      })
      .sort((a, b) => a._start - b._start);

    // Greedy column packing using Brussels minutes (timezone-correct).
    const columns = []; // end minute-of-day for each column
    for (const ev of positioned) {
      let colIndex = columns.length;
      for (let i = 0; i < columns.length; i++) {
        if (columns[i] <= ev._start) {
          colIndex = i;
          break;
        }
      }
      if (colIndex < columns.length) columns[colIndex] = ev._end;
      else columns.push(ev._end);
      ev.colIndex = colIndex;
    }

    // Width = 1 / (columns among events that actually overlap this one),
    // so non-overlapping events keep the full column width.
    for (const ev of positioned) {
      let groupCols = ev.colIndex + 1;
      for (const other of positioned) {
        if (other === ev) continue;
        if (ev._start < other._end && other._start < ev._end) {
          groupCols = Math.max(groupCols, other.colIndex + 1);
        }
      }
      ev.totalCols = groupCols;
    }

    return positioned;
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Clean day headers row ──────────────────────────────────────────── */}
      <div
        className="grid border-b border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30"
        style={{
          gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
        }}
      >
        {/* Time col header */}
        <div className="border-r border-gray-200 dark:border-gray-700" style={{ height: HEADER_H }} />

        {days.map((day) => {
          const today = isToday(day);
          const closed = isDayClosed(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`flex flex-col items-center justify-center border-r border-gray-200 last:border-r-0 text-xs transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-700/50 ${
                today && !closed ? "bg-emerald-50 dark:bg-emerald-900/15" : ""
              } ${closed ? "bg-gray-50/60 dark:bg-gray-800/40" : ""}`}
              style={{ height: HEADER_H }}
            >
              <span className={`font-semibold uppercase tracking-wide text-[11px] ${closed ? "text-gray-300 dark:text-gray-600" : "text-gray-500 dark:text-gray-400"}`}>
                {getDayAbbr(day.getDay())}
              </span>
              <span
                className={`mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  today && !closed
                    ? "bg-emerald-500 text-white dark:bg-emerald-500"
                    : closed
                    ? "text-gray-300 dark:text-gray-600"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Clean scrollable time grid ─────────────────────────────────────── */}
      <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
            minHeight: `${GRID_TOP_PAD + slots.length * HOUR_HEIGHT}px`,
          }}
        >
          {/* ── Time labels column ─────────────────────────────────────── */}
          <div className="relative border-r border-gray-200 bg-gray-50/30 dark:border-gray-700 dark:bg-gray-800/20">
            {slots.map((slot, i) => (
              <div
                key={slot}
                className="absolute right-0 pr-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400"
                style={{
                  top: GRID_TOP_PAD + i * HOUR_HEIGHT - 8,
                  width: TIME_COL_W,
                }}
              >
                {slot}
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
                className={`relative border-r border-gray-100 last:border-r-0 dark:border-gray-700/50 ${
                  today && !closed ? "bg-white dark:bg-gray-800/50" : "bg-gray-50/30 dark:bg-gray-800/20"
                }`}
                style={{ minHeight: `${GRID_TOP_PAD + slots.length * HOUR_HEIGHT}px` }}
              >
                {/* Subtle hourly row lines */}
                {slots.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-b border-gray-100 dark:border-gray-700/30"
                    style={{ top: GRID_TOP_PAD + i * HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time indicator */}
                {showNow && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: GRID_TOP_PAD + nowTop }}
                  >
                    <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-sm" />
                    <span className="h-[2px] flex-1 bg-red-500/80" />
                  </div>
                )}

                {/* Closed-day overlay */}
                {closed && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-gray-50/90 dark:bg-gray-900/70">
                    <div
                      className="absolute inset-0 opacity-20 dark:opacity-10"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(135deg, #d1d5db 0px, #d1d5db 2px, transparent 2px, transparent 14px)",
                      }}
                    />
                    <span className="relative z-10 rounded-full border-2 border-gray-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gray-500 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      Fermé
                    </span>
                  </div>
                )}

                {/* Unified event cards with overlapping support */}
                {!closed && positionedEvents.map((event) => {
                  const isTimeOff = event.type === 'timeoff';
                  const isFullDay = isTimeOff && event.isFullDay !== false;

                  const startTime = event.startTime || event.start || event.startDate;
                  const endTime = event.endTime || event.end || event.endDate;

                  // Width/position are proportional to the number of overlapping
                  // columns — never hard-coded — so a single item fills the full
                  // width and overlapping items split the space evenly.
                  const widthPercent = 100 / event.totalCols;
                  const leftPercent = event.colIndex * widthPercent;

                  // Full-day time off spans the entire working grid.
                  if (isFullDay) {
                    return (
                      <div
                        key={`to-${event.id}`}
                        className="absolute z-10 overflow-hidden rounded-lg"
                        style={{
                          top: `${GRID_TOP_PAD}px`,
                          height: `${slots.length * HOUR_HEIGHT}px`,
                          left: `calc(${leftPercent}% + 2px)`,
                          width: `calc(${widthPercent}% - 4px)`,
                        }}
                      >
                        <TimeOffCard timeOff={event} fullDay />
                      </div>
                    );
                  }

                  const top = getTopOffset(startTime, openingTime, HOUR_HEIGHT);
                  const height = getEventHeight(startTime, endTime, HOUR_HEIGHT);
                  const compact = height < 52;

                  return (
                    <div
                      key={event.id}
                      className="absolute z-10 overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md"
                      style={{
                        top: `${GRID_TOP_PAD + top}px`,
                        height: `${height}px`,
                        left: `calc(${leftPercent}% + 2px)`,
                        width: `calc(${widthPercent}% - 4px)`,
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
      <div className="flex flex-wrap items-center gap-6 border-t border-gray-200 bg-gray-50/30 px-5 py-3 dark:border-gray-700 dark:bg-gray-800/30 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm" />
          <span className="font-medium">Confirmé</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" />
          <span className="font-medium">Heure actuelle</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded border-2 border-gray-300 dark:border-gray-600" style={{
            backgroundImage: "repeating-linear-gradient(135deg, #d1d5db 0px, #d1d5db 2px, transparent 2px, transparent 14px)",
            opacity: 0.5,
          }} />
          <span className="font-medium">Jour fermé</span>
        </div>
      </div>
    </div>
  );
}
