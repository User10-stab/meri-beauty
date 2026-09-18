"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, RotateCcw } from "lucide-react";

/**
 * Sélecteur de plage de dates de l'écran SEO.
 *
 * Comme la barre de filtres du Livre de recettes, il pilote l'URL plutôt
 * qu'un état local : le composant serveur relance alors les requêtes Search
 * Console pour la nouvelle fenêtre, une plage devient un lien partageable,
 * et le bouton « précédent » du navigateur se comporte normalement.
 *
 * Les raccourcis (7/28/90 jours) ne calculent pas de dates ici : ils vident
 * les paramètres et laissent resolveDateRange décider côté serveur, seul
 * endroit qui connaît le décalage de consolidation de Google. Un raccourci
 * qui calculerait « aujourd'hui moins 7 jours » dans le navigateur
 * afficherait systématiquement deux journées vides en bout de plage.
 */

const SHORTCUTS = [
  { days: 7, label: "7 jours" },
  { days: 28, label: "28 jours" },
  { days: 90, label: "3 mois" },
];

/** Décalage de consolidation appliqué par Google — voir DATA_LAG_DAYS. */
const DATA_LAG_DAYS = 3;

export function SeoDateRangeBar({ startDate, endDate }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function toDateOnlyString(date) {
    return date.toISOString().slice(0, 10);
  }

  function setParams(next) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, String(value));
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`/dashboard/seo?${params.toString()}`, { scroll: false });
    });
  }

  function applyShortcut(days) {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS);
    const start = new Date(end.getTime());
    start.setUTCDate(start.getUTCDate() - (days - 1));
    setParams({ du: toDateOnlyString(start), au: toDateOnlyString(end) });
  }

  const hasFilters = Boolean(searchParams.get("du")) || Boolean(searchParams.get("au"));

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div>
        <label
          htmlFor="seo-du"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Du
        </label>
        <input
          id="seo-du"
          type="date"
          value={startDate ?? ""}
          max={endDate || undefined}
          onChange={(event) => setParams({ du: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="seo-au"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Au
        </label>
        <input
          id="seo-au"
          type="date"
          value={endDate ?? ""}
          min={startDate || undefined}
          onChange={(event) => setParams({ au: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
          Période
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut.days}
              type="button"
              onClick={() => applyShortcut(shortcut.days)}
              className="rounded-full border border-stroke px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
            >
              {shortcut.label}
            </button>
          ))}
        </div>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push("/dashboard/seo", { scroll: false }))}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-2 text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Réinitialiser
        </button>
      )}
    </div>
  );
}
