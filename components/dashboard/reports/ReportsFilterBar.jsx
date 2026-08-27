"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, RotateCcw, UserRound } from "lucide-react";
import { PERIOD_LABELS } from "@/lib/reports-filters";

/**
 * Period and practitioner filters for the reports page.
 *
 * Drives the URL rather than local state, so the server component re-runs the
 * query with the new window: a filtered report is then a link someone can
 * bookmark or paste to a colleague, and the back button behaves.
 */
export function ReportsFilterBar({ months, staffId, periods, staffOptions }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, String(value));
    else params.delete(key);

    startTransition(() => {
      router.push(`/dashboard/reports?${params.toString()}`, { scroll: false });
    });
  }

  const hasFilters = staffId || months !== 6;

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-[180px]">
        <label
          htmlFor="report-period"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Période
        </label>
        <select
          id="report-period"
          value={months}
          onChange={(event) => setParam("months", event.target.value)}
          className="w-full rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        >
          {periods.map((value) => (
            <option key={value} value={value}>
              {PERIOD_LABELS[value] ?? `${value} mois`}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-[220px]">
        <label
          htmlFor="report-staff"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <UserRound className="h-3.5 w-3.5" strokeWidth={2} />
          Praticienne
        </label>
        <select
          id="report-staff"
          value={staffId ?? ""}
          onChange={(event) => setParam("staffId", event.target.value)}
          className="w-full rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        >
          <option value="">Tout le salon</option>
          {staffOptions.map((staff) => (
            <option key={staff.id} value={staff.id}>
              {staff.fullName}
              {staff.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push("/dashboard/reports", { scroll: false }))}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-2 text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Réinitialiser
        </button>
      )}
    </div>
  );
}
