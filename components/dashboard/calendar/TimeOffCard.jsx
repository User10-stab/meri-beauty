"use client";

import { Lock } from "lucide-react";

/**
 * Staff Time Off card rendered inside the calendar time grid.
 * Red background with diagonal stripes, dashed border, and lock icon.
 *
 * @param {{
 *   timeOff: { id: string, startDate: string, endDate: string, isFullDay: boolean, reason: string | null, staffName?: string },
 *   compact?: boolean,
 *   fullDay?: boolean,
 * }} props
 */
export function TimeOffCard({ timeOff, compact = false, fullDay = false }) {
  const isFullDay = timeOff.isFullDay !== false;

  const startLabel = timeOff.startDate
    ? new Date(timeOff.startDate).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  const endLabel = timeOff.endDate
    ? new Date(timeOff.endDate).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  const timeLabel = isFullDay
    ? "Journée complète"
    : `${startLabel}${endLabel ? ` - ${endLabel}` : ""}`;

  const reasonLabel = timeOff.reason || "Indisponible";

  return (
    <div
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg  text-left transition-all duration-150"
      style={{
        backgroundColor: "rgba(254,226,226,0.8)",
        borderColor: "#FCA5A5",
      }}
      title={`Indisponible${
        isFullDay ? " — Journée complète" : ` — ${timeLabel}`
      }${timeOff.reason ? ` — ${timeOff.reason}` : ""}`}
    >
      {/* Subtle diagonal stripe overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(252,165,165,0.3) 0px, rgba(252,165,165,0.3) 2px, transparent 2px, transparent 12px)",
        }}
      />

      <div
        className={`relative flex min-w-0 flex-1 flex-col ${
          compact ? "gap-0 px-2.5 py-1.5" : "gap-0.5 px-3 py-2"
        }`}
      >
        {/* Header: lock icon + text */}
        <div className="flex items-start gap-1.5">
          <Lock
            size={compact ? 10 : 11}
            className="mt-0.5 flex-shrink-0 text-red-600"
            strokeWidth={2.5}
          />
          <span
            className={`min-w-0 flex-1 truncate font-semibold ${
              compact ? "text-[10px]" : "text-[11px]"
            } text-red-700`}
          >
            Indisponible <br />
            {reasonLabel}
          </span>
        </div>

        {/* Time range */}
        <span className={`pl-[18px] tabular-nums font-medium text-red-600 ${compact ? "text-[9px]" : "text-[10px]"}`}>
          {timeLabel}
        </span>
      </div>
    </div>
  );
}
