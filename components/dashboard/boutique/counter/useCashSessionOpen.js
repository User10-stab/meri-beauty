"use client";

import { useCallback, useEffect, useState } from "react";
import { isCashSessionOpen } from "@/actions/dashboard/cash-sessions";

// A CASH payment recorded with no till session open is permanently invisible
// from the Livre de caisse — Transaction.cashSessionId is set once, at
// payment time, and never backfilled. `markOpen` lets a caller that just
// opened a till inline (see CashSessionGate) reflect that immediately,
// instead of waiting for a re-poll that isn't scheduled here.
export function useCashSessionOpen() {
  const [open, setOpen] = useState(true); // optimistic until the check resolves
  useEffect(() => {
    isCashSessionOpen()
      .then((result) => setOpen(Boolean(result.success && result.data)))
      .catch(() => {});
  }, []);
  const markOpen = useCallback(() => setOpen(true), []);
  const markClosed = useCallback(() => setOpen(false), []);
  return { open, markOpen, markClosed };
}
