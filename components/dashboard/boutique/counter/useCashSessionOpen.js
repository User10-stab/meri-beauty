"use client";

import { useCallback, useEffect, useState } from "react";
import { isCashSessionOpen, tryAutoOpenCashSession } from "@/actions/dashboard/cash-sessions";

// A CASH payment recorded with no till session open is permanently invisible
// from the Livre de caisse — Transaction.cashSessionId is set once, at
// payment time, and never backfilled. `markOpen` lets a caller that just
// opened a till inline (see CashSessionGate) reflect that immediately,
// instead of waiting for a re-poll that isn't scheduled here.
//
// Before settling on "closed", this tries the same silent auto-open
// ensureCashSessionOpen gives every cash-taking server action (carrying the
// last closed session's counted total forward when it's a usable positive
// amount) — so CashSessionGate's manual form only ever appears when that
// float is 0, negative, or there's no prior session, cases that actually
// need a human to look at the number rather than waiting on the cron.
export function useCashSessionOpen() {
  const [open, setOpen] = useState(true); // optimistic until the check resolves
  useEffect(() => {
    let cancelled = false;
    isCashSessionOpen()
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          setOpen(true);
          return;
        }
        return tryAutoOpenCashSession().then((autoOpened) => {
          if (!cancelled) setOpen(Boolean(autoOpened.success && autoOpened.data));
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const markOpen = useCallback(() => setOpen(true), []);
  const markClosed = useCallback(() => setOpen(false), []);
  return { open, markOpen, markClosed };
}
