import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
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
//
// P0 (31 Aug 2026): the same failure one layer down. The stamp was the host
// alone, and every developer's machine stamps "localhost:3000" — so two
// people running the app locally against the same Stripe test key were
// indistinguishable to this guard and each processed the other's payments. A
// real workshop deposit (10,50 €, session cs_test_a1shSr…) was captured and
// refunded ~2s later by the other machine's "reservation gone → refund"
// branch, while our database showed the booking CONFIRMED with a valid ticket.
// A loopback host identifies a machine, not a deployment: it has to carry one.
describe("Checkout Sessions are isolated per deployment", () => {
  const originalUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalId = process.env.STRIPE_DEPLOYMENT_ID;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    delete process.env.STRIPE_DEPLOYMENT_ID;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalUrl;
    if (originalId === undefined) delete process.env.STRIPE_DEPLOYMENT_ID;
    else process.env.STRIPE_DEPLOYMENT_ID = originalId;
  });

  test("sessions are stamped with this deployment's host, preserving existing metadata", () => {
    const stamped = withDeploymentStamp({ kind: "order", orderId: "abc" });
    expect(stamped.kind).toBe("order");
    expect(stamped.orderId).toBe("abc");
    expect(stamped[DEPLOYMENT_METADATA_KEY]).toBe(`localhost:3000@${hostname().toLowerCase()}`);
  });

  test("a non-loopback deployment keeps the bare host — production's stamp is unchanged", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://meribeautystudio.com";
    expect(getDeploymentId()).toBe("meribeautystudio.com");
  });

  test("two developers on localhost:3000 are not the same deployment", () => {
    // What actually happened: identical URL, identical port, different
    // machine, different database. The stamp has to separate them.
    const theirs = { metadata: { kind: "workshop", [DEPLOYMENT_METADATA_KEY]: "localhost:3000@some-other-laptop" } };
    expect(isForeignCheckoutSession(theirs)).toBe(true);
  });

  test("a bare loopback stamp belongs to no machine in particular, so it is foreign", () => {
    const preFix = { metadata: { kind: "workshop", [DEPLOYMENT_METADATA_KEY]: "localhost:3000" } };
    expect(isForeignCheckoutSession(preFix)).toBe(true);
  });

  test("STRIPE_DEPLOYMENT_ID overrides, for two instances on one machine", () => {
    process.env.STRIPE_DEPLOYMENT_ID = "dev-b";
    expect(getDeploymentId()).toBe("dev-b");
    expect(isForeignCheckoutSession({ metadata: { [DEPLOYMENT_METADATA_KEY]: "dev-a" } })).toBe(true);
    expect(isForeignCheckoutSession({ metadata: { [DEPLOYMENT_METADATA_KEY]: "dev-b" } })).toBe(false);
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

  // Belt and braces: the route guard is one line, and every refundSession
  // call site is reached from "we have no record of this payment" — the exact
  // shape a foreign payment takes. The money call itself must also refuse.
  test("refundSession refuses a foreign session even if the route guard is bypassed", () => {
    const lib = source("lib/stripe-refund-session.js");
    const guardAt = lib.indexOf("isForeignCheckoutSession(session)");
    const refundAt = lib.indexOf("stripe.refunds.create");
    expect(guardAt).toBeGreaterThan(-1);
    expect(refundAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(refundAt);
    // It must return, not throw — throwing makes the webhook 500 and Stripe
    // redeliver the same foreign event forever.
    expect(lib.slice(guardAt, refundAt)).toContain("return;");
  });
});
