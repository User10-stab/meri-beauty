import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculateOfflineFormationPayment } from "../../lib/formations/offline-payment.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("offline formation enrollment", () => {
  test("a received deposit leaves only the remainder due, while full payment settles everything", () => {
    expect(calculateOfflineFormationPayment(240, 25, "DEPOSIT")).toEqual({
      totalAmount: 240,
      paidAmount: 60,
      balanceDue: 180,
      isFullPayment: false,
    });
    expect(calculateOfflineFormationPayment(240, 25, "FULL")).toEqual({
      totalAmount: 240,
      paidAmount: 240,
      balanceDue: 0,
      isFullPayment: true,
    });
  });

  test("the schema allows a student without login details and marks the reservation as offline", () => {
    const schema = source("prisma/schema.prisma");
    const user = schema.slice(schema.indexOf("model User {"));
    const reservation = schema.slice(schema.indexOf("model FormationReservation {"), schema.indexOf("// SALON"));
    expect(user).toMatch(/email\s+String\?/);
    expect(user).toMatch(/password\s+String\?/);
    expect(reservation).toContain("offlineEnrollment Boolean");
  });

  test("enrollment records a received transfer and sends e-mail only when provided", () => {
    const action = source("actions/formations/create-offline-reservation.js");
    expect(action).toContain('method: "TRANSFER"');
    expect(action).toContain('status: isFullPayment ? "PAID" : "PARTIALLY_PAID"');
    expect(action).toContain("if (result.customerEmail)");
    expect(action).not.toContain("createCheckoutSession");
    expect(action).not.toContain("awaitedTransferAmount");
  });

  test("both entry points open the popup — there is no separate enrolment page", () => {
    const row = source("components/dashboard/formations/FormationRow.jsx");
    expect(row).toContain("onEnrol(row)");
    expect(row).not.toContain("/dashboard/formations/inscription");
    expect(source("components/dashboard/formations/FormationsPageClient.jsx")).toContain("OfflineFormationEnrollmentForm");
    const reservations = source("app/dashboard/formations/reservations/page.jsx");
    expect(reservations).toContain("OfflineEnrollmentButton");
    expect(reservations).not.toContain("/dashboard/formations/inscription");
    expect(existsSync(`${root}app/dashboard/formations/inscription`)).toBe(false);
    expect(source("components/dashboard/formations/OfflineFormationEnrollmentForm.jsx")).toContain("fixed inset-0");
  });

  test("later bank transfers are recorded as received", () => {
    expect(source("lib/reservations/settle-reservation.js")).toContain('manualTransferReceived ? "TRANSFER"');
    expect(source("components/dashboard/reservations/SettleReservationDialog.jsx")).toContain('"TRANSFER_RECEIVED"');
  });

  test("a private formation can be enrolled on a date libre, refused for independent trainers", () => {
    const action = source("actions/formations/create-offline-reservation.js");
    expect(action).toContain("resolveCustomDateRequest");
    expect(action).toContain("customerRequested: true");
    expect(action).toContain("customSessionConflict");
    expect(action).toContain("CUSTOM_DATE_TAKEN");
    expect(action).toContain("staffFormationScope");
    expect(action).toContain("INDEPENDENT_FORMATION");
    expect(action).toContain("if (!result.customDate)");

    const options = source("actions/formations/get-offline-enrolment-options.js");
    expect(options).toContain("formationOffersCustomDates");
    expect(options).toContain("payee.payeeStaffId");
    expect(options).toContain("canUseSalonTill");
    expect(options).toContain("FORMATION_RESERVATIONS");

    const form = source("components/dashboard/formations/OfflineFormationEnrollmentForm.jsx");
    expect(form).toContain("Date libre");
    expect(form).toContain("CustomDatePicker");
    expect(form).toContain("getCounterCustomDateMonth");
    expect(form).toContain("customDate: { formationId: formation.id, ...customDate }");
  });
});
