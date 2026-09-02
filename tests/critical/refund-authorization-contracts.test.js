import { describe, expect, it } from "vitest";
import {
  authorizeRefund,
  cancelsUnderlyingItem,
  releasesCapacity,
  REFUND_DENIAL,
  SHIPPED_ORDER_STATUSES,
} from "@/lib/refunds/authorize";

/**
 * The rules the handoff calls "problèmes actuels à corriger" #2 and #3:
 * administrative refunds bypassing the written customer request, and
 * appointments still refundable directly outside the 48h window.
 *
 * Pure verdicts, so they are tested as verdicts — no database, no Stripe.
 */

const healthyState = { remainingRefundable: 21, inconsistencies: [] };
const admin = "ADMIN";

const base = {
  actorRole: admin,
  source: "APPOINTMENT",
  trigger: "SALON_CANCELLATION",
  reason: "Salon fermé pour force majeure",
  state: healthyState,
  appointment: { status: "CONFIRMED" },
  payment: { pendingRefundAmount: null },
};

describe("who may refund", () => {
  it("refuses STAFF outright", () => {
    expect(authorizeRefund({ ...base, actorRole: "STAFF" })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.NOT_ADMIN,
    });
  });

  it("allows OWNER and ADMIN", () => {
    expect(authorizeRefund({ ...base, actorRole: "OWNER" }).allowed).toBe(true);
    expect(authorizeRefund({ ...base, actorRole: "ADMIN" }).allowed).toBe(true);
  });
});

describe("a motive is always mandatory", () => {
  it("refuses an empty reason even for a salon-side cancellation", () => {
    expect(authorizeRefund({ ...base, reason: "   " })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.REASON_REQUIRED,
    });
  });
});

describe("a customer-initiated cancellation needs an approved written request", () => {
  it("refuses when no request exists at all", () => {
    expect(
      authorizeRefund({ ...base, trigger: "CUSTOMER_REQUEST_APPROVED", cancellationRequest: null }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.REQUEST_REQUIRED });
  });

  it("refuses a request still pending review", () => {
    expect(
      authorizeRefund({
        ...base,
        trigger: "CUSTOMER_REQUEST_APPROVED",
        cancellationRequest: { status: "PENDING" },
      }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.REQUEST_NOT_APPROVED });
  });

  it("refuses a rejected request", () => {
    expect(
      authorizeRefund({
        ...base,
        trigger: "CUSTOMER_REQUEST_APPROVED",
        cancellationRequest: { status: "REJECTED" },
      }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.REQUEST_NOT_APPROVED });
  });

  it("allows an approved one", () => {
    expect(
      authorizeRefund({
        ...base,
        trigger: "CUSTOMER_REQUEST_APPROVED",
        cancellationRequest: { status: "APPROVED" },
      }).allowed,
    ).toBe(true);
  });

  // The 48h loophole: distance in time was never an authorization, and the
  // rule holds "même plus de 48 heures avant la prestation".
  it("still needs the request for a booking far in the future", () => {
    const farFuture = { status: "CONFIRMED", date: new Date("2027-12-31T10:00:00Z") };
    expect(
      authorizeRefund({
        ...base,
        appointment: farFuture,
        trigger: "CUSTOMER_REQUEST_APPROVED",
        cancellationRequest: null,
      }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.REQUEST_REQUIRED });
  });
});

