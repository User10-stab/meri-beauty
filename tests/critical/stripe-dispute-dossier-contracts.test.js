import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P1: before this, a Stripe dispute/chargeback was only ever surfaced as a
// one-shot alert email — no durable record of who's handling it, whether
// evidence was submitted, what proof was cited, or the eventual outcome.
describe("persistent Stripe dispute dossier", () => {
  const schema = source("prisma/schema.prisma");
  const webhook = source("app/api/webhooks/stripe/route.js");
  const actions = source("actions/dashboard/stripe-disputes.js");

  test("Payment gains a durable StripeDispute dossier with the fields the punch list asked for", () => {
    expect(schema).toContain("model StripeDispute");
    expect(schema).toContain("assignedStaffId");
    expect(schema).toContain("responseSentAt");
    expect(schema).toContain("proofOfShipmentReference");
    expect(schema).toContain("conclusion");
    expect(schema).toContain("stripeDisputeId");
  });

  test("charge.dispute.created persists the dossier row, not just an email", () => {
    expect(webhook).toContain("prisma.stripeDispute.upsert");
    expect(webhook).toContain("stripeDisputeId: dispute.id");
  });

  test("dispute status stays in sync via charge.dispute.updated/closed without touching staff-entered fields", () => {
    expect(webhook).toContain('event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed"');
    expect(webhook).toContain("handleChargeDisputeStatusChanged");
    // The status-sync handler's own update call must not also write dossier fields.
    const handlerStart = webhook.indexOf("async function handleChargeDisputeStatusChanged");
    const handlerBody = webhook.slice(handlerStart, handlerStart + 700);
    expect(handlerBody).not.toContain("assignedStaffId");
    expect(handlerBody).not.toContain("conclusion");
  });

  test("dashboard dossier edits never touch the Stripe-owned status/amount/reason/dueBy fields", () => {
    expect(actions).toContain("export async function updateDisputeDossier");
    const fnStart = actions.indexOf("export async function updateDisputeDossier");
    const fnBody = actions.slice(fnStart, fnStart + 900);
    expect(fnBody).not.toContain("status:");
    expect(fnBody).not.toContain("dueBy:");
    expect(fnBody).toContain("assignedStaffId");
    expect(fnBody).toContain("proofOfShipmentReference");
    expect(fnBody).toContain("conclusion");
  });

  test("the dossier page is admin-gated and linked from the dashboard sidebar", () => {
    expect(actions).toContain("DASHBOARD_PERMISSIONS.STRIPE_DISPUTES");
    const page = source("app/dashboard/payments/disputes/page.jsx");
    expect(page).toContain("requireRole(DASHBOARD_PERMISSIONS.STRIPE_DISPUTES)");
    const sidebar = source("components/dashboard/Layouts/sidebar/data/index.js");
    expect(sidebar).toContain("/dashboard/payments/disputes");
  });

  test("the dossier links back to the invoice for the disputed payment", () => {
    const ui = source("components/dashboard/payments/DisputesPageClient.jsx");
    expect(ui).toContain("/api/invoices/${dispute.invoiceId}/pdf");
  });
});
