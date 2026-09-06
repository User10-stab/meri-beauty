import { redirect } from "next/navigation";

/**
 * Folded into /dashboard/operations as the "Anomalies à traiter" block.
 *
 * A whole page called "Réconciliation" implied it supervised refunds, and
 * since the application stopped issuing Stripe refunds itself nothing in the
 * live flow writes the REFUND_PENDING/REFUND_FAILED statuses it listed. The
 * rows still matter, so they moved next to "Remboursements dus" rather than
 * being deleted.
 *
 * The route is kept as a redirect rather than removed: it was in the sidebar
 * for months and is certainly bookmarked.
 */
export default function ReconciliationPage() {
  redirect("/dashboard/operations");
}
