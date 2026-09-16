import { revalidatePath } from "next/cache";

/**
 * Every CASH-transaction-creating action calls this after commit. Without
 * it, a cashier already sitting on the Livre de caisse page never sees a
 * sale that just attached to the open session until they manually reload —
 * the page has no other way to know new data landed. Also called by the
 * auto-close job (lib/cash-book/auto-session.js).
 *
 * Swallows its own failure on purpose. revalidatePath throws "Invariant:
 * static generation store missing" when there is no request context — which
 * is exactly the case from a background interval. That throw used to escape
 * into autoOpenCashSession's caller AFTER the session had already been
 * written, so the 24h cooldown assignment that follows the await was never
 * reached: the job came due again on the very next 5-minute tick, and
 * auto-close (which had no time gate) shut the new session immediately. 52
 * empty sessions and +702 € of phantom "Solde initial" rows accumulated on
 * 15/09/2026 before it was caught.
 *
 * This is a cache hint, never load-bearing — the page it refreshes is
 * force-dynamic anyway, so the worst case when it cannot run is a cashier
 * reloading by hand. It must never fail the money-moving work that just
 * committed.
 */
export function revalidateCaisseRoutes() {
  try {
    revalidatePath("/dashboard/boutique/caisse");
  } catch {
    // No request context (background job) — nothing to revalidate.
  }
}
