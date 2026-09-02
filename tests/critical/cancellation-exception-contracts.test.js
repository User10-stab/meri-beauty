import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("late cancellation exception requests", () => {
  const schema = source("prisma/schema.prisma");
  const action = source("actions/reservation/cancellation-exception-request.js");
  const appointmentActions = source("actions/appointment/manage-appointment.js");
  const myReservations = source("actions/reservation/get-my-reservations.js");
  const customerUi = source("components/customer/MyReservationsClient.jsx");

  test("stores one current review request per appointment", () => {
    expect(schema).toContain("model AppointmentCancellationRequest");
    expect(schema).toContain("appointmentId String @unique");
    expect(schema).toContain("cancellationRequests AppointmentCancellationRequest[]");
    expect(schema).toContain("enum AppointmentCancellationRequestStatus");
  });

  test("customer submission is only a request, not a cancellation or refund", () => {
    const submitFn = action.slice(
      action.indexOf("export async function submitCancellationExceptionRequest"),
      action.indexOf("export async function getCancellationExceptionRequests")
    );

    expect(submitFn).toContain('session.user.role !== "CUSTOMER"');
    // requiresAdminApprovalToCancel covers both gates: the 48h window, and
    // (18 Aug 2026) a still-PENDING request that already took a pay-first
    // payment — see lib/reservationRules.js.
    expect(submitFn).toContain("requiresAdminApprovalToCancel(appointment, appointment.payment)");
    expect(submitFn).toContain("appointmentCancellationRequest.create");
    expect(submitFn).not.toContain("rejectAppointment(");
    expect(submitFn).not.toContain("stripe.refunds.create");
  });

  test("admin approval is the only exception-review path that waives deposit forfeiture", () => {
    expect(action).toContain("reviewCancellationExceptionRequest");
    expect(action).toContain('decision: z.enum(["APPROVED", "REJECTED"])');
    expect(action).toContain("waiveDepositForfeit: true");
    expect(appointmentActions).toContain("!waiveDepositForfeit");
  });

  test("submission and approval require a recorded refundable payment", () => {
    expect(action).toContain("function refundableRecordedAmount(payment)");
    expect(action).toContain("refundableRecordedAmount(appointment.payment) <= REFUND_EPSILON");
    expect(action).toContain("refundableRecordedAmount(request.appointment.payment) <= REFUND_EPSILON");
  });

  test("Stripe failure is returned and displayed as a refund that must be retried", () => {
    const adminUi = source("components/dashboard/appointments/CancellationExceptionRequestsClient.jsx");
    expect(action).toContain("result.refundFailed");
    expect(action).toContain("le remboursement Stripe a échoué");
    expect(adminUi).toContain("Acceptée · remboursement à relancer");
    expect(adminUi).toContain("toast.warning(result.message)");
  });

  test("customer reservations expose pending/rejected request state to the UI", () => {
    expect(myReservations).toContain("cancellationRequests");
    expect(myReservations).toContain("cancellationRequest:");
    expect(customerUi).toContain("hasPendingRequest");
    expect(customerUi).toContain("hasRejectedRequest");
    expect(customerUi).toContain("Envoyer une nouvelle demande");
  });

  test("a rejected request is reopened atomically and its previous decision is audited", () => {
    expect(action).toContain('where: { id: existingRequest.id, status: "REJECTED" }');
    expect(action).toContain('action: "appointment.cancellation_request.resubmitted"');
    expect(action).toContain("before: {");
    expect(action).toContain('status: "PENDING"');
  });
});
