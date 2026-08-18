import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getReservationPaymentDecision, computePaymentDecision } from "../../lib/reservation-payment.js";
import { resolveAppointmentStatusAfterPayment } from "../../lib/appointment-status.js";
import { requiresAdminApprovalToCancel } from "../../lib/reservationRules.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 18 Aug 2026, salon decision: on a manually-confirmed booking the customer
// pays BEFORE staff decide, not after. Whichever the staff member is set up
// for — a deposit or the full amount — is taken up front; the request stays
// PENDING until accepted, and a decline refunds. Previously MANUAL returned
// paymentIntent NONE and created no Payment row at all, so a slot could be
// held without any money moving.
describe("a manual booking is paid before staff decide", () => {
  test("a deposit-taking staff member charges the deposit up front", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      depositEnabled: true,
      depositPercentage: 20,
      totalAmount: 80,
    });

    expect(d.requiresOnlinePaymentNow).toBe(true);
    expect(d.shouldCreatePaymentRecord).toBe(true);
    expect(d.paymentIntent).toBe("DEPOSIT_ONLINE");
    expect(d.paymentType).toBe("DEPOSIT");
    expect(d.depositAmount).toBe(16);
  });

  test("a staff member without a deposit charges the full amount up front", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      depositEnabled: false,
      totalAmount: 80,
    });

    expect(d.requiresOnlinePaymentNow).toBe(true);
    expect(d.paymentIntent).toBe("FULL_ONLINE");
    expect(d.paymentType).toBe("ONLINE");
    expect(d.totalAmount).toBe(80);
  });

  test("paying does not confirm the slot — staff acceptance does", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      depositEnabled: true,
      depositPercentage: 30,
      totalAmount: 100,
    });
    expect(d.appointmentStatusBeforePayment).toBe("PENDING");
    expect(d.appointmentStatusAfterPayment).toBe("PENDING");

    // And the webhook agrees: a paid MANUAL request stays PENDING.
    expect(
      resolveAppointmentStatusAfterPayment({ currentStatus: "PENDING", confirmationMode: "MANUAL" })
    ).toBe("PENDING");
    // Only once accepted does payment confirm it.
    expect(
      resolveAppointmentStatusAfterPayment({ currentStatus: "ACCEPTED", confirmationMode: "MANUAL" })
    ).toBe("CONFIRMED");
  });

  test("there is no pay-at-the-salon escape hatch", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      depositEnabled: true,
      depositPercentage: 20,
      totalAmount: 80,
    });
    expect(d.salonPaymentAvailable).toBe(false);

    // The payment step must honour that flag, not just the staff's
    // allowedPaymentMethods, or "cash" would still be offered.
    const step = source("components/reservation/steps/PaymentStep.jsx");
    expect(step).toMatch(/acceptsCashPayments\s*=\s*[\s\S]{0,120}salonPaymentAvailable/);
  });

  // CASH_ONLY staff take no online payment at all, so pay-first cannot apply
  // to them; computePaymentDecision returns before the manual branch.
  test("a cash-only staff member is unaffected, via the UI-facing wrapper", () => {
    const d = computePaymentDecision({
      drafts: [{ price: 80, staffService: { staff: { allowedPaymentMethods: "CASH_ONLY", reservationConfirmationMode: "MANUAL" } } }],
    });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.salonPaymentAvailable).toBe(true);
    expect(d.isManualMode).toBe(true);
  });

  // Regression: createReservation and createCheckoutSession call
  // getReservationPaymentDecision directly, bypassing computePaymentDecision's
  // own CASH_ONLY short-circuit entirely. An earlier version of the MANUAL
  // branch didn't check allowedPaymentMethods itself, so a cash-only staff
  // member's booking would have been forced into a Stripe charge the moment
  // it went through either of those two server actions instead of the form.
  test("a cash-only staff member is unaffected, via the direct server-action call path", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      allowedPaymentMethods: "CASH_ONLY",
      depositEnabled: true, // even if a deposit was mistakenly left configured
      depositPercentage: 20,
      totalAmount: 80,
    });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.shouldCreatePaymentRecord).toBe(false);
    expect(d.paymentType).toBe("ON_SITE");
    expect(d.salonPaymentAvailable).toBe(true);
  });

  // Multi-appointment drafts still have no pricing step at all.
  test("multi-appointment drafts still skip payment", () => {
    const d = getReservationPaymentDecision({ appointmentCount: 2, confirmationMode: "MANUAL", totalAmount: 200 });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.shouldCreatePaymentRecord).toBe(false);
  });
});

