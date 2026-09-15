"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, Calendar, RotateCcw } from "lucide-react";

function toDateOnlyString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Date-range filter for the Livre de caisse — same URL-driven pattern and
 * layout as RecettesFilterBar (components/dashboard/recettes/RecettesFilterBar.jsx):
 * day pickers plus month pickers for a day-to-day or month-to-month range,
 * simplified to drop the method/category pills since the book has none (it's
 * cash-only by definition). `basePath` lets the report page
 * (/dashboard/boutique/caisse/rapport) reuse this same bar against its own URL.
 */
export function CaisseFilterBar({ filters, basePath = "/dashboard/boutique/caisse" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const from = filters?.from ?? "";
  const to = filters?.to ?? "";

  function setParams(next) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, String(value));
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`${basePath}?${params.toString()}`, { scroll: false });
    });
  }

  /**
   * The two month pickers double as both a single-month shortcut (pick the
   * same month in both) and a month-to-month range — each just sets its own
   * end of the from/to range to that month's boundary, so picking one never
   * resets the other.
   */
  function applyFromMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    setParams({ from: toDateOnlyString(new Date(year, month - 1, 1)) });
  }

  function applyToMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month - 1;
    const lastDay = isCurrentMonth ? now : new Date(year, month, 0);
    setParams({ to: toDateOnlyString(lastDay) });
  }

  const hasFilters = Boolean(searchParams.get("from")) || Boolean(searchParams.get("to"));

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div>
        <label
          htmlFor="caisse-from"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Du
        </label>
        <input
          id="caisse-from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setParams({ from: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="caisse-to"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Au
        </label>
        <input
          id="caisse-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setParams({ to: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="caisse-from-month"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
          Du mois
        </label>
        <input
          id="caisse-from-month"
          type="month"
          onChange={(event) => applyFromMonth(event.target.value)}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="caisse-to-month"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
          Au mois
        </label>
        <input
          id="caisse-to-month"
          type="month"
          onChange={(event) => applyToMonth(event.target.value)}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(basePath, { scroll: false }))}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-2 text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Réinitialiser
        </button>
      )}
    </div>
  );
}
