"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FifthDayAssignDialog, fifthDayLabel } from "@/components/dashboard/staff/FifthDayAssignDialog";

const capitalizeFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// « Julie, Lyly ou Marie », « Julie, Lyly, Marie et 2 autres » — the dialog lists them all.
const NAMES_SHOWN = 3;
function candidatesLabel(candidates) {
  const names = candidates.map((c) => c.name);
  if (names.length <= NAMES_SHOWN) return names.length > 1 ? `${names.slice(0, -1).join(", ")} ou ${names.at(-1)}` : names[0];
  const rest = names.length - NAMES_SHOWN;
  return `${names.slice(0, NAMES_SHOWN).join(", ")} et ${rest} autre${rest > 1 ? "s" : ""}`;
}

/**
 * The coming 5th days (a month's 5th Saturday…) of a weekday staff members
 * share by weeks of the month, that nobody has been given yet — nothing can
 * be booked on them until someone is. Admins only (app/dashboard/page.jsx).
 *
 * @param {{ days: Array<{ dateKey: string, day: string, candidates: Array<{ name: string }> }> }} props
 */
export function FifthDayAlert({ days }) {
  const router = useRouter();
  const [assigning, setAssigning] = useState(null);
  const close = useCallback(() => setAssigning(null), []);

  if (days.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="fifth-day-alert"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-400"
    >
      <span className="mt-0.5 shrink-0 text-lg leading-none">⚠</span>
      <div className="space-y-1.5">
        <p className="font-medium">
          {days.length > 1 ? "Des 5es jours du mois n'ont personne" : "Un 5e jour du mois n'a personne"} — aucune réservation
          n&apos;est possible tant qu&apos;il n&apos;est pas attribué.
        </p>
        <ul className="space-y-1">
          {days.map((d) => (
            <li key={d.dateKey} className="flex flex-wrap items-center gap-2">
              <span>{capitalizeFirst(fifthDayLabel(d.dateKey, d.day))}</span>
              <span className="text-amber-700/80">({candidatesLabel(d.candidates)})</span>
              <button
                type="button"
                onClick={() => setAssigning(d.dateKey)}
                className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Choisir
              </button>
            </li>
          ))}
        </ul>
      </div>

      {assigning && <FifthDayAssignDialog dateKey={assigning} onClose={close} onAssigned={() => router.refresh()} />}
    </div>
  );
}
