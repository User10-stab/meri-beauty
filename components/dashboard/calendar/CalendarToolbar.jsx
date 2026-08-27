"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

/**
 * Calendar navigation and view selector toolbar.
 * Redesigned with improved spacing, typography, and visual hierarchy.
 * 
 * @param {{
 *   view: "day" | "week" | "month",
 *   onViewChange: (v: string) => void,
 *   periodLabel: string,
 *   onPrev: () => void,
 *   onNext: () => void,
 *   onToday: () => void,
 * }} props
 */
export function CalendarToolbar({
  view,
  onViewChange,
  periodLabel,
  onPrev,
  onNext,
  onToday,
}) {
  const views = [
    { key: "day", label: "Jour" },
    { key: "week", label: "Semaine" },
    { key: "month", label: "Mois" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Navigation controls ───────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        <button
          onClick={onToday}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 hover:border-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:border-gray-500"
        >
          Aujourd&apos;hui
        </button>

        <div className="ml-1 flex items-center gap-0.5 border-l border-gray-200 pl-1 dark:border-gray-700">
          <button
            onClick={onPrev}
            aria-label="Période précédente"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
          <button
            onClick={onNext}
            aria-label="Période suivante"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <ChevronRight size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {/* ── Period label ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <Calendar size={16} className="text-gray-400 dark:text-gray-500" />
        <span className="min-w-[180px] text-base font-semibold text-gray-800 dark:text-gray-100">
          {periodLabel}
        </span>
      </div>

      {/* ── Spacer ────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── View selector ─────────────────────────────────────────────── */}
      <div className="flex rounded-lg border border-gray-200 bg-gray-50/50 p-1 dark:border-gray-700 dark:bg-gray-800/50 gap-0.5">
        {views.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-all ${
              view === key
                ? "bg-white text-[#2f3a2e] shadow-md border border-gray-200 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-700/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
