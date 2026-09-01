import { revalidatePath } from "next/cache";

/**
 * Every CASH-transaction-creating action calls this after commit. Without
 * it, a cashier already sitting on an open session's ledger page
 * (/dashboard/boutique/caisse/[sessionId]) never sees a sale that just
 * attached to their session until they manually reload — the page has no
 * other way to know new data landed. The index and report pages are
 * included too since a sale can also change what they'd show once visited.
 */
export function revalidateCaisseRoutes() {
  revalidatePath("/dashboard/boutique/caisse");
  revalidatePath("/dashboard/boutique/caisse/[sessionId]", "page");
  revalidatePath("/dashboard/boutique/caisse/[sessionId]/rapport", "page");
}
