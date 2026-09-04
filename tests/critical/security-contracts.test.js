import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCallbackUrl } from "@/lib/safe-callback-url";
import { contactVisitorAutoReplyEmail } from "@/lib/email-templates";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("auth redirect and email escaping contracts", () => {
  test("auth callback URLs are reduced to same-site paths", () => {
    expect(normalizeCallbackUrl("/reservation-atelier?step=2#checkout", "/fallback")).toBe("/reservation-atelier?step=2#checkout");
    expect(normalizeCallbackUrl("https://meri.example/mes-reservations", "/fallback", "https://meri.example")).toBe("/mes-reservations");
    expect(normalizeCallbackUrl("https://evil.example/phish", "/fallback", "https://meri.example")).toBe("/fallback");
    expect(normalizeCallbackUrl("//evil.example/phish", "/fallback", "https://meri.example")).toBe("/fallback");
    expect(normalizeCallbackUrl("javascript:alert(1)", "/fallback", "https://meri.example")).toBe("/fallback");
  });

  test("contact visitor auto-reply escapes submitted fields in HTML", () => {
    const email = contactVisitorAutoReplyEmail({
      name: "<img src=x onerror=alert(1)>",
      subject: "<script>alert(1)</script>",
      salonName: "Meri <Beauty>",
      salonEmail: "hello@example.com",
    });

    expect(email.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("payment and webhook security contracts", () => {
  const webhook = source("app/api/webhooks/stripe/route.js");
  // Workshop/formation payment confirmation (incl. underpayment handling)
  // was extracted out of the webhook route so the zero-total (100%-promo)
  // direct-fulfilment path can share the exact same logic instead of
  // duplicating it — see lib/workshops/fulfill-workshop-reservation-payment.js
  // and lib/formations/fulfill-formation-reservation-payment.js.
  const workshopFulfil = source("lib/workshops/fulfill-workshop-reservation-payment.js");
  const formationFulfil = source("lib/formations/fulfill-formation-reservation-payment.js");
  const orderFulfil = source("lib/orders/fulfill-order-payment.js");
  const flagLib = source("lib/payments/flag-payment-for-manual-refund.js");

  test("Stripe webhook verifies signatures and persists idempotency keys", () => {
    expect(webhook).toContain("stripe.webhooks.constructEvent");
    expect(webhook).toMatch(/where:\s*\{\s*transactionReference:\s*session\.id/);
    expect(webhook).toMatch(/transactionReference:\s*session\.id/);
    expect(webhook).toContain('FOR UPDATE');
  });

  // 2 Sep 2026: no automatic Stripe refund is issued anywhere in the app
  // any more — underpayments and invalid late payments are flagged for a
  // human to refund manually from the Stripe Dashboard instead (see
  // flagPaymentForManualRefund's own doc for the two incidents that led here).
  test("underpayments and invalid late payments are flagged for manual refund, never auto-refunded", () => {
    const allSources = webhook + workshopFulfil + formationFulfil + orderFulfil;
    expect(allSources).toContain("UNDERPAYMENT_EPSILON");
    expect(allSources.match(/reason:\s*["']underpayment["']/g)?.length).toBeGreaterThanOrEqual(3);
    expect(allSources.match(/await flagPaymentForManualRefund\(session,/g)?.length).toBeGreaterThanOrEqual(3);
    expect(allSources).not.toContain("stripe.refunds.create");
    expect(flagLib).not.toContain("stripe.refunds.create");
  });
});

describe("inventory and concurrency contracts", () => {
  const orders = source("actions/boutique/orders.js");
  const workshop = source("actions/workshops/create-workshop-reservation.js");
  const formation = source("actions/formations/create-formation-reservation.js");

  test("orders reserve, release, and sell stock atomically", () => {
    expect(orders).toMatch(/reservedQuantity:\s*\{\s*increment:/);
    expect(orders).toMatch(/reservedQuantity:\s*\{\s*decrement:/);
    expect(orders).toMatch(/stockQuantity:\s*\{\s*decrement:/);
    expect(orders).toContain('FOR UPDATE');
  });

  test("concurrent checkout locks carts and product variants", () => {
    expect(orders).toContain('FROM "Cart"');
    expect(orders).toContain('FROM "ProductVariant"');
    expect(orders).toContain('throw new Error("STOCK_RACE")');
  });

  test.each([
    ["workshop", workshop, "workshop_sessions"],
    ["formation", formation, "formation_sessions"],
  ])("%s capacity uses a row lock and recomputes available seats", (_name, code, table) => {
    expect(code).toContain(`FROM ${table}`);
    expect(code).toContain("FOR UPDATE");
    expect(code).toMatch(/const available = capacity - takenSeats/);
  });
});

describe("ownership, authorization, and session contracts", () => {
  const workshopWaiting = source("actions/workshops/waiting-list.js");
  const formationWaiting = source("actions/formations/waiting-list.js");
  const reset = source("actions/auth/reset-password.js");
  const auth = source("auth.js");

  test.each([
    ["workshop", workshopWaiting],
    ["formation", formationWaiting],
  ])("%s waiting-list conversion verifies customer ownership and claims atomically", (_name, code) => {
    expect(code).toMatch(/reservation\.customerId\s*!==\s*entry\.customerId/);
    expect(code).toContain("waitingListEntry.updateMany");
    expect(code).toMatch(/status:\s*["']NOTIFIED["']/);
  });

  test("password reset invalidates existing sessions", () => {
    expect(reset).toMatch(/sessionVersion:\s*\{\s*increment:\s*1\s*\}/);
    expect(reset).toMatch(/used:\s*true/);
    expect(auth).toMatch(/dbUser\.sessionVersion\s*!==\s*token\.sessionVersion/);
    expect(auth).toMatch(/!dbUser\.isActive/);
  });
});

describe("returns and reminders contracts", () => {
  const returns = source("actions/boutique/returns.js");
  const appointmentReminders = source("lib/reminders/send-appointment-reminders.js");
  const workshopReminders = source("lib/reminders/send-workshop-reminders.js");
  const formationReminders = source("lib/reminders/send-formation-reminders.js");

  test("returns lock financial rows and cap refund/credit operations", () => {
    expect(returns).toContain('FROM "Order"');
    expect(returns).toContain('FROM "Payment"');
    expect(returns).toContain("FOR UPDATE");
    expect(returns).toContain("ALREADY_PROCESSED");
    expect(returns).toContain("issueCreditNote");
  });

  test("appointment reminders are email-only and window-bounded (no per-customer Notification row)", () => {
    // Customer reminders are deliberately EMAIL-ONLY — see the file's own
    // docstring. Dedup relies on the (gt: now, lte: cutoff) window plus
    // scheduler cadence rather than a Notification-row marker, so this
    // guards against a customer-facing Notification row creeping back in.
    expect(appointmentReminders).not.toContain("prisma.notification.create");
    expect(appointmentReminders).toMatch(/startTime:\s*\{\s*gt:\s*now,\s*lte:\s*cutoff\s*\}/);
    expect(appointmentReminders).toContain("appointmentReminderEmail");
  });

  test.each([
    ["workshop", workshopReminders],
    ["formation", formationReminders],
  ])("%s reminders exclude and mark already-sent reservations", (_name, code) => {
    expect(code).toMatch(/reminderSentAt:\s*null/);
    expect(code).toMatch(/data:\s*\{\s*reminderSentAt:\s*now\s*\}/);
  });
});
