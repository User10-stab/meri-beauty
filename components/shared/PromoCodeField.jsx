"use client";

import { useState } from "react";
import { Loader2, Tag, X } from "lucide-react";
import { validatePromoCode } from "@/actions/promo-codes";

/**
 * Reused as-is across all four purchase flows (boutique, ateliers,
 * formations, appointments) — a live client-side preview only. Every
 * create action re-validates the code server-side before charging, so
 * nothing here needs to be trusted.
 *
 * @param {{ subtotal: number, onApplied: (promo: {code: string, discountAmount: number} | null) => void }} props
 */
export function PromoCodeField({ subtotal, onApplied }) {
  const [input, setInput] = useState("");
  const [applied, setApplied] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  async function handleApply() {
    const code = input.trim();
    if (!code) return;

    setChecking(true);
    setError(null);
    const result = await validatePromoCode(code, subtotal);
    setChecking(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    const promo = { code: code.toUpperCase(), discountAmount: result.discountAmount };
    setApplied(promo);
    onApplied(promo);
  }

  function handleRemove() {
    setApplied(null);
    setInput("");
    setError(null);
    onApplied(null);
  }

  if (applied) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <span className="flex items-center gap-1.5 font-medium">
          <Tag size={14} />
          Code {applied.code} appliqué
        </span>
        <button type="button" onClick={handleRemove} className="text-emerald-600 hover:text-emerald-800" aria-label="Retirer le code promo">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleApply();
            }
          }}
          placeholder="Code promo"
          className="h-9 flex-1 rounded-lg border border-gray-200 px-3 text-sm uppercase tracking-wide text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={checking || !input.trim()}
          className="flex h-9 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? <Loader2 size={14} className="animate-spin" /> : "Appliquer"}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
