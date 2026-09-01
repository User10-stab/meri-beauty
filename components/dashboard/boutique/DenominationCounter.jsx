"use client";

import { useState } from "react";
import { DENOMINATIONS_CENTS, sumDenominationCounts } from "@/lib/cash-book/denominations";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

/**
 * Denomination-by-denomination till count — how many €50 notes, how many
 * 2€ coins, and so on — instead of staff eyeballing a pile of cash into one
 * typed number. That single typed number is the most error-prone step in
 * the whole closing process; this replaces it with a sum nobody has to do
 * in their head.
 *
 * Uncontrolled on purpose: it owns its own counts and reports only the
 * total via onTotalChange, so the parent's countedCash field stays the
 * single source of truth and can still be typed over directly if a
 * denomination breakdown isn't wanted for a given close.
 */
export function DenominationCounter({ onTotalChange }) {
  const [counts, setCounts] = useState({});

  function updateCount(cents, rawCount) {
    const next = { ...counts, [cents]: rawCount };
    setCounts(next);
    onTotalChange(sumDenominationCounts(next));
  }

  const total = sumDenominationCounts(counts);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DENOMINATIONS_CENTS.map((cents) => (
          <div
            key={cents}
            className="flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5 dark:border-dark-3"
          >
            <span className="w-14 shrink-0 text-xs font-medium text-gray-500 dark:text-dark-6">
              {formatEuro(cents / 100)}
            </span>
            <span className="text-gray-300">×</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={counts[cents] ?? ""}
              onChange={(event) => updateCount(cents, event.target.value)}
              placeholder="0"
              className="h-8 w-16 rounded border border-gray-200 px-2 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-2 text-sm font-semibold text-gray-900 dark:border-dark-3 dark:text-white">
        Total compté : {formatEuro(total)}
      </div>
    </div>
  );
}
