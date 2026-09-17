"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, Calendar, RotateCcw, Tag } from "lucide-react";
import {
  RECETTES_METHODS,
  RECETTES_CATEGORIES,
  RECETTES_CATEGORY_LABELS,
  METHOD_LABELS,
} from "@/lib/livre-de-recettes/filters";

/**
 * Date range, payment method and category filters for the Livre de recettes.
 *
 * Drives the URL rather than local state, so the server component re-runs the
 * query and re-computes the running balance for the new window: a filtered
 * journal is then a link someone can bookmark or paste to a colleague, and
 * the back button behaves.
 */
export function RecettesFilterBar({ filters }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const from = filters?.from ?? "";
  const to = filters?.to ?? "";
  const method = filters?.method ?? "ALL";
  const category = filters?.category ?? "ALL";

  function toDateOnlyString(date) {
    const year = date.getFullYear();
    const monthStr = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${monthStr}-${day}`;
  }

  /**
   * The two month pickers below double as both a single-month shortcut (pick
   * the same month in both) and a month-to-month range (pick a different
   * start and end month) — each just sets its own end of the from/to range
   * to that month's boundary, so picking one never resets the other.
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

  function setParams(next) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value && value !== "ALL") params.set(key, String(value));
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`/dashboard/livre-de-recettes?${params.toString()}`, { scroll: false });
    });
  }

  const hasFilters = method !== "ALL" || category !== "ALL" || Boolean(searchParams.get("from")) || Boolean(searchParams.get("to"));

  return (
    <div
      className={`flex flex-wrap items-end gap-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div>
        <label
          htmlFor="recettes-from"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Du
        </label>
        <input
          id="recettes-from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setParams({ from: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="recettes-to"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Au
        </label>
        <input
          id="recettes-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setParams({ to: event.target.value })}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="recettes-from-month"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
          Du mois
        </label>
        <input
          id="recettes-from-month"
          type="month"
          onChange={(event) => applyFromMonth(event.target.value)}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <label
          htmlFor="recettes-to-month"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
          Au mois
        </label>
        <input
          id="recettes-to-month"
          type="month"
          onChange={(event) => applyToMonth(event.target.value)}
          className="rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        />
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
          Moyen de paiement
        </span>
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={method === "ALL"} onClick={() => setParams({ method: "ALL" })}>
            Tous
          </FilterPill>
          {RECETTES_METHODS.map((value) => (
            <FilterPill key={value} active={method === value} onClick={() => setParams({ method: value })}>
              {METHOD_LABELS[value] ?? value}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="min-w-[190px]">
        <label
          htmlFor="recettes-category"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
        >
          <Tag className="h-3.5 w-3.5" strokeWidth={2} />
          Catégorie
        </label>
        <select
          id="recettes-category"
          value={category}
          onChange={(event) => setParams({ category: event.target.value })}
          className="w-full rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
        >
          <option value="ALL">Toutes les catégories</option>
          {RECETTES_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {RECETTES_CATEGORY_LABELS[value] ?? value}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push("/dashboard/livre-de-recettes", { scroll: false }))}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-stroke px-3 py-2 text-sm font-semibold text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Réinitialiser
        </button>
      )}
    </div>
  );
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-[#2f3a2e] text-white"
          : "border border-stroke text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
      }`}
    >
      {children}
    </button>
  );
}
