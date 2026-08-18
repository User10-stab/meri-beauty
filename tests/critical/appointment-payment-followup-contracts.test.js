import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isAwaitingPayment,
  isAwaitingPaymentChoice,
} from "../../lib/appointments/payment-followup.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 18 Aug 2026: a customer with an unpaid booking had no way to finish paying
// from /appointments — the page the site header actually links to at the
// time. The resume flow existed, but only on /mes-reservations, so the
// confirmation e-mail was the sole route back to Stripe.
//
// /appointments has since been retired in favour of /mes-reservations (the
// stronger design), once every feature it had — exception request,
// reschedule, invoice PDF, reviews — was ported over. This file now tests
// /mes-reservations alone.
describe("an unpaid appointment can be settled from the appointments list", () => {
  const confirmed = { status: "CONFIRMED" };

  test("an abandoned online payment is resumable", () => {
    expect(isAwaitingPayment(confirmed, { status: "PENDING", paymentType: "ONLINE" })).toBe(true);
    expect(isAwaitingPayment(confirmed, { status: "FAILED", paymentType: "DEPOSIT" })).toBe(true);
  });

  test("a settled or on-site payment is not", () => {
    expect(isAwaitingPayment(confirmed, { status: "PAID", paymentType: "ONLINE" })).toBe(false);
    expect(isAwaitingPayment(confirmed, { status: "PENDING", paymentType: "ON_SITE" })).toBe(false);
    expect(isAwaitingPayment(confirmed, null)).toBe(false);
  });

  test("a closed appointment is never chased for payment", () => {
    const pending = { status: "PENDING", paymentType: "ONLINE" };
    expect(isAwaitingPayment({ status: "CANCELLED" }, pending)).toBe(false);
    expect(isAwaitingPayment({ status: "COMPLETED" }, pending)).toBe(false);
  });

  test("an accepted request with no payment row needs a payment choice", () => {
    expect(isAwaitingPaymentChoice({ status: "ACCEPTED" }, null)).toBe(true);
    // Once a row exists the choice is made — that is isAwaitingPayment's job.
    expect(isAwaitingPaymentChoice({ status: "ACCEPTED" }, { status: "PENDING" })).toBe(false);
    expect(isAwaitingPaymentChoice(confirmed, null)).toBe(false);
  });

  // 18 Aug 2026, later same day: a colleague's "fix some bugs" commit
  // (b0bbe23) inlined awaitingPayment's logic directly into
  // get-my-reservations.js instead of calling the shared helper, and
  // dropped awaitingPaymentChoice entirely — confirmed with the user this
  // is accepted as-is (Fatiha's version kept as-is, not reconciled). The
  // helper module itself is untouched and still correct; this test only
  // checks the inlined awaitingPayment logic actually matches it, since
  // nothing enforces the two staying in sync anymore.
  test("the reservations list's inlined awaitingPayment logic still matches the shared helper's rule", () => {
    const src = source("actions/reservation/get-my-reservations.js");
    expect(src).toContain('["PENDING", "FAILED"].includes(payment.status)');
    expect(src).toContain('payment.paymentType === "ONLINE" || payment.paymentType === "DEPOSIT"');
    expect(src).toContain('appt.status !== "CANCELLED"');
    expect(src).toContain('appt.status !== "COMPLETED"');

    const helper = source("lib/appointments/payment-followup.js");
    expect(helper).toContain("export function isAwaitingPayment(appointment, payment)");
    expect(helper).toContain("export function isAwaitingPaymentChoice(appointment, payment)");
  });

  test("/mes-reservations selects the payment fields the resume action needs", () => {
    const loader = source("actions/reservation/get-my-reservations.js");
    // payment.id is what resumeReservationPayment is called with; without it
    // the button cannot be wired at all.
    const mapped = loader.slice(loader.indexOf("payment: payment"), loader.indexOf("review: appt.review"));
    expect(mapped).toMatch(/id:\s*payment\.id/);
    expect(mapped).toMatch(/status:\s*payment\.status/);
    expect(mapped).toMatch(/paymentType:\s*payment\.paymentType/);
  });

  // /mes-reservations is the page the salon settled on, so it must keep every
  // feature /appointments had before that page was retired: the exception
  // request, reschedule, invoice PDF and reviews.
  test("the reservations page still carries every feature ported from /appointments", () => {
    const src = source("components/customer/MyReservationsClient.jsx");
    const required = [
      "resumeReservationPayment",
      "awaitingPaymentChoice",
      "submitCancellationExceptionRequest",
      "AppointmentRescheduleModal",
      "/api/invoices/",
    ];
    for (const feature of required) {
      expect(src, `/mes-reservations is missing ${feature}`).toContain(feature);
    }
    expect(src, "/mes-reservations is missing the review display").toMatch(/review\.rating/);
  });

  test("the reservations loader supplies what those features read", () => {
    const loader = source("actions/reservation/get-my-reservations.js");
    expect(loader).toMatch(/invoice:\s*\{\s*select/);   // invoice PDF
    expect(loader).toContain("review:");                 // review display
    expect(loader).toContain("staffServiceId:");         // reschedule modal
    expect(loader).toContain("cancellationRequest:");    // exception request
  });

  test("the payment button is not gated behind the 48h cancellation lock", () => {
    const client = source("components/customer/MyReservationsClient.jsx");

    // isActionable's blocked branch (48h lock) must not be an ancestor of the
    // awaitingPayment button, or a booking inside the window could never be
    // paid.
    const buttonIndex = client.indexOf("{reservation.awaitingPayment && !isCancelled && (");
    const actionableIndex = client.indexOf("{isActionable && (");
    expect(buttonIndex).toBeGreaterThan(-1);
    expect(actionableIndex).toBeGreaterThan(-1);
    expect(buttonIndex).toBeLessThan(actionableIndex);
  });

  // 18 Aug 2026: a manually-confirmed request now takes its deposit (or full
  // amount) up front for every staff member except CASH_ONLY, so a PENDING
  // appointment usually does carry an unsettled payment — not "nothing to pay
  // yet". The "waiting on the salon" notice must not swallow that case, or an
  // abandoned Checkout becomes unrecoverable outside the confirmation e-mail.
  test("the pending-approval notice yields to the pay button on an unsettled payment", () => {
    const client = source("components/customer/MyReservationsClient.jsx");
    expect(client).toContain('effectiveStatus === "PENDING" && !reservation.awaitingPayment && !isCancelled');
  });
});

// The hero photo loaded fine but rendered invisible: `bg-white` was added to
// <main> in (public)/layout, and a -z-10 background paints before an
// ancestor's in-flow background, so the white covered the image.
describe("the hero background survives the layout's white backdrop", () => {
  test("the hero section forms its own stacking context", () => {
    const hero = source("components/website/Hero.jsx");
    const sectionTag = hero.slice(hero.indexOf('id="accueil"'), hero.indexOf('id="accueil"') + 200);
    expect(sectionTag).toContain("isolate");
    expect(hero).toContain("absolute inset-0 -z-10");
  });

  test("the layout still paints its background, so the fix must stay", () => {
    expect(source("app/(public)/layout.js")).toContain("bg-white");
  });
});