// Pay-first means money is already held on a PENDING request. Declining it is
// the salon's decision, so the deposit-forfeit rule — which exists to penalise
// a late *customer* cancellation — must not fire and pocket the deposit.
describe("declining a request the salon never accepted refunds in full", () => {
  test("the forfeit is skipped while the request is still PENDING", () => {
    const actions = source("actions/appointment/manage-appointment.js");
    expect(actions).toContain('const isDeclineOfUnacceptedRequest = appointment.status === "PENDING"');

    // It must gate the forfeit block itself, not merely exist.
    const forfeitIdx = actions.indexOf("let forfeitAmount = 0");
    const guardIdx = actions.indexOf("!isDeclineOfUnacceptedRequest", forfeitIdx);
    const closeIdx = actions.indexOf("const needsRefund =", forfeitIdx);
    expect(guardIdx).toBeGreaterThan(forfeitIdx);
    expect(guardIdx).toBeLessThan(closeIdx);
  });

  test("the default forfeit really would have taken everything", () => {
    // Guards the reason the above matters: at 100%, an unguarded decline
    // inside the 48h window refunds the customer nothing.
    expect(source("prisma/schema.prisma")).toMatch(
      /depositForfeitPercentage\s+Decimal\s+@default\(100\)/
    );
  });
});

// 18 Aug 2026, the other half of the same salon decision: pay-first only
// works if the customer can't undo it by cancelling their own still-PENDING
// request the moment after paying. Previously cancelReservation had no
// concept of "already paid but not yet accepted" — any appointment outside
// the 48h window refunded automatically on customer self-cancel, deposit or
// not, decided or not.
describe("a customer cannot self-refund a paid request the salon hasn't decided on yet", () => {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // far outside the 48h window

  test("a paid PENDING request requires admin approval to cancel, however far away it is", () => {
    expect(
      requiresAdminApprovalToCancel({ status: "PENDING", startTime: future }, { status: "PAID" })
    ).toBe(true);
    expect(
      requiresAdminApprovalToCancel({ status: "PENDING", startTime: future }, { status: "PARTIALLY_PAID" })
    ).toBe(true);
  });

  test("an unpaid PENDING request (e.g. CASH_ONLY staff) can still self-cancel freely", () => {
    expect(requiresAdminApprovalToCancel({ status: "PENDING", startTime: future }, null)).toBe(false);
    expect(
      requiresAdminApprovalToCancel({ status: "PENDING", startTime: future }, { status: "REFUNDED" })
    ).toBe(false);
  });

  test("a paid ACCEPTED/CONFIRMED appointment outside the window is unaffected — unchanged scope", () => {
    expect(
      requiresAdminApprovalToCancel({ status: "ACCEPTED", startTime: future }, { status: "PAID" })
    ).toBe(false);
    expect(
      requiresAdminApprovalToCancel({ status: "CONFIRMED", startTime: future }, { status: "PAID" })
    ).toBe(false);
  });

  test("the 48h window still blocks regardless of payment or status", () => {
    const soon = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    expect(requiresAdminApprovalToCancel({ status: "CONFIRMED", startTime: soon }, null)).toBe(true);
  });

  test("cancelReservation enforces the gate server-side, not just the UI", () => {
    const src = source("actions/reservation/cancel-reservation.js");
    expect(src).toContain("requiresAdminApprovalToCancel(appointment, payment)");
    // Must run before any refund is computed or pinned.
    const gateIdx = src.indexOf("requiresAdminApprovalToCancel(appointment, payment)");
    const refundIdx = src.indexOf("const needsRefund =");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(refundIdx);
  });

  test("the exception-request path accepts this case instead of turning it away", () => {
    const src = source("actions/reservation/cancellation-exception-request.js");
    expect(src).toContain("requiresAdminApprovalToCancel(appointment, appointment.payment)");
    expect(src).toContain("payment: { select: { status: true } }");
  });

  test("the UI locks the same way it does for the 48h window", () => {
    const src = source("components/customer/MyReservationsClient.jsx");
    expect(src).toContain("requiresAdminApprovalToCancel(reservation, reservation.payment)");
    // handleCancel must actually read the same `blocked` flag, or the
    // client-side guard and the button's visibility could disagree.
    expect(src).toMatch(/if \(loadingCancel \|\| blocked\) return;/);
  });
});