describe("historical statuses", () => {
  it("blocks a COMPLETED appointment on every trigger", () => {
    for (const trigger of ["SALON_CANCELLATION", "CUSTOMER_REQUEST_APPROVED", "NO_SHOW_EXCEPTION"]) {
      expect(
        authorizeRefund({
          ...base,
          trigger,
          appointment: { status: "COMPLETED" },
          cancellationRequest: { status: "APPROVED" },
        }),
        `trigger ${trigger} must not refund a COMPLETED appointment`,
      ).toMatchObject({ allowed: false, code: REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE });
    }
  });

  it("blocks a COMPLETED workshop reservation too", () => {
    expect(
      authorizeRefund({ ...base, source: "WORKSHOP", appointment: null, reservation: { status: "COMPLETED" } }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE });
  });

  it("allows a NO_SHOW only as an explicit motivated exception", () => {
    expect(
      authorizeRefund({ ...base, trigger: "SALON_CANCELLATION", appointment: { status: "NO_SHOW" } }).allowed,
    ).toBe(false);
    expect(
      authorizeRefund({ ...base, trigger: "NO_SHOW_EXCEPTION", appointment: { status: "NO_SHOW" } }).allowed,
    ).toBe(true);
  });

  it("keeps the NO_SHOW booking's status instead of cancelling it", () => {
    expect(cancelsUnderlyingItem("NO_SHOW_EXCEPTION")).toBe(false);
    expect(cancelsUnderlyingItem("SALON_CANCELLATION")).toBe(true);
    expect(cancelsUnderlyingItem("CUSTOMER_REQUEST_APPROVED")).toBe(true);
  });
});

describe("orders", () => {
  const orderBase = { ...base, source: "ORDER", appointment: null };

  it("refuses to cancel a shipped order in place", () => {
    expect(authorizeRefund({ ...orderBase, order: { status: "SHIPPED" } })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.ORDER_ALREADY_SHIPPED,
    });
  });

  it("allows an order still in the salon", () => {
    expect(authorizeRefund({ ...orderBase, order: { status: "READY_FOR_PICKUP" } }).allowed).toBe(true);
    expect(authorizeRefund({ ...orderBase, order: { status: "PAID" } }).allowed).toBe(true);
    expect(SHIPPED_ORDER_STATUSES.has("READY_FOR_PICKUP")).toBe(false);
  });

  it("needs the goods physically back before refunding a return", () => {
    expect(
      authorizeRefund({ ...orderBase, trigger: "SHOP_RETURN", order: { status: "COMPLETED" }, returnRequest: null }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.RETURN_NOT_RECEIVED });

    expect(
      authorizeRefund({
        ...orderBase,
        trigger: "SHOP_RETURN",
        order: { status: "COMPLETED" },
        returnRequest: { status: "REQUESTED" },
      }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.RETURN_NOT_RECEIVED });

    expect(
      authorizeRefund({
        ...orderBase,
        trigger: "SHOP_RETURN",
        order: { status: "COMPLETED" },
        returnRequest: { status: "COMPLETED" },
      }).allowed,
    ).toBe(true);
  });
});

describe("money must exist and the ledger must make sense", () => {
  it("refuses a request with nothing collected", () => {
    expect(
      authorizeRefund({ ...base, state: { remainingRefundable: 0, inconsistencies: [] } }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.NO_PAYMENT_COLLECTED });
  });

  it("sends an inconsistent ledger to reconciliation", () => {
    expect(
      authorizeRefund({
        ...base,
        state: { remainingRefundable: 21, inconsistencies: [{ code: "REFUNDED_EXCEEDS_COLLECTED" }] },
      }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.LEDGER_INCONSISTENT });
  });

  // The interlock that keeps the new orchestrator and the five legacy
  // refund paths from both calling Stripe on one payment.
  it("refuses while the legacy machinery has a refund pinned on the payment", () => {
    expect(authorizeRefund({ ...base, payment: { pendingRefundAmount: 10.5 } })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.REFUND_ALREADY_IN_FLIGHT,
    });
  });
});

describe("capacity is released only by a full refund", () => {
  it("releases the seat when the whole outstanding balance goes back", () => {
    expect(
      releasesCapacity({ trigger: "SALON_CANCELLATION", plannedTotal: 21, remainingRefundable: 21 }),
    ).toBe(true);
  });

  it("keeps the seat on a partial refund", () => {
    expect(
      releasesCapacity({ trigger: "SALON_CANCELLATION", plannedTotal: 10.5, remainingRefundable: 21 }),
    ).toBe(false);
  });

  it("never releases anything for a no-show exception", () => {
    expect(releasesCapacity({ trigger: "NO_SHOW_EXCEPTION", plannedTotal: 21, remainingRefundable: 21 })).toBe(
      false,
    );
  });
});
