"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildTimeSlots,
  parseTime,
  getTopOffset,
  getEventHeight,
  appointmentsForDay,
  formatDayFull,
  isToday,
} from "./calendarUtils";
import { AppointmentCard } from "./AppointmentCard";
import { Calendar } from "lucide-react";

const SLOT_HEIGHT = 64;
const TIME_COL_W = 64;
const GRID_TOP_PAD = 16; // px — space above first row so the opening-time label is fully visible

/**
 * Single-day view with time column, appointment cards, and current-time line.
 *
 * @param {{
 *   currentDate: Date,
 *   appointments: Array<object>,
 *   openingTime: string,
 *   closingTime: string,
 *   workingDays: Array<{ day: string, isOpen: boolean }>,
 *   onAppointmentClick: (appt: object) => void,
 * }} props
 */
export function DayView({
  currentDate,
  appointments,
  openingTime = "09:00",
  closingTime = "19:00",
  workingDays = [],
  onAppointmentClick,
}) {
  const dayAppts = appointmentsForDay(appointments, currentDate);
  const slots = buildTimeSlots(openingTime, closingTime);
  const gridRef = useRef(null);
  const today = isToday(currentDate);
  const [nowTop, setNowTop] = useState(null);

  // ── Closed-day check ─────────────────────────────────────────────────────
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
  const isClosed =
    workingDays.length > 0 && !openJsDays.has(currentDate.getDay());

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
    return (delta * SLOT_HEIGHT) / 30;
  }

  useEffect(() => {
    const update = () => setNowTop(computeNowTop());
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [currentDate, openingTime, closingTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to current time / first appointment on mount
  useEffect(() => {
    if (!gridRef.current) return;
    if (nowTop !== null) {
      gridRef.current.scrollTop = Math.max(0, nowTop - 120);
    } else if (dayAppts.length > 0) {
      const firstTop = getTopOffset(dayAppts[0].startTime, openingTime, SLOT_HEIGHT);
      gridRef.current.scrollTop = Math.max(0, firstTop - 60);
    }
  }, [currentDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Day header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <div>
          <h2 className="text-base font-semibold capitalize text-gray-800 dark:text-white">
            {formatDayFull(currentDate)}
          </h2>
          <p className="text-xs text-gray-400">
            {isClosed
              ? "Salon fermé ce jour"
              : dayAppts.length === 0
              ? "Aucune réservation confirmée"
              : `${dayAppts.length} réservation${dayAppts.length > 1 ? "s" : ""} confirmée${dayAppts.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isClosed && (
            <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500">
              Fermé
            </span>
          )}
          {today && (
            <span className="rounded-full bg-[#2f3a2e]/10 px-3 py-1 text-xs font-semibold text-[#2f3a2e] dark:bg-white/10 dark:text-white">
              Aujourd&apos;hui
            </span>
          )}
        </div>
      </div>

      {/* ── Closed state ──────────────────────────────────────────────────── */}
      {isClosed ? (
        <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden py-24 text-center">
          {/* Diagonal stripe background */}
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
      dayAppts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800">
            <Calendar className="h-7 w-7 text-gray-400" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Aucune réservation confirmée pour cette journée.
          </p>
        </div>
      ) : (
        /* ── Scrollable time grid ──────────────────────────────────────── */
        <div ref={gridRef} className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
          <div
            className="relative flex"
            style={{ minHeight: `${GRID_TOP_PAD + slots.length * SLOT_HEIGHT}px` }}
          >
            {/* Time column */}
            <div
              className="relative flex-shrink-0 border-r border-gray-100 dark:border-gray-700"
              style={{ width: TIME_COL_W }}
            >
              {slots.map((slot, i) => (
                <div
                  key={slot}
                  className="absolute right-0 pr-2 text-right text-[11px] font-medium text-gray-400"
                  style={{
                    top: GRID_TOP_PAD + i * SLOT_HEIGHT - 8,
                    width: TIME_COL_W,
                  }}
                >
                  {slot}
                </div>
              ))}
            </div>

            {/* Event column */}
            <div className="relative flex-1">
              {/* Row lines */}
              {slots.map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-b border-gray-100 dark:border-gray-800"
                  style={{ top: GRID_TOP_PAD + i * SLOT_HEIGHT }}
                />
              ))}

              {/* Current time indicator */}
              {today && nowTop !== null && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-20 flex items-center"
                  style={{ top: GRID_TOP_PAD + nowTop }}
                >
                  <span className="ml-[-5px] h-3 w-3 flex-shrink-0 rounded-full bg-red-500 shadow shadow-red-300" />
                  <span className="h-[2px] flex-1 bg-red-500" />
                </div>
              )}

              {/* Appointment cards */}
              {dayAppts.map((appt) => {
                const top = getTopOffset(appt.startTime, openingTime, SLOT_HEIGHT);
                const height = getEventHeight(appt.startTime, appt.endTime, SLOT_HEIGHT);
                const compact = height < 56;

                return (
                  <div
                    key={appt.id}
                    className="absolute left-2 right-2 z-10 overflow-hidden"
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
          </div>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-t border-gray-100 px-4 py-2.5 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Confirmé — Seules les réservations confirmées sont affichées
        </div>
      </div>
    </div>
  );
}
