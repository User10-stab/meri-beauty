"use client";

import { GraduationCap, Sparkles, CalendarDays } from "lucide-react";

/**
 * Calendar event card for ateliers, formations, and events.
 * Rendered inside the same time grid as appointments, using the same
 * positioning system (getTopOffset / getEventHeight).
 *
 * @param {{
 *   event: { id: string, kind: "atelier"|"formation"|"event", title: string, subtitle: string, start: string, end: string },
 *   compact?: boolean,
 * }} props
 */
export function CalendarEventCard({ event, compact = false }) {
  const isFormation = event.kind === "formation";
  const isAtelier = event.kind === "atelier";
  const Icon = isFormation ? GraduationCap : isAtelier ? Sparkles : CalendarDays;

  // Color palette by type
  const bgColor = isFormation
    ? "bg-blue-50 dark:bg-blue-900/30"
    : isAtelier
    ? "bg-amber-50 dark:bg-amber-900/30"
    : "bg-violet-50 dark:bg-violet-900/30";

  const borderColor = isFormation
    ? "border-blue-400 dark:border-blue-600"
    : isAtelier
    ? "border-amber-400 dark:border-amber-600"
    : "border-violet-400 dark:border-violet-600";

  const textColor = isFormation
    ? "text-blue-900 dark:text-blue-100"
    : isAtelier
    ? "text-amber-900 dark:text-amber-100"
    : "text-violet-900 dark:text-violet-100";

  const iconColor = isFormation
    ? "text-blue-600 dark:text-blue-400"
    : isAtelier
    ? "text-amber-600 dark:text-amber-400"
    : "text-violet-600 dark:text-violet-400";

  const badgeBg = isFormation
    ? "bg-blue-100 dark:bg-blue-800/50"
    : isAtelier
    ? "bg-amber-100 dark:bg-amber-800/50"
    : "bg-violet-100 dark:bg-violet-800/50";

  const badgeText = isFormation
    ? "text-blue-700 dark:text-blue-300"
    : isAtelier
    ? "text-amber-700 dark:text-amber-300"
    : "text-violet-700 dark:text-violet-300";

  const typeLabel = isFormation ? "Formation" : isAtelier ? "Atelier" : "Événement";

  const startLabel = event.start
    ? new Date(event.start).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  const endLabel = event.end
    ? new Date(event.end).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "";

  return (
    <div
      className={`group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border-2 text-left shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-lg ${borderColor} ${bgColor} ${textColor}`}
      title={`${typeLabel} — ${event.title} — ${event.subtitle} (${startLabel}–${endLabel})`}
    >
      {/* Left accent stripe */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${
          isFormation
            ? "bg-blue-400 dark:bg-blue-500"
            : isAtelier
            ? "bg-amber-400 dark:bg-amber-500"
            : "bg-violet-400 dark:bg-violet-500"
        }`}
      />

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          compact ? "px-2.5 py-1.5 pl-3" : "px-3 py-2.5 pl-3.5"
        }`}
      >
        {/* Type badge + time */}
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-bold text-[9px] uppercase tracking-wide ${badgeBg} ${badgeText}`}
          >
            <Icon size={11} className={iconColor} />
            {typeLabel}
          </span>
          <span className={`font-bold leading-none tabular-nums text-[10px] ${badgeText}`}>
            {startLabel}
            {endLabel && <span className="opacity-60"> –{endLabel}</span>}
          </span>
        </div>

        {/* Title */}
        <p
          className={`min-w-0 truncate font-extrabold leading-tight tracking-tight ${
            compact ? "text-[13px]" : "text-[15px]"
          }`}
        >
          {event.title}
        </p>

        {/* Subtitle */}
        {!compact && event.subtitle && (
          <p className="mt-auto truncate pt-1.5 text-[11px] font-medium opacity-70">
            {event.subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
