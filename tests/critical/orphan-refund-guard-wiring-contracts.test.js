import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 2 Sep 2026: no automatic Stripe refund is issued anywhere in the app any
// more. Two incidents drove this: (1) 31 Aug — two developers sharing one
// Stripe test key had their payments cross-refunded by each other's "no
// matching record -> refund" safety net; (2) 1 Sep — reconcileMissedCheckouts
// replayed an old paid session whose reservation had been wiped by an
// unrelated (now-fixed) CASCADE bug, and refunded a real customer twice with
// zero local trace. Rather than threading an allowAutoRefund flag through
// every call site (webhook vs. reconciliation), every one of them now funnels
// through a single choke point — flagPaymentForManualRefund — which never
// calls Stripe's refund API, only notifies admins to refund by hand.
describe.each([
  { label: "workshops", path: "lib/workshops/fulfill-workshop-reservation-payment.js", fnName: "confirmWorkshopReservationPayment" },
  { label: "formations", path: "lib/formations/fulfill-formation-reservation-payment.js", fnName: "confirmFormationReservationPayment" },
])("$label: confirm-payment failed-sale branches never call Stripe directly", ({ path, fnName }) => {
  const src = source(path);

  test("imports flagPaymentForManualRefund, not a Stripe refund helper", () => {
    expect(src).toContain('import { flagPaymentForManualRefund } from "@/lib/payments/flag-payment-for-manual-refund"');
    expect(src).not.toContain("stripe-refund-session");
    expect(src).not.toContain("refundSession");
  });

  test("takes a plain session argument — no allowAutoRefund option left to thread through", () => {
    expect(src).toContain(`export async function ${fnName}(session) {`);
  });

  test("every failed-sale branch (missing/cancelled reservation, underpayment, cancelled concurrently, hold expired/overbooked) flags instead of refunding", () => {
    const flagCalls = src.split("await flagPaymentForManualRefund(session,").length - 1;
    // reservation gone, reservation cancelled, underpayment, cancelled
    // concurrently, hold-expired-overbooked = 5 sites per file.
    expect(flagCalls).toBe(5);
    expect(src).not.toContain("refunded: true");
  });

  test("customer-facing emails no longer claim a refund already happened", () => {
    expect(src).not.toContain("a été intégralement remboursé");
    expect(src).toContain("Notre équipe va procéder");
  });
});

describe("the Stripe webhook route also flags instead of refunding, for every failed-sale branch", () => {
  const src = source("app/api/webhooks/stripe/route.js");

  test("imports flagPaymentForManualRefund, not a Stripe refund helper", () => {
    expect(src).toContain('import { flagPaymentForManualRefund } from "@/lib/payments/flag-payment-for-manual-refund"');
    expect(src).not.toContain("stripe-refund-session");
    expect(src).not.toContain("await refundSession(");
  });

  test("every one of its 10 failed-sale branches calls flagPaymentForManualRefund", () => {
    const flagCalls = src.split("await flagPaymentForManualRefund(session,").length - 1;
    expect(flagCalls).toBe(10);
  });

  test("the stray-duplicate-charge staff alert email no longer claims an automatic refund happened", () => {
    expect(src).not.toContain("vient d'être automatiquement remboursé via Stripe");
    expect(src).toContain("remboursement automatique est désactivé");
  });

  test("the seats-capacity customer email no longer claims a refund already happened", () => {
    expect(src).not.toContain("Le paiement correspondant a été intégralement remboursé");
    expect(src).toContain("va procéder au remboursement intégral");
  });
});

describe("reconcileMissedCheckouts calls the activity confirm functions plainly — no options left to pass", () => {
  const src = source("lib/payments/reconcile-missed-checkouts.js");

  test("no allowAutoRefund wiring remains anywhere", () => {
    expect(src).not.toContain("allowAutoRefund");
    expect(src).toContain("confirmWorkshopReservationPayment(fullSession)");
    expect(src).toContain("confirmFormationReservationPayment(fullSession)");
  });

  test("a flagged-for-review outcome is still counted separately from a genuine confirmation", () => {
    expect(src).toContain("result?.flaggedForReview");
    expect(src).toContain("flagged += 1");
    expect(src).toContain("return { checked, reconciled, flagged, failures }");
  });
});
