"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { isCashSessionOpen, getSuggestedOpeningFloat, openCashSession } from "@/actions/dashboard/cash-sessions";

/**
 * Inline "no till is open" blocker for a CASH selection, compact enough to
 * sit inside a fiche/composer instead of taking over the whole screen like
 * CounterCart's own version of this. One click resolves it without leaving
 * the form or losing anything already typed — the point is to make opening
 * the till a required step, not a reason to turn a real payment away (see
 * the plan behind this: closing the Livre de caisse gap without reverting
 * completeAppointment/settleReservation/completeOrderPickup's own
 * deliberate "never refuse an already-promised payment" policy).
 *
 * Whoever renders this already reached a screen gated on POINT_OF_SALE, so
 * this doesn't re-check that permission client-side — same assumption
 * CounterCart's own "defensive fallback" comment makes. If the server
 * refuses anyway (a rare permission edge case), the toast says so.
 */
export function CashSessionGate({ onOpened }) {
  const [openingFloat, setOpeningFloat] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSuggestedOpeningFloat().then((result) => {
      if (!cancelled && result.success && result.data != null) setOpeningFloat(String(result.data));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleOpen() {
    const amount = Number(openingFloat);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Indiquez un fond de caisse valide.");
      return;
    }
    setPending(true);
    const result = await openCashSession(amount);
    setPending(false);
    if (!result.success) {
      // Two terminals, one till: a colleague opening it in the same instant
      // wins the race (openCashSession's advisory lock allows only one) —
      // that's a success for this screen too, not an error to surface.
      const current = await isCashSessionOpen().catch(() => null);
      if (current?.success && current.data) {
        toast.success("Caisse déjà ouverte par un collègue.");
        onOpened();
        return;
      }
      toast.error(result.message);
      return;
    }
    toast.success("Caisse ouverte.");
    onOpened();
  }

  return (
    <div className="w-full space-y-2 rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-700 dark:bg-amber-950">
      <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
        Aucune session de caisse n&apos;est ouverte — ouvrez-la pour encaisser en espèces.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={openingFloat}
          onChange={(event) => setOpeningFloat(event.target.value)}
          placeholder="Fond de caisse"
          aria-label="Fond de caisse"
          className="h-9 w-32 rounded-[7px] border border-amber-300 bg-white px-2 text-sm outline-none focus:border-amber-500 dark:border-amber-700 dark:bg-dark-2 dark:text-white"
        />
        <button
          type="button"
          onClick={handleOpen}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-[7px] bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-300 dark:text-amber-950"
        >
          <Wallet size={14} />
          {pending ? "Ouverture…" : "Ouvrir la caisse"}
        </button>
      </div>
    </div>
  );
}
