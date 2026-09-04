import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  resolveAppointmentStatusAfterPayment,
} from "@/lib/appointment-status";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("accepted appointment lifecycle", () => {
  test("accepted appointments occupy capacity everywhere through the shared list", () => {
    expect(ACTIVE_APPOINTMENT_STATUSES).toEqual(["PENDING", "ACCEPTED", "CONFIRMED"]);
    const migration = source("prisma/migrations/20260817160000_include_accepted_in_appointment_overlap/migration.sql");
    expect(migration).toContain("'PENDING', 'ACCEPTED', 'CONFIRMED'");
    expect(source("lib/appointment-scheduling.js")).toContain("ACTIVE_APPOINTMENT_STATUSES");
    expect(source("actions/reservation/get-available-slots.js")).toContain("ACTIVE_APPOINTMENT_STATUSES");
  });

  test("the previously pending enum migration is idempotent and does not tighten unrelated nullable fields", () => {
    const migration = source("prisma/migrations/20260813081903_add_accepted_appointment_status/migration.sql");
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'ACCEPTED'");
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS");
    expect(migration).not.toContain("SET NOT NULL");
  });

  test("manual accepted payment confirms without regressing other manual states", () => {
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "ACCEPTED", confirmationMode: "MANUAL" })).toBe("CONFIRMED");
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "CONFIRMED", confirmationMode: "MANUAL" })).toBe("CONFIRMED");
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "COMPLETED", confirmationMode: "MANUAL" })).toBe("COMPLETED");
    expect(resolveAppointmentStatusAfterPayment({ currentStatus: "PENDING", confirmationMode: "AUTOMATIC" })).toBe("CONFIRMED");
  });

  test("staff acceptance cannot take over an automatic checkout already in flight", () => {
    const manage = source("actions/appointment/manage-appointment.js");
    expect(manage).toContain('where: { id: appointmentId, status: "PENDING", payment: null }');
    expect(manage).toContain('data: { status: "ACCEPTED" }');
  });

  test("payment choice is owner-scoped and server-derived", () => {
    const payment = source("lib/appointments/accepted-payment.js");
    expect(payment).toContain("userId: session.user.id");
    expect(payment).toContain("availableChoices(staff)");
    expect(payment).toContain("Number(appointment.staffService.price)");
    expect(payment).toContain('current.status !== "ACCEPTED"');
    expect(payment).toContain('stripeAccount: staff.stripeAccountId');
  });

  test("full Stripe settlement issues an invoice and attaches its PDF", () => {
    const webhook = source("app/api/webhooks/stripe/route.js");
    expect(webhook).toContain("resolveAppointmentStatusAfterPayment");
    expect(webhook).toContain('source: "APPOINTMENT"');
    expect(webhook).toContain("buildInvoiceCustomer(appointment.user)");
    expect(webhook).toContain("renderInvoicePdf(result.invoice)");
    expect(webhook).toContain("...(invoicePdf ? [{ filename: `facture-${result.invoice.number}.pdf`");
    expect(webhook).toContain("...(ticket.attachment ? [ticket.attachment] : [])");
    expect(webhook).toContain("...(emailAttachments.length ? { attachments: emailAttachments } : {})");
  });

  test("failed payments can be recovered from a successful Connect PaymentIntent", () => {
    const retry = source("actions/payment/resume-reservation-payment.js");
    const webhook = source("app/api/webhooks/stripe/route.js");

    expect(retry).toContain("payment_intent_data: { metadata }");
    expect(webhook).toContain('event.type === "payment_intent.succeeded"');
    expect(webhook).toContain("handlePaymentIntentSucceeded(event.data.object, event.account)");
    expect(webhook).toContain("stripe.checkout.sessions.list");
    expect(webhook).toContain("await processAppointmentCheckoutSession(session, connectedAccountId)");
    expect(webhook).toContain('status: nextPaymentStatus');
    expect(webhook).toContain('data: { status: nextAppointmentStatus }');
  });

  test("on-site choice records a balance that completion must explicitly collect", () => {
    const payment = source("lib/appointments/accepted-payment.js");
    const manage = source("actions/appointment/manage-appointment.js");
    expect(payment).toContain('choice === "ON_SITE"');
    expect(payment).toContain('paymentType,');
    expect(payment).toContain('data: { status: "CONFIRMED" }');
    expect(manage).toContain('(payment.status === "PENDING" && payment.paymentType === "ON_SITE")');
    expect(manage).toContain("paymentConfirmed !== true");
  });
});

describe("accepted appointment translations", () => {
  test.each(["en", "fr", "nl"])("%s has leaf strings for the payment UI", (locale) => {
    const messages = JSON.parse(source(`messages/${locale}.json`));
    expect(typeof messages.appointmentStatus.accepted).toBe("string");
    expect(typeof messages.acceptedAppointmentPayment.title).toBe("string");
    expect(typeof messages.myReservations.choosePayment).toBe("string");
  });
});
