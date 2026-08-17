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
  const customerUi = source("components/website/MyAppointmentsPageClient.jsx");

  test("stores exactly one review request per appointment", () => {
    expect(schema).toContain("model AppointmentCancellationRequest");
    expect(schema).toContain("appointmentId String @unique");
    expect(schema).toContain("enum AppointmentCancellationRequestStatus");
  });

  test("customer submission is only a request, not a cancellation or refund", () => {
    const submitFn = action.slice(
      action.indexOf("export async function submitCancellationExceptionRequest"),
      action.indexOf("export async function getCancellationExceptionRequests")
    );

    expect(submitFn).toContain('session.user.role !== "CUSTOMER"');
    expect(submitFn).toContain("isWithinCancellationWindow(appointment.startTime)");
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

  test("customer reservations expose pending/rejected request state to the UI", () => {
    expect(myReservations).toContain("cancellationRequests");
    expect(myReservations).toContain("cancellationRequest:");
    expect(customerUi).toContain("hasPendingRequest");
    expect(customerUi).toContain("hasRejectedRequest");
  });
});
