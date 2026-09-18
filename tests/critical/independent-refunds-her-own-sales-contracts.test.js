import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { authorizeRefund, authorizeRefundActor, REFUND_DENIAL } from "@/lib/refunds/authorize";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 17/09/2026 — an independent practitioner's sale is charged to her own
// Stripe account, under her own VAT number. She refunds it herself, from Mes
// opérations; the admin is refused on it, which is the half that used to be
// impossible to express with a role check alone.
describe("who may refund is decided by whose sale it is", () => {
  it("the salon's sale stays OWNER/ADMIN only", () => {
    expect(authorizeRefundActor({ actorRole: "ADMIN", payeeStaffId: null }).allowed).toBe(true);
    expect(authorizeRefundActor({ actorRole: "OWNER", payeeStaffId: null }).allowed).toBe(true);
    // Marie collects at the till but never refunds the salon's money.
    expect(authorizeRefundActor({ actorRole: "STAFF", actorStaffId: "s_marie", payeeStaffId: null })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.NOT_ADMIN,
    });
  });

  it("her sale is hers alone — the admin included", () => {
    expect(
      authorizeRefundActor({ actorRole: "STAFF", actorStaffId: "s_julie", payeeStaffId: "s_julie" }).allowed,
    ).toBe(true);
    expect(authorizeRefundActor({ actorRole: "ADMIN", actorStaffId: null, payeeStaffId: "s_julie" })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.NOT_PAYMENT_OWNER,
    });
    expect(
      authorizeRefundActor({ actorRole: "STAFF", actorStaffId: "s_lyly", payeeStaffId: "s_julie" }),
    ).toMatchObject({ allowed: false, code: REFUND_DENIAL.NOT_PAYMENT_OWNER });
  });

  it("the full authorization runs that same check first", () => {
    const base = {
      source: "APPOINTMENT",
      trigger: "SALON_CANCELLATION",
      reason: "Empêchement de dernière minute",
      state: { remainingRefundable: 45, inconsistencies: [] },
      appointment: { status: "CONFIRMED" },
      payment: { pendingRefundAmount: null, payeeStaffId: "s_julie" },
    };
    expect(authorizeRefund({ ...base, actorRole: "ADMIN" })).toMatchObject({
      allowed: false,
      code: REFUND_DENIAL.NOT_PAYMENT_OWNER,
    });
    expect(authorizeRefund({ ...base, actorRole: "STAFF", actorStaffId: "s_julie" }).allowed).toBe(true);
  });
});

describe("her refund never touches the salon's books", () => {
  const onlineDeposit = {
    id: "deposit-40",
    amount: 40,
    method: "ONLINE",
    transactionType: "DEPOSIT",
    paidAt: new Date("2026-09-01T10:00:00Z"),
    isDeleted: false,
    stripePaymentIntentId: "pi_40",
    stripeCheckoutSessionId: "cs_40",
  };
  const cashDeposit = { ...onlineDeposit, id: "cash-40", method: "CASH", stripePaymentIntentId: null };

  function txMock(owner) {
    return {
      payment: { findUnique: vi.fn().mockResolvedValue(owner) },
      refundOperation: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({ id: "op-1", ...data, legs: data.legs.create })),
      },
      cashSession: { findFirst: vi.fn().mockResolvedValue({ id: "cash-session-1" }) },
      auditLog: { create: vi.fn() },
      notification: { create: vi.fn() },
    };
  }

  const queue = (tx, transactions) =>
    queueManualRefund(tx, {
      paymentId: "payment-1",
      source: "APPOINTMENT",
      trigger: "CUSTOMER_SELF_CANCELLATION",
      reason: "Annulation par la cliente",
      amount: 40,
      transactions,
    });

  it("her cash refund gets no cash-book piece number and no till session", async () => {
    const tx = txMock({ payeeStaffId: "s_julie", payeeStaff: { userId: "u_julie" } });
    const result = await queue(tx, [cashDeposit]);
    expect(result.legs[0]).toMatchObject({ pieceNumber: null, cashSessionId: null });
    expect(tx.cashSession.findFirst).not.toHaveBeenCalled();
  });

  it("the salon's cash refund still books its piece number", async () => {
    const tx = txMock({ payeeStaffId: null, payeeStaff: null });
    tx.$queryRaw = vi.fn().mockResolvedValue([{ lastNumber: 12 }]);
    const result = await queue(tx, [cashDeposit]);
    expect(result.legs[0].cashSessionId).toBe("cash-session-1");
    expect(result.legs[0].pieceNumber).not.toBeNull();
  });

  it("she is told a refund is waiting for her, since nobody else will do it", async () => {
    const tx = txMock({ payeeStaffId: "s_julie", payeeStaff: { userId: "u_julie" } });
    await queue(tx, [onlineDeposit]);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "u_julie", actionUrl: "/dashboard/mes-operations" }) }),
    );
  });

  it("a B2B customer of hers does not demand a salon credit note", async () => {
    const tx = txMock({ payeeStaffId: "s_julie", payeeStaff: { userId: "u_julie" } });
    await expect(
      queueManualRefund(tx, {
        paymentId: "payment-1",
        source: "APPOINTMENT",
        trigger: "SALON_CANCELLATION",
        reason: "Annulation",
        amount: 40,
        transactions: [onlineDeposit],
        customerIsBusiness: true,
      }),
    ).resolves.toMatchObject({ operationId: "op-1" });
  });
});

