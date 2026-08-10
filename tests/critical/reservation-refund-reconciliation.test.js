import { describe, expect, test, vi } from "vitest";
import {
  reconcileExceptionalReservationFullRefund,
  RESERVATION_REFUND_AUTHORIZATION,
  summarizePaymentAmounts,
} from "../../lib/payments/reconcile-reservation-refund.js";

const authorization = RESERVATION_REFUND_AUTHORIZATION.ADMIN_EXTERNAL_STRIPE_REFUND;

function makeTx({ workshopClaims = [], formationClaims = [] } = {}) {
  return {
    workshopReservation: { updateMany: vi.fn().mockImplementation(() => ({ count: workshopClaims.shift() ?? 0 })) },
    formationReservation: { updateMany: vi.fn().mockImplementation(() => ({ count: formationClaims.shift() ?? 0 })) },
  };
}

describe("exceptional reservation refund reconciliation", () => {
  test.each([
    ["workshop/event", "workshopReservation", "workshopReservation", "workshopClaims"],
    ["formation", "formationReservation", "formationReservation", "formationClaims"],
  ])("a full admin-authorized %s refund cancels CONFIRMED and releases its seats", async (_label, relation, model, claimsKey) => {
    const tx = makeTx({ [claimsKey]: [1] });
    const payment = {
      paidAmount: 21,
      [relation]: { id: "reservation-1", sessionId: "session-1", seatsCount: 2, status: "CONFIRMED", notes: null },
    };

    const result = await reconcileExceptionalReservationFullRefund(tx, {
      payment,
      stripeRefundedTotal: 21,
      authorization,
      refundedAt: new Date("2026-08-10T12:00:00Z"),
    });

    expect(result).toMatchObject({ reconciled: true, releasedSeats: 2, reservationKind: relation === "workshopReservation" ? "workshop" : "formation" });
    expect(tx[model].updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "reservation-1", status: "CONFIRMED" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  test("partial refunds preserve a confirmed reservation and its capacity", async () => {
    const tx = makeTx();
    const result = await reconcileExceptionalReservationFullRefund(tx, {
      payment: { paidAmount: 21, workshopReservation: { id: "r1", seatsCount: 2, status: "CONFIRMED" } },
      stripeRefundedTotal: 10,
      authorization,
    });

    expect(result).toEqual({ reconciled: false, reason: "partial-refund", releasedSeats: 0 });
    expect(tx.workshopReservation.updateMany).not.toHaveBeenCalled();
  });

  test("webhook replay cannot release capacity twice", async () => {
    const tx = makeTx({ workshopClaims: [1, 0] });
    const input = {
      payment: { paidAmount: 21, workshopReservation: { id: "r1", sessionId: "s1", seatsCount: 3, status: "CONFIRMED" } },
      stripeRefundedTotal: 21,
      authorization,
    };

    const first = await reconcileExceptionalReservationFullRefund(tx, input);
    const replay = await reconcileExceptionalReservationFullRefund(tx, input);

    expect(first.releasedSeats).toBe(3);
    expect(replay).toEqual({ reconciled: false, reason: "already-released-or-not-confirmed", releasedSeats: 0 });
  });

  test("the helper refuses refunds without explicit admin-exception provenance", async () => {
    const tx = makeTx();
    const result = await reconcileExceptionalReservationFullRefund(tx, {
      payment: { paidAmount: 21, formationReservation: { id: "r1", status: "CONFIRMED" } },
      stripeRefundedTotal: 21,
    });

    expect(result.reason).toBe("admin-authorization-required");
    expect(tx.formationReservation.updateMany).not.toHaveBeenCalled();
  });

  test("paidAmount remains gross while reporting exposes net collected revenue", () => {
    const payment = {
      paidAmount: 21,
      transactions: [
        { transactionType: "DEPOSIT", amount: 21 },
        { transactionType: "REFUND", amount: 8 },
        { transactionType: "REFUND", amount: 13 },
      ],
    };

    expect(summarizePaymentAmounts(payment)).toEqual({
      grossPaidAmount: 21,
      refundedAmount: 21,
      netCollectedAmount: 0,
    });
    expect(payment.paidAmount).toBe(21);
  });
});
