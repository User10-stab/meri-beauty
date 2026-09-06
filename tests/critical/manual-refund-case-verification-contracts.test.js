import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    manualRefundCase: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  stripe: { refunds: { retrieve: vi.fn(), list: vi.fn() } },
  auth: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: mocks.stripe }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { resolveManualRefundCase } from "@/actions/dashboard/cancel-and-refund";

const CASE = {
  id: "case_1",
  stripeCheckoutSessionId: "cs_1",
  stripePaymentIntentId: "pi_1",
  stripeAccountId: null,
  amount: 40,
  currency: "eur",
  reason: "Paiement capturé sans réservation",
  resolvedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  mocks.prisma.manualRefundCase.findUnique.mockResolvedValue({ ...CASE });
  mocks.prisma.manualRefundCase.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback({
      manualRefundCase: { updateMany: mocks.prisma.manualRefundCase.updateMany },
      auditLog: { create: mocks.auditCreate },
    }),
  );
  mocks.stripe.refunds.retrieve.mockResolvedValue({
    id: "re_good",
    payment_intent: "pi_1",
    status: "succeeded",
    currency: "eur",
    amount: 4000,
  });
  mocks.stripe.refunds.list.mockResolvedValue({
    data: [{ id: "re_good", status: "succeeded", amount: 4000 }],
  });
});

/**
 * These cases are payments Stripe captured for a reservation/order that no
 * longer exists — there is no Payment row, no invoice, no ledger. This table
 * IS the record that the money went back, which is why closing a row used to
 * be the weakest write in the refund system: any typed string cleared it.
 */
describe("a captured-payment case closes only on verified Stripe evidence", () => {
  test("a verified, succeeded, full refund closes the case under Stripe's own id", async () => {
    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_good" });

    expect(result.success).toBe(true);
    expect(mocks.prisma.manualRefundCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "case_1", resolvedAt: null },
        data: expect.objectContaining({ resolutionReference: "re_good" }),
      }),
    );
  });

  test("a reference belonging to a different payment cannot close the case", async () => {
    mocks.stripe.refunds.retrieve.mockResolvedValue({
      id: "re_other",
      payment_intent: "pi_somebody_else",
      status: "succeeded",
      currency: "eur",
      amount: 4000,
    });

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_other" });

    expect(result.success).toBe(false);
    expect(mocks.prisma.manualRefundCase.updateMany).not.toHaveBeenCalled();
  });

  test("a refund Stripe has not completed leaves the case open", async () => {
    mocks.stripe.refunds.retrieve.mockResolvedValue({
      id: "re_pending",
      payment_intent: "pi_1",
      status: "pending",
      currency: "eur",
      amount: 4000,
    });

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_pending" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("pending");
    expect(mocks.prisma.manualRefundCase.updateMany).not.toHaveBeenCalled();
  });

  test("a short refund leaves the case open and says what is actually back", async () => {
    mocks.stripe.refunds.retrieve.mockResolvedValue({
      id: "re_short",
      payment_intent: "pi_1",
      status: "succeeded",
      currency: "eur",
      amount: 1500,
    });
    mocks.stripe.refunds.list.mockResolvedValue({
      data: [{ id: "re_short", status: "succeeded", amount: 1500 }],
    });

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_short" });

    expect(result.success).toBe(false);
    expect(result.message).toContain("15.00");
    expect(mocks.prisma.manualRefundCase.updateMany).not.toHaveBeenCalled();
  });

  test("a refund paid back in two goes still closes on either reference", async () => {
    mocks.stripe.refunds.retrieve.mockResolvedValue({
      id: "re_part_1",
      payment_intent: "pi_1",
      status: "succeeded",
      currency: "eur",
      amount: 1500,
    });
    mocks.stripe.refunds.list.mockResolvedValue({
      data: [
        { id: "re_part_1", status: "succeeded", amount: 1500 },
        { id: "re_part_2", status: "succeeded", amount: 2500 },
        // A failed attempt must not count toward the total.
        { id: "re_failed", status: "failed", amount: 4000 },
      ],
    });

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_part_1" });

    expect(result.success).toBe(true);
  });

  test("a connected-account case is verified on that account, not the platform", async () => {
    mocks.prisma.manualRefundCase.findUnique.mockResolvedValue({ ...CASE, stripeAccountId: "acct_staff_1" });

    await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_good" });

    expect(mocks.stripe.refunds.retrieve).toHaveBeenCalledWith("re_good", { stripeAccount: "acct_staff_1" });
    expect(mocks.stripe.refunds.list).toHaveBeenCalledWith(
      { payment_intent: "pi_1" },
      { stripeAccount: "acct_staff_1" },
    );
  });

  test("a pasted Stripe dashboard URL is accepted, a payment id is not", async () => {
    const fromUrl = await resolveManualRefundCase({
      caseId: "case_1",
      stripeReference: "https://dashboard.stripe.com/payments/pi_1#refund-re_good",
    });
    expect(fromUrl.success).toBe(true);

    const fromPaymentId = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "pi_1" });
    expect(fromPaymentId.success).toBe(false);
    expect(mocks.stripe.refunds.retrieve).toHaveBeenCalledTimes(1);
  });

  test("a Stripe outage leaves the case open rather than closing it unverified", async () => {
    mocks.stripe.refunds.retrieve.mockRejectedValue(new Error("connection error"));

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_good" });

    expect(result.success).toBe(false);
    expect(mocks.prisma.manualRefundCase.updateMany).not.toHaveBeenCalled();
  });

  test("a non-admin never reaches Stripe or the database", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "staff_1", role: "STAFF" } });

    const result = await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_good" });

    expect(result.success).toBe(false);
    expect(mocks.stripe.refunds.retrieve).not.toHaveBeenCalled();
    expect(mocks.prisma.manualRefundCase.findUnique).not.toHaveBeenCalled();
  });

  test("the audit trail records what Stripe confirmed, not what was typed", async () => {
    await resolveManualRefundCase({ caseId: "case_1", stripeReference: "re_good" });

    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "refund.manual_capture_case_resolved",
          metadata: expect.objectContaining({ verifiedRefundedAmount: 40 }),
        }),
      }),
    );
  });
});
