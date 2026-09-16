"use client";

import { Calendar, CalendarClock, RotateCcw } from "lucide-react";

/**
 * Date picker for the "état du stock" print link — same day/month pattern as
 * StockMovementsFilterBar (a day-precision input plus a month shortcut), but
 * for a single point-in-time date rather than a Du/Au range: the inventory
 * snapshot is "what was on hand at the close of this one day," not a period.
 * Picking a month resolves to that month's last day (or today, if it's the
 * current month) — the day input then shows exactly what got selected.
 */
export function StockSnapshotDateFilter({ value, today, onChange }) {
  const isFiltered = value !== today;

  function applyMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month - 1;
    const lastDay = isCurrentMonth ? now : new Date(year, month, 0);
    onChange(toDateOnlyString(lastDay));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label
          htmlFor="stock-snapshot-date"
          className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarClock className="h-3 w-3" strokeWidth={2} />
          Date
        </label>
        <input
          id="stock-snapshot-date"
          type="date"
          value={value}
          max={today}
          title="État du stock à cette date (reconstitué à partir des mouvements de stock)"
          onChange={(event) => onChange(event.target.value || today)}
          className="rounded-[7px] border border-stroke bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="stock-snapshot-month"
          className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Calendar className="h-3 w-3" strokeWidth={2} />
          Mois
        </label>
        <input
          id="stock-snapshot-month"
          type="month"
          max={today.slice(0, 7)}
          value={value.slice(0, 7)}
          onChange={(event) => applyMonth(event.target.value)}
          className="rounded-[7px] border border-stroke bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      {isFiltered && (
        <button
          type="button"
          onClick={() => onChange(today)}
          title="Revenir à aujourd'hui"
          className="inline-flex items-center gap-1 rounded-[7px] border border-stroke px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <RotateCcw className="h-3 w-3" strokeWidth={2} />
          Aujourd'hui
        </button>
      )}
    </div>
  );
}

function toDateOnlyString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
