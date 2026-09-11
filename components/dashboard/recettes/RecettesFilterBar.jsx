"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, RotateCcw, Tag } from "lucide-react";
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
  const staffId = filters?.staffId ?? "";
  const staffName = filters?.staffName ?? null;

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

  const hasFilters = method !== "ALL" || category !== "ALL" || Boolean(staffId) || Boolean(searchParams.get("from")) || Boolean(searchParams.get("to"));

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

      {staffId && (
        <div className="flex items-center gap-2 rounded-[7px] border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs font-semibold text-indigo-800 dark:border-indigo-900/40 dark:bg-indigo-900/10 dark:text-indigo-300">
          <span>Prestataire : {staffName ?? "filtré"}</span>
          <button
            type="button"
            onClick={() => setParams({ staffId: "" })}
            aria-label="Retirer le filtre prestataire"
            className="font-bold hover:text-indigo-950 dark:hover:text-white"
          >
            ×
          </button>
        </div>
      )}

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
