import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEPLOYMENT_METADATA_KEY,
  getDeploymentId,
  withDeploymentStamp,
  isForeignCheckoutSession,
} from "../../lib/stripe-deployment.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// P0 (17 Aug 2026): localhost and the staging VPS share one Stripe test
// account. Every local test purchase was refunded ~2s later by the VPS, which
// received the same checkout.session.completed, found no such order in the
// production database, and hit fulfill-order-payment's "order gone → refund"
// branch. Locally the order showed PAID + invoiced; on Stripe it showed fully
// refunded.
describe("Checkout Sessions are isolated per deployment", () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = original;
  });

  test("sessions are stamped with this deployment's host, preserving existing metadata", () => {
    const stamped = withDeploymentStamp({ kind: "order", orderId: "abc" });
    expect(stamped.kind).toBe("order");
    expect(stamped.orderId).toBe("abc");
    expect(stamped[DEPLOYMENT_METADATA_KEY]).toBe("localhost:3000");
  });

  test("a session stamped by another deployment is recognised as foreign", () => {
    const fromProd = { metadata: { kind: "order", [DEPLOYMENT_METADATA_KEY]: "meribeautystudio.com" } };
    expect(isForeignCheckoutSession(fromProd)).toBe(true);
  });

  test("our own session is never treated as foreign", () => {
    const ours = { metadata: withDeploymentStamp({ kind: "order" }) };
    expect(isForeignCheckoutSession(ours)).toBe(false);
  });

  test("scheme and trailing slash differences do not make a deployment foreign to itself", () => {
    const ours = { metadata: withDeploymentStamp({}) };
    process.env.NEXT_PUBLIC_APP_URL = "https://localhost:3000/";
    expect(isForeignCheckoutSession(ours)).toBe(false);
  });

  // Fail-open: refusing to process a real payment is far worse than the
  // cross-talk this guards against.
  test("unstamped sessions (pre-guard) are still processed", () => {
    expect(isForeignCheckoutSession({ metadata: { kind: "order" } })).toBe(false);
    expect(isForeignCheckoutSession({})).toBe(false);
    expect(isForeignCheckoutSession(undefined)).toBe(false);
  });

  test("a deployment with no configured app URL processes everything", () => {
    process.env.NEXT_PUBLIC_APP_URL = "";
    expect(getDeploymentId()).toBe("");
    expect(
      isForeignCheckoutSession({ metadata: { [DEPLOYMENT_METADATA_KEY]: "meribeautystudio.com" } })
    ).toBe(false);
  });

  test("the stamp is applied centrally in lib/stripe.js, so new call sites inherit it", () => {
    const stripeLib = source("lib/stripe.js");
    expect(stripeLib).toContain("withDeploymentStamp");
    expect(stripeLib).toContain("stripe.checkout.sessions.create =");
  });

  test("the webhook drops foreign checkout.session events before any handler runs", () => {
    const route = source("app/api/webhooks/stripe/route.js");
    expect(route).toContain("isForeignCheckoutSession");

    // The guard must sit ahead of the dispatch that can refund.
    const guardAt = route.indexOf("isForeignCheckoutSession(event.data.object)");
    const dispatchAt = route.indexOf("fulfillOrderPayment(session)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(dispatchAt);
  });
});
