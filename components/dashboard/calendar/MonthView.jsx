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
import { getStaffColor } from "./staffColors";
import { Ban } from "lucide-react";

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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Day-of-week headers ──────────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-800/30">
        {[1, 2, 3, 4, 5, 6, 0].map((dayIndex) => (
          <div
            key={dayIndex}
            className="py-4 text-center text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400"
          >
            {getDayName(dayIndex)}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 divide-x divide-y divide-gray-200 dark:divide-gray-700/50">
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
              className={`relative min-h-[140px] p-2 transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-700/50 ${
                inMonth ? "" : "bg-gray-50/40 dark:bg-gray-800/20"
              } ${today ? "bg-emerald-50/40 dark:bg-emerald-900/10" : ""} ${
                isClosed ? "bg-gray-100/60 dark:bg-gray-800/40" : ""
              }`}
            >
              {/* Closed-day indicator overlay */}
              {isClosed && (
                <div
                  className="pointer-events-none absolute inset-0 z-0 opacity-15 dark:opacity-10"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(135deg, #6b7280 0px, #6b7280 2px, transparent 2px, transparent 14px)",
                  }}
                />
              )}

              {/* Day number */}
              <button
                onClick={() => onDayClick(day)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition-colors relative z-10"
                style={
                  today
                    ? { backgroundColor: "#10b981", color: "white" }
                    : inMonth
                    ? { color: "#1f2937" }
                    : { color: "#9ca3af" }
                }
              >
                {day.getDate()}
              </button>

              {/* Closed label */}
              {isClosed && (
                <div className="relative z-10 mt-1 inline-block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
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
                          className="flex w-full items-center gap-1.5 truncate rounded-lg border-2 border-red-400 bg-red-50 px-2 py-1 text-[11px] font-semibold dark:border-red-600 dark:bg-red-900/30 dark:text-red-200 relative z-10"
                          title={`Indisponible — ${item.staffName}${isFullDay ? " — Journée complète" : ""}${item.reason ? ` — ${item.reason}` : ""}`}
                        >
                          <Ban size={10} className="shrink-0 text-red-500 dark:text-red-400" />
                          <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
                            {item.staffName}
                          </span>
                          <span className="truncate text-red-500/80 dark:text-red-300/70">
                            {isFullDay ? "Indisponible" : "Partiel"}{item.reason ? ` — ${item.reason}` : ""}
                          </span>
                        </div>
                      );
                    }

                    // ── Appointment chip ──────────────────────────────────
                    if (item._type === "appointment") {
                      const color = getStaffColor(item.staffId);
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
                          className="flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1 text-left text-[11px] font-semibold transition-all hover:shadow-sm border border-2 relative z-10"
                          style={{
                            backgroundColor: color.bg,
                            borderColor: color.border,
                            color: color.text,
                          }}
                          title={`${timeLabel} — ${item.serviceName} — ${item.customerName}`}
                        >
                          <span className="shrink-0 tabular-nums opacity-80 font-mono text-xs">
                            {timeLabel}
                          </span>
                          <span className="truncate">{item.serviceName}</span>
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
                    const chipBg = isFormation
                      ? "bg-blue-50 dark:bg-blue-900/30"
                      : "bg-amber-50 dark:bg-amber-900/30";
                    const chipBorder = isFormation
                      ? "border-blue-400 dark:border-blue-600"
                      : "border-amber-400 dark:border-amber-600";
                    const chipText = isFormation
                      ? "text-blue-800 dark:text-blue-200"
                      : "text-amber-800 dark:text-amber-200";

                    return (
                      <div
                        key={`activity-${item.id}`}
                        className={`flex w-full items-center gap-1.5 truncate rounded-lg px-2 py-1 text-[11px] font-semibold border-2 relative z-10 ${chipBg} ${chipBorder} ${chipText}`}
                        title={`${typeLabel} — ${item.title} — ${item.subtitle} (${timeLabel})`}
                      >
                        <span className="shrink-0 text-[9px] font-bold uppercase opacity-70">
                          {typeLabel}
                        </span>
                        <span className="shrink-0 tabular-nums opacity-80 font-mono text-xs">
                          {timeLabel}
                        </span>
                        <span className="truncate">{item.title}</span>
                      </div>
                    );
                  })}

                  {/* +X more */}
                  {overflow > 0 && (
                    <button
                      onClick={() => onDayClick(day)}
                      className="w-full rounded-lg px-2 py-1 text-left text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/60 relative z-10"
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
      <div className="flex flex-wrap items-center gap-6 border-t border-gray-200 bg-gray-50/30 px-5 py-3 dark:border-gray-700 dark:bg-gray-800/30 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm" />
          <span className="font-medium">Confirmé</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded border-2 border-red-400 bg-red-50 dark:border-red-600 dark:bg-red-900/30" />
          <span className="font-medium">Indisponible</span>
        </div>
      </div>
    </div>
  );
}
