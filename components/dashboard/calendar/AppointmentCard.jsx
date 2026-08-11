"use client";

import { getStaffColor } from "./staffColors";

/**
 * Compact appointment card used inside the Day and Week grid views.
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

  return (
    <button
      onClick={() => onClick(appointment)}
      className="w-full rounded-lg border text-left transition-all hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      style={{
        backgroundColor: color.bg,
        borderColor: color.border,
        color: color.text,
      }}
      aria-label={`${appointment.serviceName} — ${appointment.customerName}`}
    >
      <div className={`${compact ? "px-2 py-1" : "px-2.5 py-2"}`}>
        {/* Time + service name */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-bold tabular-nums opacity-80">
            {startLabel}
          </span>
          <span
            className={`truncate font-semibold leading-tight ${
              compact ? "text-[11px]" : "text-xs"
            }`}
          >
            {appointment.serviceName}
          </span>
        </div>

        {/* Customer name */}
        {!compact && (
          <p className="mt-0.5 truncate text-[11px] opacity-75">
            {appointment.customerName}
          </p>
        )}

        {/* Staff avatar + name */}
        {!compact && (
          <div className="mt-1.5 flex items-center gap-1.5">
            {appointment.staffPhoto ? (
              <img
                src={appointment.staffPhoto}
                alt={appointment.staffName}
                className="h-4 w-4 rounded-full object-cover"
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
            <span className="truncate text-[11px] opacity-75">
              {appointment.staffName}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}
