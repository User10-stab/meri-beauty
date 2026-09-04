import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Ateliers and formations had no second half: a customer paid the 50%
// deposit online, attended, owed the balance in-salon — and nothing could
// record it. No Transaction row, no final invoice (a TVA problem, since
// every taxable service needs one), Payment stuck at PARTIALLY_PAID
// forever, and no way to mark an absence. Appointments already had
// completeAppointment + markAppointmentNoShow; this brings both other flows
// to parity through one shared helper.
describe("reservation settlement — collecting the on-site balance", () => {
  const lib = source("lib/reservations/settle-reservation.js");

  test("is not a Server Action — it records money, so it stays out of any \"use server\" module", () => {
    // Matches an actual directive (a line that is only the string), not the
    // phrase appearing inside this file's own explanatory doc comment.
    expect(lib).not.toMatch(/^\s*["']use server["'];?\s*$/m);
  });

  test("covers both flows with the right invoice source", () => {
    expect(lib).toContain('invoiceSource: "WORKSHOP"');
    expect(lib).toContain('invoiceSource: "FORMATION"');
  });

  test("refuses to settle a balance without an explicit staff attestation of receipt", () => {
    expect(lib).toContain("paymentConfirmed !== true");
    expect(lib).toContain("requiresPaymentConfirmation: true");
  });

  test("requires a payment method only when a balance is actually due", () => {
    expect(lib).toContain('!["CASH", "CARD", "EXTERNAL_TERMINAL"].includes(method)');
    expect(lib).toContain('payment.status === "PARTIALLY_PAID" && Number(payment.remainingAmount) > 0');
  });

  test("external terminal settlement requires approval and stores the terminal reference", () => {
    expect(lib).toContain('method === "EXTERNAL_TERMINAL"');
    expect(lib).toContain("terminalApproved !== true");
    expect(lib).toContain("manualReference: method === \"EXTERNAL_TERMINAL\" ? terminalReference.trim() : null");
    expect(lib).toContain('method: method === "CASH" ? "CASH" : "CARD"');
  });

  test("claims the reservation atomically before invoicing, so a double-click can't invoice twice", () => {
    const claimIdx = lib.indexOf('where: { id: reservationId, status: "CONFIRMED" }');
    const invoiceIdx = lib.indexOf("issueInvoice(tx");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(invoiceIdx).toBeGreaterThan(claimIdx);
  });

  test("only a CONFIRMED reservation can be settled", () => {
    expect(lib).toContain('reservation.status !== "CONFIRMED"');
  });

  test("attaches a cash balance to the open till session so it reconciles at close", () => {
    expect(lib).toContain('method === "CASH"');
    expect(lib).toContain("cashSession.findFirst({ where: { closedAt: null }");
    expect(lib).toContain("cashSessionId: openCashSession?.id ?? null");
  });

  test("issues the final invoice for the FULL amount, not just the collected balance", () => {
    // The deposit was deliberately not invoiced at payment time, so the one
    // invoice at settlement has to cover the whole service.
    expect(lib).toContain("totalInclVat: Number(updatedPayment.totalAmount)");
  });
});

// A no-show is exactly the case where the deposit is kept — H14: that kept
// deposit is real, non-refundable revenue and Belgian law requires an
// invoice for it, same as settleReservation's own final-balance invoice.
// Still never refunds and never calls Stripe — only the invoicing gap is
// closed.
describe("reservation no-show never refunds, but does invoice the kept deposit", () => {
  const lib = source("lib/reservations/settle-reservation.js");
  const noShowFn = lib.slice(lib.indexOf("export async function markReservationNoShow"), lib.length);

  test("transitions CONFIRMED -> NO_SHOW and never touches Stripe or issues a credit note", () => {
    expect(noShowFn).toContain('data: { status: "NO_SHOW" }');
    expect(noShowFn).not.toContain("stripe");
    expect(noShowFn).not.toContain("issueCreditNote");
  });

  test("invoices the forfeited deposit and marks the Payment PAID", () => {
    expect(noShowFn).toContain("issueInvoice(tx");
    expect(noShowFn).toContain('tx.payment.update({ where: { id: payment.id }, data: { status: "PAID" } })');
  });

  test("invoices the forfeited deposit only inside the claiming transaction, after the claim succeeds", () => {
    const claimIdx = noShowFn.indexOf('data: { status: "NO_SHOW" }');
    const invoiceIdx = noShowFn.indexOf("issueInvoice(tx");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(invoiceIdx).toBeGreaterThan(claimIdx);
  });

  test("skips invoicing when there's nothing paid or an invoice already exists", () => {
    expect(noShowFn).toContain("Number(payment.paidAmount) > 0.01 && !payment.invoice");
  });
});

describe("both flows expose auth-gated wrappers with scoped staff capabilities", () => {
  const workshop = source("actions/workshops/manage-reservation.js");
  const formation = source("actions/formations/manage-reservation.js");

  test("workshop wrappers exist and require a server-side activity-operation guard", () => {
    expect(workshop).toContain("export async function completeWorkshopReservation");
    expect(workshop).toContain("export async function markWorkshopReservationNoShow");
    const settleFn = workshop.slice(workshop.indexOf("export async function completeWorkshopReservation"));
    expect(settleFn).toContain("authorizeActivityReservationOperation");
    expect(settleFn).toContain("STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS");
    expect(settleFn).toContain("STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE");
  });

  test("formation wrappers exist and require a server-side activity-operation guard", () => {
    expect(formation).toContain("export async function completeFormationReservation");
    expect(formation).toContain("export async function markFormationReservationNoShow");
    const settleFn = formation.slice(formation.indexOf("export async function completeFormationReservation"));
    expect(settleFn).toContain("authorizeActivityReservationOperation");
    expect(settleFn).toContain("STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS");
    expect(settleFn).toContain("STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE");
  });
});

describe("dashboard exposes settle/no-show on both reservation tables", () => {
  test("DataTable forwards the new handlers to a custom row renderer", () => {
    const table = source("components/dashboard/Tables/DataTable.jsx");
    expect(table).toContain("onSettle={onSettle}");
    expect(table).toContain("onNoShow={onNoShow}");
  });

  test("both rows only offer granted actions on a CONFIRMED booking", () => {
    for (const path of [
      "components/dashboard/workshops/ReservationRow.jsx",
      "components/dashboard/formations/ReservationRow.jsx",
    ]) {
      const row = source(path);
      expect(row).toContain('row.status === "CONFIRMED" && row.canSettle && onSettle');
      expect(row).toContain('row.status === "CONFIRMED" && row.canMarkNoShow && onNoShow');
    }
  });

  test("the settle dialog disables its confirm button until receipt is attested", () => {
    const dialog = source("components/dashboard/reservations/SettleReservationDialog.jsx");
    expect(dialog).toContain("confirmDisabled={hasBalance && !confirmed}");
  });
});

// Directly undermined the admin deactivate/delete feature: a "removed"
// admin kept receiving every booking and cancellation e-mail, because the
// recipient lookups filtered on role only. The Staff lookups in the same
// file already filtered correctly.
describe("notification recipients exclude deactivated and deleted admins", () => {
  const notifications = source("lib/notifications.js");

  test("no admin recipient query filters on role alone", () => {
    expect(notifications).not.toMatch(/where:\s*\{\s*role:\s*\{\s*in:\s*\["OWNER",\s*"ADMIN"\]\s*\}\s*\}/);
  });

  test("all three recipient lookups require an active, non-deleted account", () => {
    const matches = notifications.match(
      /role: \{ in: \["OWNER", "ADMIN"\] \}, isActive: true, isDeleted: false/g
    );
    expect(matches).toHaveLength(3);
  });
});
