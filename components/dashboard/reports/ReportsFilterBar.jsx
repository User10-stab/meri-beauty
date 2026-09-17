"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, RotateCcw } from "lucide-react";
import { PERIOD_LABELS } from "@/lib/reports-filters";

/**
 * Period filter for the reports page. There is no practitioner filter: the
 * report covers the salon only, and an independent's takings are not the
 * salon's to read.
 *
 * Drives the URL rather than local state, so the server component re-runs the
 * query with the new window: a filtered report is then a link someone can
 * bookmark or paste to a colleague, and the back button behaves.
 */
export function ReportsFilterBar({ months, periods }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key, value) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("staffId");
    if (value) params.set(key, String(value));
    else params.delete(key);

    startTransition(() => {
      router.push(`/dashboard/reports?${params.toString()}`, { scroll: false });
    });
  }

  const hasFilters = months !== 6;

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
