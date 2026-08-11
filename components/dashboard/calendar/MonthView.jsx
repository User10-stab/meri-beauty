"use client";

import {
  getMonthGrid,
  appointmentsForDay,
  isToday,
  isSameDay,
} from "./calendarUtils";
import { getStaffColor } from "./staffColors";

const FR_DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MAX_VISIBLE = 3;

/**
 * Classic month grid. Each cell shows appointment chips.
 * Clicking a cell navigates to Day View.
 *
 * @param {{
 *   currentDate: Date,
 *   appointments: Array<object>,
 *   onDayClick: (date: Date) => void,
 *   onAppointmentClick: (appt: object) => void,
 * }} props
 */
export function MonthView({
  currentDate,
  appointments,
  onDayClick,
  onAppointmentClick,
}) {
  const grid = getMonthGrid(currentDate);
  const currentMonth = currentDate.getMonth();

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Day-of-week headers ──────────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
        {FR_DAY_NAMES.map((name) => (
          <div
            key={name}
            className="py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-400"
          >
            {name}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 divide-x divide-y divide-gray-100 dark:divide-gray-700/50">
        {grid.map((day, idx) => {
          const inMonth = day.getMonth() === currentMonth;
          const today = isToday(day);
          const dayAppts = appointmentsForDay(appointments, day);
          const visible = dayAppts.slice(0, MAX_VISIBLE);
          const overflow = dayAppts.length - MAX_VISIBLE;

          return (
            <div
              key={idx}
              className={`relative min-h-[120px] p-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                inMonth ? "" : "bg-gray-50/50 dark:bg-gray-800/20"
              } ${today ? "bg-[#f7f9f6] dark:bg-[#141f13]" : ""}`}
            >
              {/* Day number */}
              <button
                onClick={() => onDayClick(day)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium transition-colors hover:bg-gray-200 dark:hover:bg-gray-700"
                style={
                  today
                    ? {
                        backgroundColor: "#2f3a2e",
                        color: "white",
                      }
                    : undefined
                }
              >
                <span
                  className={
                    !today && inMonth
                      ? "text-gray-700 dark:text-gray-200"
                      : !today
                      ? "text-gray-300 dark:text-gray-600"
                      : undefined
                  }
                >
                  {day.getDate()}
                </span>
              </button>

              {/* Appointment chips */}
              <div className="mt-1 space-y-0.5">
                {visible.map((appt) => {
                  const color = getStaffColor(appt.staffId);
                  const timeLabel = appt.startTime
                    ? new Date(appt.startTime).toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "Europe/Brussels",
                      })
                    : "";

                  return (
                    <button
                      key={appt.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAppointmentClick(appt);
                      }}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-medium transition-all hover:brightness-95"
                      style={{
                        backgroundColor: color.bg,
                        color: color.text,
                      }}
                      title={`${timeLabel} — ${appt.serviceName} — ${appt.customerName}`}
                    >
                      <span className="shrink-0 tabular-nums opacity-70">
                        {timeLabel}
                      </span>
                      <span className="truncate">{appt.serviceName}</span>
                    </button>
                  );
                })}

                {/* +X more */}
                {overflow > 0 && (
                  <button
                    onClick={() => onDayClick(day)}
                    className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    +{overflow} de plus
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
