"use client";

import { Ban } from "lucide-react";

/**
 * Staff Time Off card rendered inside the calendar time grid.
 *
 * Uses a clearly recognizable red visual design (red background, red border,
 * subtle diagonal stripe pattern overlay, bold "Indisponible" badge, and a
 * left accent stripe) so it is immediately obvious the staff member is
 * unavailable. When a reason is provided it is displayed inside the block.
 *
 * @param {{
 *   timeOff: { id: string, startDate: string, endDate: string, isFullDay: boolean, reason: string | null },
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
    : `${startLabel}${endLabel ? ` – ${endLabel}` : ""}`;

  return (
    <div
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border-2 border-red-400 bg-red-50 text-left shadow-sm transition-all duration-150 hover:shadow-lg dark:border-red-600 dark:bg-red-950/40 dark:text-red-100"
      title={`Indisponible${
        isFullDay ? " — Journée complète" : ` — ${timeLabel}`
      }${timeOff.reason ? ` — ${timeOff.reason}` : ""}`}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(239,68,68,0.10) 0px, rgba(239,68,68,0.10) 2px, transparent 2px, transparent 12px)",
        backgroundBlendMode: "multiply",
      }}
    >
      {/* Left accent stripe */}
      <span className="absolute inset-y-0 left-0 w-1 bg-red-500/70 dark:bg-red-500/60" />

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          compact ? "px-2.5 py-1.5 pl-3" : "px-3 py-2.5 pl-3.5"
        }`}
      >
        {/* Badge + time */}
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-0.5 rounded-md bg-red-600/90 px-1.5 py-0.5 font-bold text-[9px] uppercase tracking-wide text-white shadow-sm">
            <Ban size={11} className="text-white" />
            Indisponible
          </span>
          <span className="font-bold leading-none tabular-nums text-[11px] text-red-700 dark:text-red-300">
            {timeLabel}
          </span>
        </div>

        {/* Reason */}
        {timeOff.reason && (
          <p className="truncate text-[11px] font-semibold text-red-600/90 dark:text-red-300/90">
            {timeOff.reason}
          </p>
        )}
      </div>
    </div>
  );
}