describe("the refund actions and screens follow the same owner", () => {
  const action = source("actions/dashboard/cancel-and-refund.js");

  test("every refund action resolves the actor's own Staff row instead of demanding admin", () => {
    for (const fn of ["previewCancelAndRefund", "cancelAndRefund", "confirmManualRefundLeg", "sendB2CRefundConfirmation"]) {
      const body = action.slice(action.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 400), fn).toContain("await requireRefundActor()");
    }
    // ...and each one checks the payment's owner before doing anything.
    expect(action.match(/ownerVerdict\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("the salon's worklist holds the salon's refunds only, and hers holds hers", () => {
    expect(action).toContain("loadOutstandingRefundLegs({ payeeStaffId: null })");
    expect(action).toContain("loadOutstandingRefundLegs({ payeeStaffId: guard.actor.staffId })");
    expect(action).toContain("refundOperation: { payment: paymentWhere },");
  });

  test("the salon issues no document for her refund, and cannot open her sale", () => {
    expect(action).toContain('if (context.payeeStaffId) throw new Error("INDEPENDENT_SALE");');
    expect(source("actions/dashboard/admin-operations.js")).toContain(
      'if (transaction.payment?.payeeStaffId) return { success: false, message: "Non autorisé." };',
    );
  });

  test("openRefundOperation reads the owner, skips the salon's paperwork and its cash book", () => {
    const code = source("lib/refunds/open-refund-operation.js");
    expect(code).toContain("payeeStaffId: true,");
    expect(code).toContain("const independentSale = Boolean(context.payeeStaffId);");
    expect(code).toContain('"INDEPENDENT_SALE_HAS_SALON_INVOICE"');
    expect(code).toContain('const salonCashRefund = (leg) => leg.method === "CASH" && !independentSale;');
    expect(code).toContain("actorStaffId: actor.staffId ?? null,");
  });

  test("the audit records who really confirmed a hand-over", () => {
    expect(source("lib/refunds/settle-leg.js")).toContain('manual.confirmedByRole ?? "ADMIN"');
    expect(action).toContain("confirmedByRole: actor.role,");
  });

  test("the older cancel buttons refuse to refund her sale for her", () => {
    expect(source("actions/appointment/manage-appointment.js")).toContain("if (payment.payeeStaffId) {");
    for (const path of ["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"]) {
      expect(source(path)).toContain("reservation.payment?.payeeStaffId");
      expect(source(path)).toContain("refundDenialMessage(REFUND_DENIAL.NOT_PAYMENT_OWNER)");
    }
  });

  test("Mes opérations offers the refund and lists what she still owes", () => {
    const page = source("app/dashboard/mes-operations/page.jsx");
    expect(page).toContain("getMyOutstandingRefundLegs()");
    expect(page).toContain("<OutstandingRefunds legs={outstandingRefunds.data} independent />");
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain("refundableByOwner(row)");
    expect(client).toContain("<CancelAndRefundDialog");
    // Her Stripe is an Express account: a dashboard.stripe.com link is no use.
    expect(source("components/dashboard/operations/OutstandingRefunds.jsx")).toContain("await createLoginLink()");
  });
});
