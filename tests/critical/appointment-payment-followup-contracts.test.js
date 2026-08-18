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
// from /appointments — the page the site header actually links to. The resume
// flow existed, but only on /mes-reservations, so the confirmation e-mail was
// the sole route back to Stripe.
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

  test("both customer lists derive the flags from the same helper", () => {
    for (const path of [
      "actions/customer/get-my-appointments.js",
      "actions/reservation/get-my-reservations.js",
    ]) {
      const src = source(path);
      expect(src).toContain("@/lib/appointments/payment-followup");
      expect(src).toContain("awaitingPayment: isAwaitingPayment(");
      expect(src).toContain("awaitingPaymentChoice: isAwaitingPaymentChoice(");
    }
  });

  test("/appointments selects the payment fields the resume action needs", () => {
    const loader = source("actions/customer/get-my-appointments.js");
    // payment.id is what resumeReservationPayment is called with; without it
    // the button cannot be wired at all.
    expect(loader).toMatch(/payment:\s*\{[\s\S]*?id:\s*true/);
    expect(loader).toMatch(/payment:\s*\{[\s\S]*?status:\s*true/);
    expect(loader).toMatch(/payment:\s*\{[\s\S]*?paymentType:\s*true/);
  });

  // /mes-reservations is the page the salon wants to keep, so it must not be
  // the weaker of the two: it previously lacked the exception request,
  // reschedule, invoice PDF and reviews that /appointments already had.
  test("both customer pages offer the same feature set", () => {
    const pages = {
      "/appointments": source("components/website/MyAppointmentsPageClient.jsx"),
      "/mes-reservations": source("components/customer/MyReservationsClient.jsx"),
    };
    const required = [
      "resumeReservationPayment",
      "awaitingPaymentChoice",
      "submitCancellationExceptionRequest",
      "AppointmentRescheduleModal",
      "/api/invoices/",
    ];
    for (const [name, src] of Object.entries(pages)) {
      for (const feature of required) {
        expect(src, `${name} is missing ${feature}`).toContain(feature);
      }
      expect(src, `${name} is missing the review display`).toMatch(/review\.rating/);
    }
  });

  test("the reservations loader supplies what those features read", () => {
    const loader = source("actions/reservation/get-my-reservations.js");
    expect(loader).toMatch(/invoice:\s*\{\s*select/);   // invoice PDF
    expect(loader).toContain("review:");                 // review display
    expect(loader).toContain("staffServiceId:");         // reschedule modal
    expect(loader).toContain("cancellationRequest:");    // exception request
  });

  test("the payment step is not gated behind the 48h cancellation lock", () => {
    const client = source("components/website/MyAppointmentsPageClient.jsx");

    // AppointmentActions returns early when locked; PaymentFollowUp must be
    // its sibling, not nested inside it, or a booking inside the window
    // could never be paid.
    const followUpDef = client.indexOf("function PaymentFollowUp");
    const actionsDef = client.indexOf("function AppointmentActions");
    expect(followUpDef).toBeGreaterThan(-1);
    expect(followUpDef).toBeLessThan(actionsDef);

    // Rendered in both cards.
    const renders = client.match(/<PaymentFollowUp appointment=\{appointment\} \/>/g) ?? [];
    expect(renders.length).toBe(2);

    // The one in the history card must not inherit showActions.
    expect(client).not.toMatch(/showActions && <PaymentFollowUp/);
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
