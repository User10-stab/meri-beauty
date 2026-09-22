import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// actions/boutique/orders.js is exercised end-to-end elsewhere (its
// transaction spans stock, refunds, credit notes, audit logs — see
// tests/integration/concurrency.test.js for the real-DB race coverage);
// these are contract checks on the specific Mondial Relay safety net added
// on top of it: cancelling an order that already has a purchased label is
// blocked by default, with an audited admin override, and the shared claim
// closes the race for both callers that can reach it.
const root = fileURLToPath(new URL("../../", import.meta.url));
const orders = readFileSync(`${root}actions/boutique/orders.js`, "utf8");

describe("Mondial Relay label safety in order cancellation", () => {
  test("the shared atomic claim excludes a labelled order by default", () => {
    expect(orders).toContain('status: { in: [...CANCELLABLE_ORDER_STATUSES, ...extraClaimableStatuses] },');
    expect(orders).toContain("...(allowLabelledOverride ? {} : { trackingCode: null }),");
  });

  test("cancelOrder blocks a labelled order and surfaces requiresLabelAcknowledgement instead of a dead end", () => {
    expect(orders).toContain("if (order.trackingCode && !acknowledgeLabelLoss) {");
    expect(orders).toContain("requiresLabelAcknowledgement: true,");
  });

  test("the override is admin-only, requires a reason, and is logged before it runs", () => {
    const gate = orders.indexOf("if (order.trackingCode && acknowledgeLabelLoss) {");
    expect(gate).toBeGreaterThan(-1);
    expect(orders).toContain('"Seul un administrateur peut annuler une commande dont l\'étiquette Mondial Relay a déjà été achetée."');
    expect(orders).toContain('"Indiquez une raison pour annuler une commande déjà étiquetée."');
    const warnCall = orders.indexOf('captureWarning("Admin cancelled an order with an already-purchased Mondial Relay label');
    expect(warnCall).toBeGreaterThan(gate);
    const performCall = orders.indexOf("allowLabelledOverride: Boolean(order.trackingCode && acknowledgeLabelLoss)");
    expect(performCall).toBeGreaterThan(warnCall);
  });

  test("approving a customer's cancellation request never gets the override — it stays blocked on a labelled order", () => {
    const approvalSection = orders.slice(
      orders.indexOf("export async function reviewOrderCancellationRequest"),
      orders.indexOf("export async function reviewOrderCancellationRequest") + 4000
    );
    expect(approvalSection).toContain("if (request.order.trackingCode) {");
    // The claim right after it must still be reachable — i.e. the check
    // returns BEFORE marking the request APPROVED, so a blocked request
    // stays PENDING rather than getting stuck mid-approval.
    const blockedAt = approvalSection.indexOf("if (request.order.trackingCode) {");
    const claimAt = approvalSection.indexOf('data: { status: "APPROVED"');
    expect(blockedAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(blockedAt);
  });
});
