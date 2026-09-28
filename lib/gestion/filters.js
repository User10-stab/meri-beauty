/**
 * Filter vocabulary for the Gestion page. Same window rules as the Livre de
 * recettes (bounded, defaults to the current month) — the page reads its
 * revenue straight from that journal, so the two must agree on what "the
 * period" means. No payment-method filter: a margin does not depend on how
 * the customer paid.
 *
 * Not a "use server" module (see lib/livre-de-recettes/filters.js).
 */

import { normalizeRecettesParams } from "@/lib/livre-de-recettes/filters";

/** @returns {{ from: string, to: string, fromDate: Date, toDate: Date, category: "ALL"|string }} */
export function normalizeGestionParams({ from, to, category } = {}) {
  const { method: _ignored, ...rest } = normalizeRecettesParams({ from, to, category });
  return rest;
}
