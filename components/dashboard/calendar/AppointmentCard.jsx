"use client";

import { getStaffColor } from "./staffColors";

/**
 * Appointment card for the calendar time grid - Admin Calendar optimized.
 * Clean design with colored background matching reference image.
 * Displays: Service name, time range, staff member.
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

  const timeRange = `${startLabel}${endLabel ? ` - ${endLabel}` : ""}`;

  return (
    <button
      onClick={() => onClick(appointment)}
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg text-left transition-all duration-200 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#303c2f]"
      style={{
        backgroundColor: color.bg,
        border: `1px solid ${color.border}`,
      }}
      aria-label={`${appointment.serviceName} — ${appointment.customerName} — ${appointment.staffName} — ${timeRange}`}
    >
      <div
        className={`relative flex min-w-0 flex-1 flex-col ${
          compact ? "gap-0 px-2.5 py-1.5" : "gap-0.5 px-3 py-2"
        }`}
      >
        {/* Header: Service name + RDV badge */}
        <div className="flex items-start justify-between gap-1.5">
          <h4
            className={`min-w-0 flex-1 truncate font-semibold leading-snug ${
              compact ? "text-[11px]" : "text-[12.5px]"
            }`}
            style={{ color: color.text }}
            title={appointment.serviceName}
          >
            {appointment.serviceName}
          </h4>
          <span
            className="flex-shrink-0 rounded bg-white/50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider shadow-sm"
            style={{ color: color.text }}
          >
            RDV
          </span>
        </div>

        {/* Time range */}
        <span 
          className={`tabular-nums font-semibold leading-tight ${compact ? "text-[10px]" : "text-[11px]"}`}
          style={{ color: color.text, opacity: 0.85 }}
        >
          {timeRange}
        </span>

        {/* Staff member */}
        {appointment.staffName && (
          <span 
            className={`truncate font-medium leading-tight ${compact ? "text-[9px]" : "text-[10px]"}`}
            style={{ color: color.text, opacity: 0.75 }}
            title={appointment.staffName}
          >
            {appointment.staffName}
          </span>
        )}
      </div>
    </button>
  );
}
