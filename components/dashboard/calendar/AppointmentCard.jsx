"use client";

import { getStaffColor } from "./staffColors";
import { Clock, User } from "lucide-react";

/**
 * Compact appointment card used inside the Day and Week grid views.
 * Enhanced typography, clear time badge, left accent stripe, and a
 * bottom-anchored customer / staff footer for a polished, readable look.
 *
 * @param {{
 *   appointment: object,
 *   onClick: (appt: object) => void,
 *   compact?: boolean,
 * }} props
 */
export function AppointmentCard({ appointment, onClick, compact = false }) {
  const color = getStaffColor(appointment.staffId);

  const startLabel = appointment.startTime
    ? new Date(appointment.startTime).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  const endLabel = appointment.endTime
    ? new Date(appointment.endTime).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  const hasCategory =
    appointment.categoryName && appointment.categoryName !== "—";

  return (
    <button
      onClick={() => onClick(appointment)}
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border-2 text-left shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      style={{
        backgroundColor: color.bg,
        borderColor: color.border,
        color: color.text,
      }}
      aria-label={`${appointment.serviceName} — ${appointment.customerName} — ${startLabel}–${endLabel}`}
    >
      {/* Left accent stripe */}
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color.border }}
      />

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          compact ? "px-2.5 py-1.5 pl-3" : "px-3 py-2.5 pl-3.5"
        }`}
      >
        {/* Time badge */}
        <div className="mb-1 flex items-center">
          <span className="inline-flex items-center gap-1 rounded-md bg-white/55 px-1.5 py-0.5 font-bold leading-none tabular-nums text-[11px] dark:bg-black/10">
            <Clock size={compact ? 11 : 12} className="opacity-70" />
            {startLabel}
            {endLabel && <span className="opacity-60">–{endLabel}</span>}
          </span>
        </div>

        {/* Service name — primary focus */}
        <div
          className={`min-w-0 truncate font-extrabold leading-tight tracking-tight ${
            compact ? "text-[13px]" : "text-[15px]"
          }`}
        >
          {appointment.serviceName}
        </div>

        {/* Category badge */}
        {!compact && hasCategory && (
          <div className="mt-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest opacity-60">
              {appointment.categoryName}
            </span>
          </div>
        )}

        {/* Footer: customer + staff, anchored to bottom for tall cards */}
        {!compact && (
          <div className="mt-auto flex min-w-0 flex-col gap-1 pt-2">
            <div className="flex items-center gap-1.5 truncate text-xs font-medium opacity-85">
              <User size={12} className="flex-shrink-0 opacity-70" />
              <span className="truncate">{appointment.customerName}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate text-[11px] font-medium opacity-70">
              {appointment.staffPhoto ? (
                <img
                  src={appointment.staffPhoto}
                  alt={appointment.staffName}
                  className="h-4 w-4 flex-shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ backgroundColor: color.border, color: color.text }}
                >
                  {appointment.staffName
                    ?.split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
              )}
              <span className="truncate">{appointment.staffName}</span>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
