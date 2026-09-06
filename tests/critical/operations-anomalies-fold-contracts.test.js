import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * The Réconciliation page listed Payments stuck in REFUND_PENDING /
 * REFUND_FAILED. Since the application stopped issuing Stripe refunds itself,
 * no live path writes those statuses — so a dedicated page read as though it
 * supervised the manual RefundOperation flow, which it never did. Deleting it
 * would have hidden real legacy discrepancies instead, so it folded into
 * Opérations next to the worklist that IS current.
 */
describe("payment anomalies live inside Opérations", () => {
  test("the stuck-payment list is rendered on the operations page", () => {
    const page = source("app/dashboard/operations/page.jsx");
    expect(page).toContain("listStuckPayments");
    expect(page).toContain("<PaymentAnomalies");
  });

  test("it sits below the current refund worklist, not above it", () => {
    // "Remboursements dus" is money owed right now on the live flow; anomalies
    // are leftovers. Ordering them the other way buries the urgent list.
    const page = source("app/dashboard/operations/page.jsx");
    expect(page.indexOf("<OutstandingRefunds")).toBeLessThan(page.indexOf("<PaymentAnomalies"));
  });

  test("monitoring was kept, not removed — the list and the missed-webhook scan both survive", () => {
    const panel = source("components/dashboard/operations/PaymentAnomalies.jsx");
    expect(panel).toContain("listStuckPayments");
    expect(panel).toContain("runMissedRefundsScan");
    const action = source("actions/dashboard/webhook-recovery.js");
    expect(action).toContain('status: { in: ["REFUND_PENDING", "REFUND_FAILED"] }');
  });

  test("the standalone page is a redirect, so old bookmarks still land somewhere useful", () => {
    const page = source("app/dashboard/payments/reconciliation/page.jsx");
    expect(page).toContain('redirect("/dashboard/operations")');
    // Its client component is gone, not merely unused.
    expect(existsSync(`${root}components/dashboard/payments/ReconciliationPageClient.jsx`)).toBe(false);
  });

  test("the sidebar no longer offers a page that only redirects", () => {
    const nav = source("components/dashboard/Layouts/sidebar/data/index.js");
    expect(nav).not.toContain("/dashboard/payments/reconciliation");
  });

  test("revalidation targets the screen that actually shows the list", () => {
    const action = source("actions/dashboard/webhook-recovery.js");
    expect(action).toContain('const RECONCILIATION_PATH = "/dashboard/operations"');
  });
});
