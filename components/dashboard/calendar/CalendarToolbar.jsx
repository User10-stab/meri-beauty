"use client";

import { ChevronLeft, ChevronRight, Filter } from "lucide-react";

/**
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-dark">
      {/* ── Today ─────────────────────────────────────────────────────── */}
      <button
        onClick={onToday}
        className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        Aujourd&apos;hui
      </button>

      {/* ── Prev / Next ────────────────────────────────────────────────── */}
      <div className="flex items-center">
        <button
          onClick={onPrev}
          aria-label="Période précédente"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={onNext}
          aria-label="Période suivante"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Period label ───────────────────────────────────────────────── */}
      <span className="min-w-[160px] text-sm font-semibold text-gray-800 dark:text-white">
        {periodLabel}
      </span>

      {/* ── Spacer ────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── View selector ─────────────────────────────────────────────── */}
      <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
        {views.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-all ${
              view === key
                ? "bg-[#2f3a2e] text-white shadow-sm dark:bg-white dark:text-[#2f3a2e]"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
