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
const TIME_COL_W = 64;
const STAFF_COL_MIN_W = 160;
const GRID_TOP_PAD = 16;

/**
 * Calculate column positions for overlapping events.
 * Returns each event with `colIndex` and `totalCols` so cards
 * can be placed side-by-side instead of stacking.
 */
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

  // Width of an event = 1 / (columns among events that actually overlap it).
  // A lone event (or one that doesn't overlap any other) keeps the full width,
  // so a single full-day Time Off is never squished to half width.
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
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Day header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
        <div>
          <h2 className="text-lg font-bold capitalize text-gray-800 dark:text-white">
            {formatDayFull(currentDate)}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {isClosed
              ? "Salon fermé ce jour"
              : !hasEvents
              ? t("calendarView.noReservations")
              : `${dayAppts.length + dayActivities.length} élément${dayAppts.length + dayActivities.length > 1 ? "s" : ""} ce jour`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isClosed && (
            <span className="rounded-full border-2 border-gray-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Fermé
            </span>
          )}
          {today && (
            <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              Aujourd&apos;hui
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          {/* ── Closed state ──────────────────────────────────────────────── */}
          {isClosed ? (
            <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden py-24 text-center">
              <div
                className="absolute inset-0 opacity-20 dark:opacity-10"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, #9ca3af 0px, #9ca3af 1px, transparent 1px, transparent 14px)",
                }}
              />
              <div className="relative z-10 mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <Calendar className="h-7 w-7 text-gray-300 dark:text-gray-600" strokeWidth={1.5} />
              </div>
              <p className="relative z-10 text-sm font-semibold text-gray-400 dark:text-gray-500">
                Le salon est fermé ce jour.
              </p>
            </div>
          ) : /* ── Empty state ─────────────────────────────────────────────────── */
          !hasEvents && !isMultiStaff ? (
            <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
                <Calendar className="h-7 w-7 text-gray-400" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                {t("calendarView.noReservations")}
              </p>
            </div>
          ) : (
            /* ── Scrollable time grid ──────────────────────────────────────── */
            <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
              {isMultiStaff && staffColumns.length > 0 ? (
                /* ── Multi-staff layout (staff calendar) ──────────────────────── */
                <div
                  className="relative flex"
                  style={{ minHeight: `${GRID_TOP_PAD + slots.length * HOUR_HEIGHT}px` }}
                >
                  {/* Time column */}
                  <div
                    className="relative flex-shrink-0 border-r border-gray-200 bg-gray-50/30 dark:border-gray-700 dark:bg-gray-800/20"
                    style={{ width: TIME_COL_W }}
                  >
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

                  {/* Staff columns */}
                  {staffColumns.map((member) => {
                    const whLabel = staffWorkingHoursLabel(member, currentDate);
                    const availability = getStaffAvailabilityStatus(member, currentDate);

                    return (
                      <div
                        key={member.id}
                        className="relative flex flex-col border-r border-gray-200 last:border-r-0 dark:border-gray-700"
                        style={{ minWidth: STAFF_COL_MIN_W, flex: 1 }}
                      >
                        {/* Staff header */}
                        <StaffColumnHeader
                          staff={member}
                          workingHoursLabel={whLabel}
                          availability={availability}
                        />

                        {/* Time grid area */}
                        <div className="relative flex-1 bg-white dark:bg-gray-800/50">
                          {/* Row lines */}
                          {slots.map((_, i) => (
                            <div
                              key={i}
                              className="absolute left-0 right-0 border-b border-gray-100/60 dark:border-gray-700/40"
                              style={{ top: GRID_TOP_PAD + i * HOUR_HEIGHT }}
                            />
                          ))}

                          {/* Current time indicator */}
                          {today && nowTop !== null && (
                            <div
                              className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                              style={{ top: GRID_TOP_PAD + nowTop }}
                            >
                              <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-sm" />
                              <span className="h-[2px] flex-1 bg-red-500/80" />
                            </div>
                          )}

                          {/* TimeOff / activity / appointment cards */}
                          {(() => {
                            const positionedTimeOffs = member.timeOffs.map((to) => ({
                              ...to,
                              _renderType: 'timeoff',
                              _isFullDay: to.isFullDay !== false,
                            }));
                            const positionedActivities = calculateEventPositions(
                              member.activities.map((ev) => ({ ...ev, _renderType: 'activity' }))
                            );
                            const positionedAppts = calculateEventPositions(
                              member.appointments.map((a) => ({ ...a, _renderType: 'appointment' }))
                            );
                            const allPositioned = [...positionedTimeOffs, ...positionedActivities, ...positionedAppts];

                            return allPositioned.map((event) => {
                              const isFullDay = event._renderType === 'timeoff' && event._isFullDay;

                              const widthPercent = 100 / (event.totalCols || 1);
                              const leftPercent = (event.colIndex || 0) * widthPercent;

                              // Full-day time off spans the whole working grid.
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

                              const startTime = event.startTime || event.start || event.startDate;
                              const endTime = event.endTime || event.end || event.endDate;
                              const top = getTopOffset(startTime, openingTime, HOUR_HEIGHT);
                              const height = getEventHeight(startTime, endTime, HOUR_HEIGHT);
                              const compact = height < 56;

                              return (
                                <div
                                  key={event.id}
                                  className="absolute z-10 overflow-hidden rounded-lg"
                                  style={{
                                    top: `${GRID_TOP_PAD + top}px`,
                                    height: `${height}px`,
                                    left: `calc(${leftPercent}% + 2px)`,
                                    width: `calc(${widthPercent}% - 4px)`,
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
                </div>
              ) : (
                /* ── Single-column layout (admin calendar or staff view) ──────────── */
                <div
                  className="relative flex"
                  style={{ minHeight: `${GRID_TOP_PAD + slots.length * HOUR_HEIGHT}px` }}
                >
                  {/* Time column */}
                  <div
                    className="relative flex-shrink-0 border-r border-gray-200 bg-gray-50/30 dark:border-gray-700 dark:bg-gray-800/20"
                    style={{ width: TIME_COL_W }}
                  >
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

                  {/* Event column */}
                  <div className="relative flex-1 bg-white dark:bg-gray-800/50">
                    {/* Row lines */}
                    {slots.map((_, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 border-b border-gray-100/60 dark:border-gray-700/40"
                        style={{ top: GRID_TOP_PAD + i * HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Current time indicator */}
                    {today && nowTop !== null && (
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                        style={{ top: GRID_TOP_PAD + nowTop }}
                      >
                        <span className="ml-[-6px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow-sm" />
                        <span className="h-[2px] flex-1 bg-red-500/80" />
                      </div>
                    )}

                    {/* Activity event cards */}
                    {(() => {
                      const positionedActivities = calculateEventPositions(
                        dayActivities.map((ev) => ({ ...ev, _renderType: 'activity' }))
                      );
                      const positionedTimeOffs = dayTimeOffs.map((to) => ({
                        ...to,
                        _renderType: 'timeoff',
                        _isFullDay: to.isFullDay !== false,
                      }));
                      const positionedAppts = calculateEventPositions(
                        dayAppts.map((a) => ({ ...a, _renderType: 'appointment' }))
                      );
                      const allPositioned = [...positionedTimeOffs, ...positionedActivities, ...positionedAppts];

                      return allPositioned.map((event) => {
                        const isFullDay = event._renderType === 'timeoff' && event._isFullDay;

                        const widthPercent = 100 / (event.totalCols || 1);
                        const leftPercent = (event.colIndex || 0) * widthPercent;

                        // Full-day time off spans the whole working grid.
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

                        const startTime = event.startTime || event.start || event.startDate;
                        const endTime = event.endTime || event.end || event.endDate;
                        const top = getTopOffset(startTime, openingTime, HOUR_HEIGHT);
                        const height = getEventHeight(startTime, endTime, HOUR_HEIGHT);
                        const compact = height < 56;

                        return (
                          <div
                            key={event.id}
                            className="absolute z-10 overflow-hidden rounded-lg"
                            style={{
                              top: `${GRID_TOP_PAD + top}px`,
                              height: `${height}px`,
                              left: `calc(${leftPercent}% + 2px)`,
                              width: `calc(${widthPercent}% - 4px)`,
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
      <div className="flex flex-wrap items-center gap-6 border-t border-gray-200 bg-gray-50/30 px-6 py-3 dark:border-gray-700 dark:bg-gray-800/30 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm" />
          <span className="font-medium">Confirmé</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm" />
          <span className="font-medium">Heure actuelle</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded border-2 border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/30" />
          <span className="font-medium">Indisponible</span>
        </div>
      </div>
    </div>
  );
}
