import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { payment: { findFirst: vi.fn() } },
  stripe: { checkout: { sessions: { list: vi.fn(), retrieve: vi.fn() } } },
  isForeignCheckoutSession: vi.fn(() => false),
  fulfillOrderPayment: vi.fn(),
  confirmWorkshopReservationPayment: vi.fn(),
  confirmFormationReservationPayment: vi.fn(),
  captureCriticalError: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: mocks.stripe }));
vi.mock("@/lib/stripe-deployment", () => ({ isForeignCheckoutSession: mocks.isForeignCheckoutSession }));
vi.mock("@/lib/monitoring", () => ({ captureCriticalError: mocks.captureCriticalError }));
vi.mock("@/lib/orders/fulfill-order-payment", () => ({ fulfillOrderPayment: mocks.fulfillOrderPayment }));
vi.mock("@/lib/workshops/fulfill-workshop-reservation-payment", () => ({
  confirmWorkshopReservationPayment: mocks.confirmWorkshopReservationPayment,
}));
vi.mock("@/lib/formations/fulfill-formation-reservation-payment", () => ({
  confirmFormationReservationPayment: mocks.confirmFormationReservationPayment,
}));

import { reconcileMissedCheckouts } from "@/lib/payments/reconcile-missed-checkouts";

// 31 Aug 2026: a `stripe listen` CLI session only forwards events while
// connected, unlike a registered Dashboard endpoint — Stripe does not queue
// or retry deliveries for it. Reported symptom: a customer paid, Stripe shows
// the charge succeeded, but the reservation stayed PENDING_DEPOSIT with no
// Payment row because nobody's local listener was up to receive the webhook.
// This job is the mirror image of reconcile-missed-refunds.js: it re-derives
// "was this actually paid" from Stripe's own Checkout Session list instead of
// trusting webhook delivery, and replays the same idempotent confirm calls.
function session(overrides = {}) {
  return {
    id: "cs_test_1",
    payment_status: "paid",
    metadata: { kind: "workshop", reservationId: "r1" },
    ...overrides,
  };
}

function onePage(sessions) {
  mocks.stripe.checkout.sessions.list.mockResolvedValueOnce({ data: sessions, has_more: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isForeignCheckoutSession.mockReturnValue(false);
  mocks.prisma.payment.findFirst.mockResolvedValue(null);
  mocks.stripe.checkout.sessions.retrieve.mockImplementation(async (id) => session({ id }));
});

describe("reconcileMissedCheckouts", () => {
  it("confirms a workshop deposit Stripe already shows as paid but we never fulfilled", async () => {
    onePage([session({ id: "cs_1", metadata: { kind: "workshop", reservationId: "r1", workshopAction: "deposit" } })]);

    const result = await reconcileMissedCheckouts();

    expect(mocks.confirmWorkshopReservationPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "cs_1" }));
    expect(result).toEqual({ checked: 1, reconciled: 1, flagged: 0, failures: [] });
  });

  it("confirms orders and formations too", async () => {
    onePage([
      session({ id: "cs_order", metadata: { kind: "order", orderId: "o1" } }),
      session({ id: "cs_formation", metadata: { kind: "formation", reservationId: "f1" } }),
    ]);

    await reconcileMissedCheckouts();

    expect(mocks.fulfillOrderPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "cs_order" }));
    expect(mocks.confirmFormationReservationPayment).toHaveBeenCalledWith(expect.objectContaining({ id: "cs_formation" }));
  });

  it("counts a flagged-for-review outcome separately from a genuine confirmation — it must never inflate the 'recovered' count", async () => {
    onePage([session({ id: "cs_orphan", metadata: { kind: "workshop", reservationId: "r1", workshopAction: "deposit" } })]);
    mocks.confirmWorkshopReservationPayment.mockResolvedValueOnce({
      received: true,
      refunded: false,
      flaggedForReview: true,
      reason: "reservation deleted",
    });

    const result = await reconcileMissedCheckouts();

    expect(result).toEqual({ checked: 1, reconciled: 0, flagged: 1, failures: [] });
  });

  it("skips a session the webhook already fulfilled", async () => {
    onePage([session({ id: "cs_done" })]);
    mocks.prisma.payment.findFirst.mockResolvedValueOnce({ id: "payment_1" });

    const result = await reconcileMissedCheckouts();

    expect(mocks.confirmWorkshopReservationPayment).not.toHaveBeenCalled();
    expect(result.reconciled).toBe(0);
  });

  it("skips sessions that are not actually paid", async () => {
    onePage([session({ payment_status: "unpaid" })]);

    const result = await reconcileMissedCheckouts();

    expect(mocks.confirmWorkshopReservationPayment).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it("never touches a session created by another deployment — that belongs to a different database", async () => {
    mocks.isForeignCheckoutSession.mockReturnValueOnce(true);
    onePage([session()]);

    const result = await reconcileMissedCheckouts();

    expect(mocks.confirmWorkshopReservationPayment).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it("leaves session/seat change-fee checkouts alone — they extend an existing Payment through a separate idempotent path", async () => {
    onePage([session({ metadata: { kind: "workshop", reservationId: "r1", workshopAction: "session_change_fee" } })]);

    const result = await reconcileMissedCheckouts();

    expect(mocks.confirmWorkshopReservationPayment).not.toHaveBeenCalled();
    expect(result.checked).toBe(0);
  });

  it("one session failing does not stop the rest from being reconciled", async () => {
    onePage([session({ id: "cs_bad" }), session({ id: "cs_good" })]);
    mocks.confirmWorkshopReservationPayment.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const result = await reconcileMissedCheckouts();

    expect(result.reconciled).toBe(1);
    expect(result.failures).toEqual([{ sessionId: "cs_bad", message: "boom" }]);
    expect(mocks.captureCriticalError).toHaveBeenCalledOnce();
  });

  it("pages through Stripe's full result set", async () => {
    mocks.stripe.checkout.sessions.list
      .mockResolvedValueOnce({ data: [session({ id: "cs_a" })], has_more: true })
      .mockResolvedValueOnce({ data: [session({ id: "cs_b" })], has_more: false });

    const result = await reconcileMissedCheckouts();

    expect(result.checked).toBe(2);
    expect(mocks.stripe.checkout.sessions.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ starting_after: "cs_a" })
    );
  });
});
