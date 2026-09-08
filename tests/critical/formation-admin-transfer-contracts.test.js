import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("free admin formation transfers", () => {
  test("the transfer exists, never creates a Stripe charge, and reuses the shared transfer audit action", () => {
    const management = source("actions/formations/manage-reservation.js");
    const transfer = management.slice(
      management.indexOf("export async function changeFormationReservationSession"),
      management.indexOf("export async function completeFormationReservation")
    );

    expect(transfer).toContain("prisma.$transaction");
    expect(transfer).toContain("modificationFee: 0");
    expect(transfer).not.toContain("stripe.checkout.sessions.create");
    // Reused, not duplicated: one audit action for both entity types (see
    // hydrateTransfers splitting on entityType, not on a second constant).
    expect(transfer).toContain("AUDIT_ACTIONS.RESERVATION_SESSION_TRANSFERRED");
    expect(transfer).toContain('entityType: "FormationReservation"');
  });

  test("capacity, status, attendance and financial history are rechecked under locks", () => {
    const management = source("actions/formations/manage-reservation.js");
    expect(management).toContain("SELECT id FROM formation_reservations WHERE id = ${reservationId} FOR UPDATE");
    expect(management).toContain("SELECT id FROM formation_sessions WHERE id = ${id} FOR UPDATE");
    expect(management).toContain('reservation.status !== "CONFIRMED"');
    expect(management).toContain("reservation.checkedInSeats > 0");
    expect(management).toContain("TARGET_SESSION_FULL");
    expect(management).toContain("payment.refundOperations.length > 0");
    expect(management).toContain("LEGAL_DOCUMENT_EXISTS");
  });

  test("higher, lower and equal prices have explicit safe outcomes", () => {
    const management = source("actions/formations/manage-reservation.js");
    expect(management).toContain('APPLY_TARGET_PRICE: "APPLY_TARGET_PRICE"');
    expect(management).toContain('KEEP_CURRENT_PRICE: "KEEP_CURRENT_PRICE"');
    expect(management).toContain("OVERPAYMENT_REQUIRES_MANUAL_HANDLING");
    expect(management).toContain("remainingAmount: newBalanceDue");
  });

  test("an already-invoiced booking is superseded, not blocked, unless already credited", () => {
    const management = source("actions/formations/manage-reservation.js");
    const transfer = management.slice(
      management.indexOf("export async function changeFormationReservationSession"),
      management.indexOf("export async function completeFormationReservation")
    );

    expect(transfer).toContain('if (payment.invoice?.creditNotes?.length) throw new Error("LEGAL_DOCUMENT_EXISTS");');
    expect(transfer).not.toContain('if (payment.invoice || payment.invoice?.creditNotes?.length)');
    expect(transfer).toContain("supersedeInvoice(tx");
    expect(transfer).toContain("invoiceReplacement");
    expect(transfer).toContain("supersedesInvoiceId: payment.invoice.id");
    expect(transfer).toContain("if (newBalanceDue <= 0.01)");
    expect(transfer).toContain("customer: { include: { billingProfile: true } }");
    expect(transfer).toContain('source: "FORMATION"');
    expect(transfer).toContain("{ timeout: 15_000 }");
  });

  test("no previousSessionId is written — the field doesn't exist on FormationReservation", () => {
    const management = source("actions/formations/manage-reservation.js");
    const transfer = management.slice(
      management.indexOf("export async function changeFormationReservationSession"),
      management.indexOf("export async function completeFormationReservation")
    );
    expect(transfer).not.toContain("previousSessionId");
  });

  test("the modal shows prices, requires a reason, labels the transfer as free, and has no seat-change tab", () => {
    const modal = source("components/dashboard/formations/ChangeSessionModal.jsx");
    expect(modal).toContain("getFormationTransferOptions");
    expect(modal).toContain("changeFormationReservationSession");
    expect(modal).toContain('if (!reason.trim())');
    expect(modal).toContain('t("freeAdminTransfer")');
    expect(modal).toContain('t("existingInvoiceNote"');
    expect(modal).toContain('t("priceDecisionLabel")');
    expect(modal).toContain('t("overpaymentBlocked")');
    expect(modal).not.toContain("changeReservationSeats");
    expect(modal).not.toContain('t("changeSeats")');
  });

  test("the reservation row and page wire the transfer modal in", () => {
    const row = source("components/dashboard/formations/ReservationRow.jsx");
    const page = source("components/dashboard/formations/ReservationsPageClient.jsx");
    expect(row).toContain("onEdit");
    expect(page).toContain("ChangeSessionModal");
    expect(page).toContain("setChangeModalReservation");
  });

  test("operations exposes formation transfers through the same generalized transfer arm", () => {
    const operations = source("actions/dashboard/admin-operations.js");
    expect(operations).toContain("includeFormationTransfers");
    expect(operations).toContain('JOIN "formation_reservations" fr ON fr.id = al."entityId"');
    expect(operations).toContain("AND al.\"entityType\" = 'FormationReservation'");
    expect(operations).toContain('idsFor("FormationReservation")');
  });

  test("all supported locales contain the new formation transfer copy", () => {
    for (const locale of ["fr", "en", "nl"]) {
      const messages = JSON.parse(source(`messages/${locale}.json`));
      const modal = messages.dashboardFormations.changeSessionModal;
      for (const key of [
        "freeAdminTransfer",
        "existingInvoiceNote",
        "currentTotal",
        "targetTotal",
        "priceDecisionLabel",
        "reasonLabel",
        "confirmTransfer",
        "overpaymentBlocked",
      ]) {
        expect(modal[key]).toEqual(expect.any(String));
        expect(modal[key]).not.toBe("");
      }
    }
  });
});
