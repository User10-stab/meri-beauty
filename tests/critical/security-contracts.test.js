import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("payment and webhook security contracts", () => {
  const webhook = source("app/api/webhooks/stripe/route.js");

  test("Stripe webhook verifies signatures and persists idempotency keys", () => {
    expect(webhook).toContain("stripe.webhooks.constructEvent");
    expect(webhook).toMatch(/where:\s*\{\s*transactionReference:\s*session\.id/);
    expect(webhook).toMatch(/transactionReference:\s*session\.id/);
    expect(webhook).toContain('FOR UPDATE');
  });

  test("underpayments and invalid late payments are refunded", () => {
    expect(webhook).toContain("UNDERPAYMENT_EPSILON");
    expect(webhook.match(/reason:\s*["']underpayment["']/g)?.length).toBeGreaterThanOrEqual(3);
    expect(webhook).toContain("await refundSession(session)");
    expect(webhook).toContain("stripe.refunds.create");
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

  test("appointment reminders have per-window deduplication markers", () => {
    expect(appointmentReminders).toContain('type: "APPOINTMENT_REMINDER"');
    expect(appointmentReminders).toMatch(/notifications:\s*\{\s*none:/);
    expect(appointmentReminders).toContain("prisma.notification.create");
  });

  test.each([
    ["workshop", workshopReminders],
    ["formation", formationReminders],
  ])("%s reminders exclude and mark already-sent reservations", (_name, code) => {
    expect(code).toMatch(/reminderSentAt:\s*null/);
    expect(code).toMatch(/data:\s*\{\s*reminderSentAt:\s*now\s*\}/);
  });
});
