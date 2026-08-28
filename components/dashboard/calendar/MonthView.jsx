"use client";

import { useTranslations } from "next-intl";
import {
  getMonthGrid,
  appointmentsForDay,
  activityEventsForDay,
  timeOffsForDay,
  isToday,
  isClosureDay,
} from "./calendarUtils";
import { Lock } from "lucide-react";

const MAX_VISIBLE = 3;

/**
 * Classic month grid. Each cell shows appointment chips, activity event chips,
 * and time-off chips.  Clicking a cell navigates to Day View.
 *
 * @param {{
 *   currentDate: Date,
 *   appointments: Array<object>,
 *   activityEvents: Array<object>,
 *   staff: Array<object>,
 *   showActivityLane: boolean,
 *   closures: Array<{ startDate: string, endDate?: string }>,
 *   onDayClick: (date: Date) => void,
 *   onAppointmentClick: (appt: object) => void,
 * }} props
 */
export function MonthView({
  currentDate,
  appointments,
  activityEvents = [],
  timeOffs = [],
  staff = [],
  showActivityLane = false,
  closures = [],
  onDayClick,
  onAppointmentClick,
}) {
  const t = useTranslations();
  const grid = getMonthGrid(currentDate);
  const currentMonth = currentDate.getMonth();

  const dayIndexToKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  function getDayName(dayIndex) {
    const key = dayIndexToKey[dayIndex];
    return t(`monthView.${key}`).substring(0, 3);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.03)] dark:border-gray-700/80 dark:bg-gray-dark">
      {/* ── Day-of-week headers ──────────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-700/50">
        {[1, 2, 3, 4, 5, 6, 0].map((dayIndex) => (
          <div
            key={dayIndex}
            className="py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
          >
            {getDayName(dayIndex)}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 divide-x divide-y divide-gray-100 dark:divide-gray-700/30">
        {grid.map((day, idx) => {
          const inMonth = day.getMonth() === currentMonth;
          const today = isToday(day);
          const isClosed = isClosureDay(day, closures);
          const dayAppts = appointmentsForDay(appointments, day);
          const dayActivities = showActivityLane ? activityEventsForDay(activityEvents, day) : [];
          const dayTimeOffs = timeOffsForDay(timeOffs, day);

          const allItems = [
            ...dayTimeOffs.map((to) => ({ ...to, _type: "timeoff" })),
            ...dayAppts.map((a) => ({ ...a, _type: "appointment" })),
            ...dayActivities.map((e) => ({ ...e, _type: e.kind })),
          ];
          const visible = allItems.slice(0, MAX_VISIBLE);
          const overflow = allItems.length - MAX_VISIBLE;

          return (
            <div
              key={idx}
              className={`relative min-h-[120px] p-2 transition-colors hover:bg-gray-50/40 dark:hover:bg-gray-700/30 ${
                inMonth ? "" : "bg-gray-50/20 dark:bg-gray-800/10"
              } ${today ? "bg-emerald-50/30 dark:bg-emerald-900/5" : ""} ${
                isClosed ? "bg-gray-50/40 dark:bg-gray-800/20" : ""
              }`}
            >
              {/* Closed-day indicator overlay */}
              {isClosed && (
                <div
                  className="pointer-events-none absolute inset-0 z-0 opacity-10 dark:opacity-5"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, #6b7280 0px, #6b7280 1px, transparent 1px, transparent 12px)",
                  }}
                />
              )}

              {/* Day number */}
              <button
                onClick={() => onDayClick(day)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold transition-colors relative z-10"
                style={
                  today
                    ? { backgroundColor: "#10b981", color: "white" }
                    : inMonth
                    ? { color: "#374151" }
                    : { color: "#D1D5DB" }
                }
              >
                {day.getDate()}
              </button>

              {/* Closed label */}
              {isClosed && (
                <div className="relative z-10 mt-1 inline-block">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    Fermé
                  </span>
                </div>
              )}

              {/* Event chips */}
              {!isClosed && (
                <div className="mt-2 space-y-1">
                  {visible.map((item) => {
                    // ── TimeOff chip ──────────────────────────────────────
                    if (item._type === "timeoff") {
                      const isFullDay = item.isFullDay !== false;
                      return (
                        <div
                          key={`to-${item.id}`}
                          className="flex w-full items-center gap-1.5 truncate rounded-md border border-dashed px-2 py-1 text-[10px] font-medium relative z-10"
                          style={{
                            backgroundColor: "rgba(238,233,249,0.6)",
                            borderColor: "#C4B5FD",
                          }}
                          title={`Indisponible — ${item.staffName}${isFullDay ? " — Journée complète" : ""}${item.reason ? ` — ${item.reason}` : ""}`}
                        >
                          <Lock size={9} className="shrink-0 text-violet-500 dark:text-violet-400" />
                          <span className="truncate font-semibold text-violet-700 dark:text-violet-300">
                            Indisponible{item.reason ? ` — ${item.reason}` : ""}
                          </span>
                        </div>
                      );
                    }

                    // ── Appointment chip ──────────────────────────────────
                    if (item._type === "appointment") {
                      const timeLabel = item.startTime
                        ? new Date(item.startTime).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Europe/Brussels",
                          })
                        : "";

                      return (
                        <button
                          key={item.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAppointmentClick(item);
                          }}
                          className="flex w-full items-center justify-between gap-1 truncate rounded-md border border-gray-200/60 bg-white px-2 py-1 text-left text-[10px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:shadow-[0_2px_4px_rgba(0,0,0,0.06)] relative z-10 dark:border-gray-700/60 dark:bg-gray-800"
                          title={`${timeLabel} — ${item.serviceName} — ${item.customerName}`}
                        >
                          <span className="truncate font-semibold text-gray-800 dark:text-white">{item.serviceName}</span>
                          <span className="flex-shrink-0 rounded bg-gray-100 px-1 py-px text-[7px] font-bold uppercase tracking-wider text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                            RDV
                          </span>
                        </button>
                      );
                    }

                    // ── Activity event chip (atelier/formation) ───────────
                    const isFormation = item._type === "formation";
                    const timeLabel = item.start
                      ? new Date(item.start).toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Europe/Brussels",
                        })
                      : "";
                    const typeLabel = isFormation ? "Formation" : item._type === "atelier" ? "Atelier" : "Événement";

                    return (
                      <div
                        key={`activity-${item.id}`}
                        className={`flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-[11px] font-medium relative z-10 ${
                          isFormation
                            ? "bg-blue-50/80 dark:bg-blue-900/20"
                            : "bg-amber-50/80 dark:bg-amber-900/20"
                        }`}
                        style={{
                          borderLeft: `2px solid ${isFormation ? "#60A5FA" : "#FBBF24"}`,
                        }}
                        title={`${typeLabel} — ${item.title} — ${item.subtitle} (${timeLabel})`}
                      >
                        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wide ${
                          isFormation ? "text-blue-500 dark:text-blue-400" : "text-amber-500 dark:text-amber-400"
                        }`}>
                          {typeLabel}
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400 font-mono text-[10px]">
                          {timeLabel}
                        </span>
                        <span className="truncate text-gray-900 dark:text-white font-semibold">{item.title}</span>
                      </div>
                    );
                  })}

                  {/* +X more */}
                  {overflow > 0 && (
                    <button
                      onClick={() => onDayClick(day)}
                      className="w-full rounded-md px-2 py-1 text-left text-[11px] font-medium text-gray-500 hover:bg-gray-100/60 dark:text-gray-400 dark:hover:bg-gray-700/40 relative z-10"
                    >
                      +{overflow} de plus
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-5 border-t border-gray-100 px-5 py-2.5 dark:border-gray-700/50 text-[11px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium">Confirmé</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-dashed border-violet-300 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/20">
            <Lock size={8} className="text-violet-500" />
          </span>
          <span className="font-medium">Indisponible</span>
        </div>
      </div>
    </div>
  );
}
