import { revalidatePath } from "next/cache";

/**
 * Every CASH-transaction-creating action calls this after commit. Without
 * it, a cashier already sitting on the Livre de caisse page never sees a
 * sale that just attached to the open session until they manually reload —
 * the page has no other way to know new data landed. Also called by the
 * auto-open/auto-close job (lib/cash-book/auto-session.js) after each run.
 */
export function revalidateCaisseRoutes() {
  revalidatePath("/dashboard/boutique/caisse");
  revalidatePath("/dashboard/boutique/caisse/rapport");
}
