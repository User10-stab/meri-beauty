"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, RotateCcw, Users } from "lucide-react";

/**
 * Global dashboard filters (admin only). Staff + month are carried in the URL
 * (?staffId=…&month=YYYY-MM) so the server component refetches and every
 * statistic is recalculated server-side — the two filters combine naturally.
 *
 * @param {{ staffOptions: Array<{ id: string, fullName: string }>,
 *   activeStaffId: string, activeMonth: string, maxMonth: string }} props
 */
export function DashboardFilters({ staffOptions, activeStaffId, activeMonth, maxMonth }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function pushParams(staffId, month) {
    const params = new URLSearchParams(searchParams.toString());
    if (staffId) params.set("staffId", staffId);
    else params.delete("staffId");
    if (month) params.set("month", month);
    else params.delete("month");
    const query = params.toString();
    router.push(query ? `/dashboard?${query}` : "/dashboard");
  }

  const isDefault = !activeStaffId && activeMonth === maxMonth;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] p-4 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      {/* Staff filter */}
      <label className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-dark-6">
        <Users size={30} className="text-gray-700 bg-gray-200 p-2 rounded-full " />
        <span className="sr-only">Filtrer par professionnel</span>
        <span className="relative inline-flex">
          <select
            value={activeStaffId}
            onChange={(e) => pushParams(e.target.value || "", activeMonth)}
            aria-label="Filtrer par professionnel"
            className="h-9 cursor-pointer appearance-none rounded-md border border-gray-200 bg-white py-1 pl-3 pr-8 text-sm text-gray-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            <option value="">Tous les Staff</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
          />
        </span>
      </label>

      {/* Month filter */}
      <label className="flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-dark-6">
        <CalendarDays size={30} className="text-gray-700 bg-gray-200 p-2 rounded-full" />
        <span className="sr-only">Filtrer par mois</span>
        <input
          type="month"
          value={activeMonth}
          max={maxMonth}
          onChange={(e) => pushParams(activeStaffId, e.target.value || maxMonth)}
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
