"use client";

import { useEffect, useRef, useState } from "react";
import {
  getWeekDays,
  buildTimeSlots,
  parseTime,
  getTopOffset,
  getEventHeight,
  appointmentsForDay,
  activityEventsForDay,
  formatDayHeader,
  isSameDay,
  isToday,
} from "./calendarUtils";
import { AppointmentCard } from "./AppointmentCard";
import { ActivityPill } from "./ActivityPill";

const SLOT_HEIGHT = 64; // px per 30-min row
const TIME_COL_W = 56; // px
const GRID_TOP_PAD = 16; // px — space above first row so the 09:00 label is fully visible

/**
 * 7-column weekly grid view with time rows and floating appointment cards.
 *
 * @param {{
 *   currentDate: Date,
 *   appointments: Array<object>,
 *   activityEvents: Array<object>,
 *   showActivityLane: boolean,
 *   openingTime: string,
 *   closingTime: string,
 *   workingDays: Array<{ day: string, isOpen: boolean }>,
 *   onAppointmentClick: (appt: object) => void,
 *   onDayClick: (date: Date) => void,
 * }} props
 */
export function WeekView({
  currentDate,
  appointments,
  activityEvents = [],
  showActivityLane = false,
  openingTime = "09:00",
  closingTime = "19:00",
  workingDays = [],
  onAppointmentClick,
  onDayClick,
}) {
  const days = getWeekDays(currentDate);
  const slots = buildTimeSlots(openingTime, closingTime);
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
    return (delta * SLOT_HEIGHT) / 30;
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isCurrentWeek = days.some((d) => isToday(d));

  // ── Closed-day lookup ────────────────────────────────────────────────────
  // Map Prisma WeekDay enum → JS getDay() index (0=Sun…6=Sat)
  const WEEKDAY_TO_JS = {
    SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
    THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
  };
  const openJsDays = new Set(
    workingDays
      .filter((wd) => wd.isOpen)
      .map((wd) => WEEKDAY_TO_JS[wd.day])
      .filter((n) => n !== undefined),
  );
  // If no working-day data at all, treat every day as open
  const hasWorkingDayData = workingDays.length > 0;
  function isDayClosed(date) {
    if (!hasWorkingDayData) return false;
    return !openJsDays.has(date.getDay());
  }

  const activitiesByDay = days.map((day) => activityEventsForDay(activityEvents, day));
  const hasAnyActivities = showActivityLane && activitiesByDay.some((list) => list.length > 0);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Day headers ──────────────────────────────────────────────────── */}
      <div
        className="grid border-b border-gray-200 dark:border-gray-700"
        style={{
          gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
        }}
      >
        {/* Time col header */}
        <div className="h-12 border-r border-gray-100 dark:border-gray-700" />

        {days.map((day) => {
          const today = isToday(day);
          const closed = isDayClosed(day);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`flex h-12 flex-col items-center justify-center border-r border-gray-100 text-xs transition-colors last:border-r-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 ${
                today && !closed ? "bg-[#f7f9f6] dark:bg-[#1a2618]" : ""
              } ${closed ? "bg-gray-50 dark:bg-gray-800/40" : ""}`}
            >
              <span className={`font-medium ${closed ? "text-gray-300 dark:text-gray-600" : "text-gray-400"}`}>
                {["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"][day.getDay()]}
              </span>
              <span
                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
                  today && !closed
                    ? "bg-[#2f3a2e] text-white dark:bg-white dark:text-[#2f3a2e]"
                    : closed
                    ? "text-gray-300 dark:text-gray-600"
                    : "text-gray-700 dark:text-gray-200"
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Ateliers & Formations strip (admin only, non-scrolling) ────────── */}
      {hasAnyActivities && (
        <div
          className="grid border-b border-gray-200 dark:border-gray-700"
          style={{ gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))` }}
        >
          <div className="border-r border-gray-100 dark:border-gray-700" />
          {activitiesByDay.map((dayActivities, i) => (
            <div
              key={days[i].toISOString()}
              className="space-y-1 border-r border-gray-100 p-1.5 last:border-r-0 dark:border-gray-700"
            >
              {dayActivities.map((ev) => (
                <ActivityPill key={ev.id} event={ev} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Scrollable time grid ─────────────────────────────────────────── */}
      <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `${TIME_COL_W}px repeat(7, minmax(0, 1fr))`,
            // Total height = top-pad + slots × SLOT_HEIGHT
            minHeight: `${GRID_TOP_PAD + slots.length * SLOT_HEIGHT}px`,
          }}
        >
          {/* ── Time labels column ─────────────────────────────────────── */}
          <div className="relative border-r border-gray-100 dark:border-gray-700">
            {slots.map((slot, i) => (
              <div
                key={slot}
                className="absolute right-0 pr-2 text-right text-[11px] font-medium text-gray-400"
                style={{
                  // Centre the label on the row divider line.
                  // Row line is at GRID_TOP_PAD + i * SLOT_HEIGHT.
                  // Shift up by half the text height (~8px) so it straddles the line.
                  top: GRID_TOP_PAD + i * SLOT_HEIGHT - 8,
                  width: TIME_COL_W,
                }}
              >
                {slot}
              </div>
            ))}
          </div>

          {/* ── Day columns ────────────────────────────────────────────── */}
          {days.map((day, colIdx) => {
            const dayAppts = appointmentsForDay(appointments, day);
            const today = isToday(day);
            const closed = isDayClosed(day);
            const showNow = today && isCurrentWeek && nowTop !== null;

            return (
              <div
                key={day.toISOString()}
                className={`relative border-r border-gray-100 last:border-r-0 dark:border-gray-700 ${
                  today && !closed ? "bg-[#fafcf9] dark:bg-[#141f13]" : ""
                }`}
                style={{ minHeight: `${GRID_TOP_PAD + slots.length * SLOT_HEIGHT}px` }}
              >
                {/* Closed-day overlay */}
                {closed && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-gray-50/80 dark:bg-gray-900/50">
                    {/* Diagonal stripe pattern via repeating-linear-gradient */}
                    <div
                      className="absolute inset-0 opacity-30 dark:opacity-20"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(135deg, #9ca3af 0px, #9ca3af 1px, transparent 1px, transparent 12px)",
                      }}
                    />
                    <span className="relative z-10 rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500">
                      Fermé
                    </span>
                  </div>
                )}

                {/* Row lines */}
                {slots.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-b border-gray-100 dark:border-gray-800"
                    style={{ top: GRID_TOP_PAD + i * SLOT_HEIGHT }}
                  />
                ))}

                {/* Current time indicator */}
                {showNow && (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: GRID_TOP_PAD + nowTop }}
                  >
                    <span className="ml-[-4px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-500" />
                    <span className="h-[2px] flex-1 bg-red-500" />
                  </div>
                )}

                {/* Appointment cards */}
                {!closed && dayAppts.map((appt) => {
                  const top = getTopOffset(appt.startTime, openingTime, SLOT_HEIGHT);
                  const height = getEventHeight(appt.startTime, appt.endTime, SLOT_HEIGHT);
                  const compact = height < 56;

                  return (
                    <div
                      key={appt.id}
                      className="absolute left-1 right-1 z-10 overflow-hidden"
                      style={{ top: GRID_TOP_PAD + top + 2, height: height - 4 }}
                    >
                      <AppointmentCard
                        appointment={appt}
                        onClick={onAppointmentClick}
                        compact={compact}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Confirmé — Seules les réservations confirmées sont affichées
        </div>
      </div>
    </div>
  );
}
