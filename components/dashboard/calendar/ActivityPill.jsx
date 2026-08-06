"use client";

import { GraduationCap, PartyPopper } from "lucide-react";

/**
 * Compact card for an atelier/formation session, shown in the "Ateliers &
 * Formations" lane (Day view) or strip (Week view) — a separate lane rather
 * than a staff column since Animator (workshop/formation trainers) is an
 * unlinked directory from Staff (appointment-serving employees).
 *
 * @param {{ event: { id: string, kind: "atelier"|"formation", title: string, subtitle: string, start: string } }} props
 */
export function ActivityPill({ event }) {
  const Icon = event.kind === "formation" ? GraduationCap : PartyPopper;
  const time = new Date(event.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="flex items-start gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-[11px] leading-tight text-violet-800 dark:border-violet-900/40 dark:bg-violet-900/10 dark:text-violet-300"
      title={`${event.title} — ${event.subtitle} (${time})`}
    >
      <Icon size={12} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-semibold">{time} · {event.title}</p>
        <p className="truncate text-violet-600 dark:text-violet-400">{event.subtitle}</p>
      </div>
    </div>
  );
}
