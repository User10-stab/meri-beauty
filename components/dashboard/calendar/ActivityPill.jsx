"use client";

import { GraduationCap, Sparkles, Badge } from "lucide-react";

/**
 * Compact card for an atelier/formation session, shown in the "Ateliers &
 * Formations" lane (Day view) or strip (Week view) — a separate lane rather
 * than a staff column since Animator (workshop/formation trainers) is an
 * unlinked directory from Staff (appointment-serving employees).
 * 
 * Enhanced with clear visual distinction between types and better readability.
 * Types: atelier (workshops/events), formation (training courses)
 *
 * @param {{ event: { id: string, kind: "atelier"|"formation", title: string, subtitle: string, start: string } }} props
 */
export function ActivityPill({ event }) {
  // Different styling for formations vs ateliers/events
  const isFormation = event.kind === "formation";
  const Icon = isFormation ? GraduationCap : Sparkles;
  
  // Formation: blue palette (educational)
  // Atelier: amber/orange palette (creative/workshop)
  const bgColor = isFormation 
    ? "bg-blue-50 dark:bg-blue-900/25" 
    : "bg-amber-50 dark:bg-amber-900/25";
  const borderColor = isFormation 
    ? "border-blue-300 dark:border-blue-700/60" 
    : "border-amber-300 dark:border-amber-700/60";
  const textColor = isFormation 
    ? "text-blue-900 dark:text-blue-200" 
    : "text-amber-900 dark:text-amber-200";
  const iconColor = isFormation 
    ? "text-blue-600 dark:text-blue-400" 
    : "text-amber-600 dark:text-amber-400";
  const badgeBg = isFormation 
    ? "bg-blue-100 dark:bg-blue-900/50" 
    : "bg-amber-100 dark:bg-amber-900/50";
  const badgeText = isFormation 
    ? "text-blue-700 dark:text-blue-300" 
    : "text-amber-700 dark:text-amber-300";
  const typeLabel = isFormation ? "Formation" : "Atelier";

  const time = new Date(event.start).toLocaleTimeString("fr-FR", { 
    hour: "2-digit", 
    minute: "2-digit", 
    timeZone: "Europe/Brussels" 
  });

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border-2 ${borderColor} ${bgColor} px-2.5 py-2 text-xs leading-tight ${textColor} transition-all hover:shadow-md hover:border-opacity-100`}
      title={`${typeLabel} • ${event.title} — ${event.subtitle} (${time})`}
    >
      {/* Icon with background */}
      <div className={`flex-shrink-0 mt-0.5 p-1 rounded ${badgeBg}`}>
        <Icon size={12} className={iconColor} />
      </div>
      
      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* Type badge + Time */}
        <div className="flex items-center gap-1 mb-0.5">
          <span className={`inline-block ${badgeBg} ${badgeText} rounded px-1 py-0.5 font-bold text-[9px] uppercase tracking-wide`}>
            {typeLabel}
          </span>
          <span className={`font-mono text-[10px] font-semibold ${badgeText}`}>
            {time}
          </span>
        </div>
        
        {/* Title */}
        <p className="truncate font-bold text-xs">
          {event.title}
        </p>
        
        {/* Subtitle */}
        <p className="truncate text-[10px] opacity-70 mt-0.5">{event.subtitle}</p>
      </div>
    </div>
  );
}
