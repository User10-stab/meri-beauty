import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getReservationPaymentDecision, computePaymentDecision } from "../../lib/reservation-payment.js";
import { resolveAppointmentStatusAfterPayment } from "../../lib/appointment-status.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 18 Aug 2026, salon decision (reverting pay-first): on a manually-confirmed
// booking the customer is NOT charged before staff decide. The request is
// created PENDING with no Payment row and no payment step; the client is told
// the request is waiting for the salon. Only after staff accept (ACCEPTED +
// acceptance email with the confirmation link) does the customer complete the
// required action per allowedPaymentMethods and the appointment become
// CONFIRMED. A decline records REJECTED and sends the rejection email.
describe("a manual booking is created without any payment", () => {
  test("no payment step and no online charge up front", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      depositEnabled: true,
      depositPercentage: 20,
      totalAmount: 80,
    });

    expect(d.requiresPaymentStep).toBe(false);
    expect(d.isManualMode).toBe(true);
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.shouldCreatePaymentRecord).toBe(false);
    expect(d.paymentIntent).toBe("NONE");
    expect(d.paymentType).toBe("ON_SITE");
    expect(d.appointmentStatusBeforePayment).toBe("PENDING");
  });

  test("multi-appointment drafts still skip payment", () => {
    const d = getReservationPaymentDecision({ appointmentCount: 2, confirmationMode: "MANUAL", totalAmount: 200 });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.shouldCreatePaymentRecord).toBe(false);
  });
});

describe("CASH_ONLY staff keep the on-site option at booking time", () => {
  test("via the UI-facing wrapper", () => {
    const d = computePaymentDecision({
      drafts: [{ price: 80, staffService: { staff: { allowedPaymentMethods: "CASH_ONLY", reservationConfirmationMode: "MANUAL" } } }],
    });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.salonPaymentAvailable).toBe(true);
    expect(d.isManualMode).toBe(true);
  });

  // Regression: createReservation and createCheckoutSession call
  // getReservationPaymentDecision directly, bypassing computePaymentDecision's
  // own CASH_ONLY short-circuit entirely.
  test("via the direct server-action call path", () => {
    const d = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "MANUAL",
      allowedPaymentMethods: "CASH_ONLY",
      depositEnabled: true,
      depositPercentage: 20,
      totalAmount: 80,
    });
    expect(d.requiresOnlinePaymentNow).toBe(false);
    expect(d.shouldCreatePaymentRecord).toBe(false);
    expect(d.paymentType).toBe("ON_SITE");
    expect(d.salonPaymentAvailable).toBe(true);
  });
});

describe("a manual booking is only confirmed after staff acceptance and client action", () => {
  test("payment after acceptance confirms, before acceptance it does not", () => {
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "ACCEPTED", confirmationMode: "MANUAL" })).toBe("CONFIRMED");
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "PENDING", confirmationMode: "MANUAL" })).toBe("PENDING");
  });
});

describe("rejecting a manual request records REJECTED, not CANCELLED", () => {
  test("REJECTED exists as an appointment status, deployed via an idempotent migration", () => {
    expect(source("prisma/schema.prisma")).toMatch(/enum AppointmentStatus[\s\S]*REJECTED/);
    const migration = source("prisma/migrations/20260818090000_add_rejected_appointment_status/migration.sql");
    expect(migration).toContain("ALTER TYPE \"AppointmentStatus\" ADD VALUE IF NOT EXISTS 'REJECTED'");
  });

  test("the server derives a manual rejection from PENDING + MANUAL staff mode", () => {
    const manage = source("actions/appointment/manage-appointment.js");
    expect(manage).toContain("reservationConfirmationMode");
    expect(manage).toMatch(/status:\s*isManualRejection\s*\?\s*"REJECTED"\s*:\s*"CANCELLED"/);
    expect(manage).toContain("reservationRejectedEmail");
  });

  test("the confirmation page shows the refusal instead of a stale form", () => {
    const page = source("components/appointment/ConfirmAcceptedAppointmentClient.jsx");
    expect(page).toContain('appointment.status === "REJECTED"');
    expect(page).toContain('appointment.status === "CONFIRMED"');
  });
});

describe("an accepted request surfaces a payment-choice link in the customer list", () => {
  test("awaitingPaymentChoice is derived server-side", () => {
    const src = source("actions/reservation/get-my-reservations.js");
    expect(src).toContain("isAwaitingPaymentChoice");
    expect(src).toMatch(/awaitingPaymentChoice:/);
  });
});

describe("manual booking translations", () => {
  test.each(["en", "fr", "nl"])("%s has a rejected appointment status label", (locale) => {
    const messages = JSON.parse(source(`messages/${locale}.json`));
    expect(typeof messages.appointmentStatus.rejected).toBe("string");
  });
});

describe("staff are emailed the moment a pending request is created", () => {
  test("createReservation sends the staff request email for non-CONFIRMED appointments", () => {
    const src = source("actions/reservation/create-reservation.js");
    expect(src).toContain("staffReservationRequestedEmail");
    expect(src).toContain("else {");
  });

  test("the template exists", () => {
    const templates = source("lib/email-templates.js");
    expect(templates).toContain("export function staffReservationRequestedEmail");
  });
});

describe("the acceptance email link is a dedicated appointment-confirmation token", () => {
  test("acceptAppointment mints a scoped token and keeps the customer out of the URL", () => {
    const manage = source("actions/appointment/manage-appointment.js");
    expect(manage).toMatch(/createAppointmentConfirmToken\(\{/);
    expect(manage).toContain("?confirm=");
    expect(manage).not.toContain("&email=");
    expect(manage).not.toContain("?email=");
  });

  test("the token is its own lib bound to the appointment, not a login token", () => {
    const lib = source("lib/appointment-confirm-token.js");
    expect(lib).toContain("export function createAppointmentConfirmToken");
    expect(lib).toContain("export function verifyAppointmentConfirmToken");
    expect(lib).toMatch(/appointmentId !== appointmentId/);
    expect(lib).toMatch(/NOT a login\/session token/);
  });

  test("the payment page authorizes the appointment via the token, with no user in the URL", () => {
    const page = source("app/(public)/appointment/[id]/payment/page.jsx");
    expect(page).toContain("verifyAppointmentConfirmToken");
    expect(page).toContain("tokenAuthorized");
    expect(page).toContain("confirmToken");
  });

  test("the client submits the token to the confirmation action, without signing the user in", () => {
    const client = source("components/appointment/ConfirmAcceptedAppointmentClient.jsx");
    expect(client).not.toContain("next-auth/react");
    expect(client).toContain("confirmAcceptedAppointment(appointment.id, method, confirmToken)");
  });

  test("the confirmation action authorizes via the token or the owner session", () => {
    const action = source("actions/appointment/confirm-accepted-appointment.js");
    expect(action).toContain("verifyAppointmentConfirmToken");
    expect(action).toContain("confirmToken = null");
    expect(action).toContain("tokenAuthorized");
  });
});