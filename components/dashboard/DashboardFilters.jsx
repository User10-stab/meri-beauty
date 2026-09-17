"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, RotateCcw } from "lucide-react";

/**
 * Global dashboard filters (admin only). The month is carried in the URL
 * (?month=YYYY-MM) so the server component refetches and every statistic is
 * recalculated server-side.
 *
 * There is deliberately no staff filter. Every practitioner other than Marie
 * is legally independent with her own VAT number: her takings are hers, and
 * the salon's dashboard neither shows them nor offers a way to open them.
 *
 * @param {{ activeMonth: string, maxMonth: string }} props
 */
export function DashboardFilters({ activeMonth, maxMonth }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function pushMonth(month) {
    const params = new URLSearchParams(searchParams.toString());
    // Drop a stale ?staffId= from an old bookmark — it no longer means anything.
    params.delete("staffId");
    if (month) params.set("month", month);
    else params.delete("month");
    const query = params.toString();
    router.push(query ? `/dashboard?${query}` : "/dashboard");
  }

  const isDefault = activeMonth === maxMonth;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] p-4 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {/* Month filter */}
      <label className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-dark-6">
        <CalendarDays size={30} className="text-gray-700 bg-gray-200 p-2 rounded-full" />
        <span className="sr-only">Filtrer par mois</span>
        <input
          type="month"
          value={activeMonth}
          max={maxMonth}
          onChange={(e) => pushMonth(e.target.value || maxMonth)}
          aria-label="Filtrer par mois"
          className="h-9 cursor-pointer rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-dark-3 dark:bg-dark-2 dark:text-white dark:[color-scheme:dark]"
        />
      </label>

      {/* Reset */}
      {!isDefault && (
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6 dark:hover:bg-dark-3"
        >
          <RotateCcw size={14} />
          Réinitialiser
        </button>
      )}
    </div>
  );
}
