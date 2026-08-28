import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("boutique checkout can safely resume after returning from Stripe", () => {
  test("a back-forward cache restore unlocks the payment button", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");

    expect(checkout).toContain('window.addEventListener("pageshow", resetSubmittingAfterNavigation)');
    expect(checkout).toContain("const resetSubmittingAfterNavigation = () => setSubmitting(false)");
    expect(checkout).toContain('window.removeEventListener("pageshow", resetSubmittingAfterNavigation)');
  });

  test("an old open Stripe session is expired before its stock hold is released", () => {
    const orders = source("actions/boutique/orders.js");
    const expireSession = orders.indexOf("stripe.checkout.sessions.expire(session.id)");
    const releaseHold = orders.indexOf("cancelPendingOrderForRetry(pendingOrder)");

    expect(expireSession).toBeGreaterThan(-1);
    expect(releaseHold).toBeGreaterThan(expireSession);
  });

  test("an ambiguous Stripe state keeps the reservation instead of risking a paid cancelled order", () => {
    const orders = source("actions/boutique/orders.js");

    expect(orders).toContain("Unable to verify prior Stripe session");
    expect(orders).toContain("safeToCancel: false");
    expect(orders).toContain("if (!priorAttempt.safeToCancel)");
  });

  test("a concurrently paid session is fulfilled through the idempotent finalizer", () => {
    const orders = source("actions/boutique/orders.js");

    expect(orders).toContain('session.payment_status === "paid"');
    expect(orders).toContain("await fulfillOrderPayment(priorAttempt.paidSession)");
  });

  test("stock release is serialized and cannot drive reserved quantity below zero", () => {
    const orders = source("actions/boutique/orders.js");

    expect(orders).toContain('SELECT id FROM "Cart" WHERE id = ${order.cartId} FOR UPDATE');
    expect(orders).toContain('SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE');
    expect(orders).toContain("reservedQuantity: { gte: item.quantity }");
    expect(orders).toContain('throw new Error("ORDER_HOLD_INCONSISTENT")');
  });

  test("the stale cart snapshot credits a reservation that is reused or just released", () => {
    const orders = source("actions/boutique/orders.js");

    expect(orders).toContain("pendingOrderMatchesCart(pendingOrder, fullCart)");
    expect(orders).toContain("preflightHeldQuantityCredit.set(item.variantId, item.quantity)");
    expect(orders).toContain("preflightHeldQuantityCredit.get(item.variantId) ?? 0");
  });
});
