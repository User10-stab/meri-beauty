import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const mocks = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: { findMany: mocks.findMany },
    transaction: { aggregate: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { expireStalePendingAppointments } from "@/lib/appointments/expire-stale-appointments";

beforeEach(() => {
  mocks.findMany.mockClear();
  mocks.findMany.mockResolvedValue([]);
  // The job ships OFF (Marie, 2026-09-15 — staff resolves a PENDING request or
  // nobody does). The rule assertions below are about whether the rules are
  // still correct should it ever be switched back on, so they opt in
  // explicitly; the kill switch itself is covered in its own describe block.
  process.env.APPOINTMENT_AUTO_EXPIRY = "on";
});

afterEach(() => {
  delete process.env.APPOINTMENT_AUTO_EXPIRY;
});

describe("the auto-expiry kill switch", () => {
  test("does nothing at all unless APPOINTMENT_AUTO_EXPIRY is exactly 'on'", async () => {
    for (const value of [undefined, "", "off", "false", "true", "ON", "1", "yes"]) {
      mocks.findMany.mockClear();
      if (value === undefined) delete process.env.APPOINTMENT_AUTO_EXPIRY;
      else process.env.APPOINTMENT_AUTO_EXPIRY = value;

      const result = await expireStalePendingAppointments();

      // Not merely "expired nothing" — it must not even reach the database,
      // so a future query bug cannot throw from a job nobody wants running.
      expect(mocks.findMany, `APPOINTMENT_AUTO_EXPIRY=${String(value)}`).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: true, expiredCount: 0 });
    }
  });

  test("the runners still report a disabled run as a clean zero, not a failure", async () => {
    delete process.env.APPOINTMENT_AUTO_EXPIRY;
    const result = await expireStalePendingAppointments();
    // Both schedulers branch on `?.expiredCount` for their summary line and on
    // a rejected promise for failedJobs — a falsy count and no throw is the
    // shape that keeps a disabled job out of both.
    expect(result.success).toBe(true);
    expect(result.expiredCount).toBeFalsy();
  });
});

// The job filtered on `payment: { status, createdAt }`, but Payment has no
// createdAt column. Prisma rejected the whole findMany, so the job threw on
// every 5-minute run and NOTHING was ever expired — the two unrelated rules
// in the same OR (7-day-old request, startTime already passed) went down
// with it. Silent in the suite: no test here called the job at all, and a
// source grep cannot know which columns exist.
describe("the stale-appointment expiry query only filters on columns that exist", () => {
  test("Payment genuinely has no createdAt — the assumption the appointment-level date stands in for", () => {
    const schema = source("prisma/schema.prisma");
    const payment = schema.slice(schema.indexOf("\nmodel Payment {"));
    const body = payment.slice(0, payment.indexOf("\n}"));
    expect(body).toContain("status ");
    expect(body).not.toMatch(/^\s*createdAt\s/m);
    // If someone adds Payment.createdAt later, this fails on purpose: the
    // proxy below can then be replaced with the real column.
  });

  test("the pending-payment rule dates off the appointment, never off the payment", async () => {
    await expireStalePendingAppointments();

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const { where } = mocks.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ status: "PENDING", isDeleted: false });

    const paymentRule = where.OR.find((clause) => "payment" in clause);
    expect(paymentRule, "the pending-payment rule must still exist").toBeTruthy();
    // Both keys in one object — Prisma ANDs them. Losing the createdAt bound
    // would expire every pending-payment appointment the moment it is made.
    expect(paymentRule.payment).toEqual({ is: { status: "PENDING" } });
    expect(paymentRule.createdAt?.lt).toBeInstanceOf(Date);
    expect(JSON.stringify(paymentRule.payment)).not.toContain("createdAt");
  });

  test("the other two rules stay independent, so one bad clause cannot take them down", async () => {
    await expireStalePendingAppointments();
    const { where } = mocks.findMany.mock.calls[0][0];

    expect(where.OR).toHaveLength(3);
    expect(where.OR.some((c) => c.createdAt && !c.payment)).toBe(true);
    expect(where.OR.some((c) => c.startTime)).toBe(true);
  });

  test("the reason picker reads the age off the appointment too", () => {
    // Comments stripped first — this file and the job both discuss the old
    // expression by name, and the assertion is about code, not prose.
    const code = source("lib/appointments/expire-stale-appointments.js")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // `payment.createdAt < paymentCutoff` compared undefined to a Date, which
    // is always false — so this branch was unreachable and every cancellation
    // wrongly said "après 7 jours", the bug the picker exists to fix.
    expect(code).not.toContain("payment.createdAt");
    expect(code).toContain("appointment.createdAt < paymentCutoff");
  });
});
