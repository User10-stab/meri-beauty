import { describe, expect, test, vi } from "vitest";
import { reconcileMissedRefunds } from "../../lib/payments/reconcile-missed-refunds.js";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));

// Per-account fixtures let a single stripeMock stand in for both the
// platform account (options undefined) and one or more connected accounts
// (options.stripeAccount) — reconcileMissedRefunds scans all of them.
function stripeMock({ accounts = {} } = {}) {
  const byAccount = (options) => accounts[options?.stripeAccount ?? "__platform__"] ?? { refunds: [], charge: null, sessions: [] };
  return {
    refunds: {
      list: vi.fn().mockImplementation((_params, options) =>
        Promise.resolve({ data: byAccount(options).refunds ?? [], has_more: false })),
    },
    charges: {
      retrieve: vi.fn().mockImplementation((_id, _params, options) =>
        Promise.resolve(byAccount(options).charge)),
    },
    checkout: {
      sessions: {
        list: vi.fn().mockImplementation((_params, options) =>
          Promise.resolve({ data: byAccount(options).sessions ?? [] })),
      },
    },
  };
}

function orderPayment({ recordedRefund = 0 } = {}) {
  return {
    id: "pay_1",
    orderId: "order_1",
    paidAmount: 21,
    invoice: null,
    transactions: recordedRefund ? [{ transactionType: "REFUND", amount: recordedRefund }] : [],
    order: { id: "order_1", orderNumber: 83, status: "PAID", items: [{ variantId: "variant_1", quantity: 2 }] },
    workshopReservation: null,
    formationReservation: null,
    appointment: null,
  };
}

function appointmentPayment({ recordedRefund = 0 } = {}) {
  return {
    id: "pay_appt_1",
    orderId: null,
    paidAmount: 45,
    invoice: null,
    transactions: recordedRefund ? [{ transactionType: "REFUND", amount: recordedRefund }] : [],
    order: null,
    workshopReservation: null,
    formationReservation: null,
    appointment: {
      id: "appt_1",
      status: "CONFIRMED",
      date: "2026-09-01T10:00:00.000Z",
      notes: null,
      user: { email: "client@example.com", fullName: "Julie Client" },
    },
  };
}

function prismaMock({ linkedPaymentId = "pay_1", payment, staff = [] }) {
  const txStub = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockResolvedValue({}),
    },
    transaction: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: "tx_refund" }),
    },
    order: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    appointment: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    productVariant: { update: vi.fn().mockResolvedValue({ stockQuantity: 5 }) },
    inventoryMovement: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    transaction: { findFirst: vi.fn().mockResolvedValue(linkedPaymentId ? { paymentId: linkedPaymentId } : null) },
    payment: { findUnique: vi.fn().mockResolvedValue(payment) },
    staff: { findMany: vi.fn().mockResolvedValue(staff) },
    $transaction: vi.fn().mockImplementation((cb) => cb(txStub)),
    __txStub: txStub,
  };
}

