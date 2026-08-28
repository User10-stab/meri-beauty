"use client";

import { GraduationCap, Sparkles, CalendarDays } from "lucide-react";

/**
 * Calendar event card for ateliers, formations, and events - Admin Calendar optimized.
 * Clean design with colored backgrounds matching appointment style.
 *
 * @param {{
 *   event: { 
 *     id: string, 
 *     kind: "atelier"|"formation"|"event", 
 *     title: string, 
 *     subtitle: string, 
 *     start: string, 
 *     end: string,
 *     animatorName?: string
 *   },
 *   compact?: boolean,
 * }} props
 */
export function CalendarEventCard({ event, compact = false }) {
  const isFormation = event.kind === "formation";
  const isAtelier = event.kind === "atelier";
  const Icon = isFormation ? GraduationCap : isAtelier ? Sparkles : CalendarDays;

  // Clean backgrounds by type matching the appointment card style
  const styles = isFormation
    ? {
        bg: "rgba(219,234,254,0.9)",
        borderColor: "#93C5FD",
        textColor: "#1E40AF",
        badgeBg: "rgba(59,130,246,0.15)",
        iconColor: "#3B82F6",
      }
    : isAtelier
    ? {
        bg: "rgba(254,243,199,0.9)",
        borderColor: "#FCD34D",
        textColor: "#92400E",
        badgeBg: "rgba(245,158,11,0.15)",
        iconColor: "#F59E0B",
      }
    : {
        bg: "rgba(245,243,255,0.9)",
        borderColor: "#C4B5FD",
        textColor: "#5B21B6",
        badgeBg: "rgba(139,92,246,0.15)",
        iconColor: "#8B5CF6",
      };

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

  const timeRange = `${startLabel}${endLabel ? ` - ${endLabel}` : ""}`;

  return (
    <div
      className="group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg text-left transition-all duration-200 hover:brightness-[0.97]"
      style={{
        backgroundColor: styles.bg,
        border: `1px solid ${styles.borderColor}`,
      }}
      title={`${typeLabel} — ${event.title}${event.subtitle ? ` — ${event.subtitle}` : ""} (${timeRange})`}
    >
      <div
        className={`relative flex min-w-0 flex-1 flex-col ${
          compact ? "gap-0 px-2.5 py-1.5" : "gap-0.5 px-3 py-2"
        }`}
      >
        {/* Header: Title + Type badge */}
        <div className="flex items-start justify-between gap-1.5">
          <h4
            className={`min-w-0 flex-1 truncate font-semibold leading-snug ${
              compact ? "text-[11px]" : "text-[12.5px]"
            }`}
            style={{ color: styles.textColor }}
            title={event.title}
          >
            {event.title}
          </h4>
          <span
            className={`flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider shadow-sm`}
            style={{ 
              backgroundColor: styles.badgeBg,
              color: styles.textColor,
            }}
          >
            <Icon size={9} strokeWidth={2.5} style={{ color: styles.iconColor }} />
            {compact ? typeLabel.substring(0, 3) : typeLabel}
          </span>
        </div>

        {/* Time range */}
        <span 
          className={`tabular-nums font-semibold leading-tight ${compact ? "text-[10px]" : "text-[11px]"}`}
          style={{ color: styles.textColor, opacity: 0.85 }}
        >
          {timeRange}
        </span>

        {/* Subtitle (only if not compact and exists) */}
        {!compact && event.subtitle && (
          <span 
            className="truncate text-[10px] font-medium leading-tight"
            style={{ color: styles.textColor, opacity: 0.7 }}
            title={event.subtitle}
          >
            {event.subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
