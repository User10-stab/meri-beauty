"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

/**
 * Calendar navigation and view selector toolbar - Admin Calendar optimized.
 * Ultra-clean minimalist design with improved button hierarchy, better spacing,
 * and seamless integration with the calendar aesthetic.
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
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200/80 bg-gradient-to-br from-white to-gray-50/50 px-5 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.02)] dark:border-gray-700/80 dark:from-gray-800/40 dark:to-gray-800/20">
      {/* ── Navigation controls ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Today button with icon */}
        <button
          onClick={onToday}
          className="group flex items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white px-3.5 py-2 text-[13px] font-semibold text-gray-700 shadow-sm transition-all hover:border-[#303c2f]/20 hover:bg-[#303c2f]/5 hover:text-[#303c2f] active:scale-95 dark:border-gray-700/80 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:border-[#303c2f]/30 dark:hover:bg-[#303c2f]/10 dark:hover:text-white"
        >
          <Calendar size={14} strokeWidth={2.5} className="transition-transform group-hover:scale-110" />
          Aujourd&apos;hui
        </button>

        {/* Navigation arrows */}
        <div className="flex items-center gap-1 rounded-xl border border-gray-200/80 bg-white p-1 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/60">
          <button
            onClick={onPrev}
            aria-label="Période précédente"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white"
          >
            <ChevronLeft size={18} strokeWidth={2.5} />
          </button>
          <button
            onClick={onNext}
            aria-label="Période suivante"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Period label */}
        <div className="flex items-center rounded-xl border border-gray-200/80 bg-gradient-to-br from-gray-50 to-white px-4 py-2 shadow-sm dark:border-gray-700/80 dark:from-gray-800/40 dark:to-gray-800/20">
          <span className="text-[14px] font-bold text-gray-800 dark:text-gray-100">
            {periodLabel}
          </span>
        </div>
      </div>

      {/* ── Spacer ────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── View selector ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl border border-gray-200/80 bg-white p-1 shadow-sm dark:border-gray-700/80 dark:bg-gray-800/60">
        {views.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`relative rounded-lg px-4 py-1.5 text-[13px] font-semibold transition-all ${
              view === key
                ? "bg-[#303c2f] text-white shadow-[0_2px_8px_rgba(48,60,47,0.25)] dark:bg-[#303c2f] dark:shadow-[0_2px_8px_rgba(48,60,47,0.4)]"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700/60 dark:hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