describe("reconcileMissedRefunds — platform account (boutique/workshop/formation)", () => {
  test("recovers a refund that never reached the webhook", async () => {
    const payment = orderPayment();
    const stripeClient = stripeMock({
      accounts: {
        __platform__: {
          refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
          charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }] } },
        },
      },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 1, failures: [] });
    expect(prismaClient.$transaction).toHaveBeenCalledOnce();
    expect(prismaClient.__txStub.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("is a no-op once the webhook has already recorded the full amount", async () => {
    const payment = orderPayment({ recordedRefund: 21 });
    const stripeClient = stripeMock({
      accounts: {
        __platform__: {
          refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
          charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }] } },
        },
      },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 0 });
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });

  test("skips a refund whose PaymentIntent matches nothing of ours", async () => {
    const stripeClient = stripeMock({
      accounts: {
        __platform__: {
          refunds: [{ id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 }],
          charge: { id: "ch_1", amount_refunded: 500, payment_intent: "pi_unknown", refunds: { data: [] } },
          sessions: [],
        },
      },
    });
    const prismaClient = prismaMock({ linkedPaymentId: null, payment: null });
    prismaClient.payment.findUnique.mockResolvedValue(null);

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 0, failures: [] });
    expect(prismaClient.$transaction).not.toHaveBeenCalled();
  });

  test("dedupes refunds against the same charge listed twice", async () => {
    const payment = orderPayment({ recordedRefund: 21 });
    const stripeClient = stripeMock({
      accounts: {
        __platform__: {
          refunds: [
            { id: "re_1", status: "succeeded", charge: "ch_1", created: 1_700_000_000 },
            { id: "re_2", status: "succeeded", charge: "ch_1", created: 1_700_000_100 },
          ],
          charge: { id: "ch_1", amount_refunded: 2100, payment_intent: "pi_1", refunds: { data: [{ id: "re_1" }, { id: "re_2" }] } },
        },
      },
    });
    const prismaClient = prismaMock({ payment });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result.checked).toBe(1); // deduped by charge id, not re-fetched twice
    expect(stripeClient.charges.retrieve).toHaveBeenCalledOnce();
  });
});

describe("reconcileMissedRefunds — connected accounts (appointments)", () => {
  test("scans every staff member's own connected account and recovers a missed appointment refund", async () => {
    const payment = appointmentPayment();
    const stripeClient = stripeMock({
      accounts: {
        __platform__: { refunds: [] },
        acct_staff_1: {
          refunds: [{ id: "re_2", status: "succeeded", charge: "ch_2", created: 1_700_000_000 }],
          charge: { id: "ch_2", amount_refunded: 4500, payment_intent: "pi_2", refunds: { data: [{ id: "re_2" }] } },
        },
      },
    });
    const prismaClient = prismaMock({ payment, staff: [{ stripeAccountId: "acct_staff_1" }] });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 1, reconciled: 1, failures: [] });
    expect(stripeClient.refunds.list).toHaveBeenCalledWith(
      expect.anything(),
      { stripeAccount: "acct_staff_1" },
    );
    expect(prismaClient.__txStub.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "appt_1", status: { in: ["PENDING", "CONFIRMED"] } },
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
  });

  test("never touches a COMPLETED appointment even on a full external refund", async () => {
    const payment = appointmentPayment();
    payment.appointment.status = "COMPLETED";
    const stripeClient = stripeMock({
      accounts: {
        __platform__: { refunds: [] },
        acct_staff_1: {
          refunds: [{ id: "re_2", status: "succeeded", charge: "ch_2", created: 1_700_000_000 }],
          charge: { id: "ch_2", amount_refunded: 4500, payment_intent: "pi_2", refunds: { data: [{ id: "re_2" }] } },
        },
      },
    });
    const prismaClient = prismaMock({ payment, staff: [{ stripeAccountId: "acct_staff_1" }] });
    prismaClient.__txStub.appointment.updateMany.mockResolvedValue({ count: 0 });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result.reconciled).toBe(1); // ledger/payment status still syncs
    expect(prismaClient.__txStub.appointment.updateMany).toHaveBeenCalledWith({
      where: { id: "appt_1", status: { in: ["PENDING", "CONFIRMED"] } }, // COMPLETED can't match this claim
      data: expect.objectContaining({ status: "CANCELLED" }),
    });
    expect(prismaClient.__txStub.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REFUNDED" } }),
    );
  });

  test("staff with no connected account are never scanned", async () => {
    const stripeClient = stripeMock({ accounts: { __platform__: { refunds: [] } } });
    const prismaClient = prismaMock({ payment: null, staff: [] });

    const result = await reconcileMissedRefunds({ stripeClient, prismaClient });

    expect(result).toMatchObject({ checked: 0, reconciled: 0, failures: [] });
    expect(stripeClient.refunds.list).toHaveBeenCalledOnce(); // platform scan only
  });
});
