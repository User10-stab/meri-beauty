import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("free admin workshop/event transfers", () => {
  test("the direct transfer never creates a Stripe charge and remains separate from seat changes", () => {
    const management = source("actions/workshops/manage-reservation.js");
    const transfer = management.slice(
      management.indexOf("export async function changeReservationSession"),
      management.indexOf("export async function changeReservationSeats")
    );

    expect(transfer).toContain("prisma.$transaction");
    expect(transfer).toContain("modificationFee: 0");
    expect(transfer).not.toContain("stripe.checkout.sessions.create");
    expect(transfer).not.toContain("SESSION_CHANGE_FEE_RATE");
    expect(management.slice(management.indexOf("export async function changeReservationSeats"))).toContain(
      "SESSION_CHANGE_FEE_RATE"
    );
  });

  test("capacity, status, attendance and financial history are rechecked under locks", () => {
    const management = source("actions/workshops/manage-reservation.js");
    expect(management).toContain("SELECT id FROM workshop_reservations WHERE id = ${reservationId} FOR UPDATE");
    expect(management).toContain("SELECT id FROM workshop_sessions WHERE id = ${id} FOR UPDATE");
    expect(management).toContain('reservation.status !== "CONFIRMED"');
    expect(management).toContain("reservation.checkedInSeats > 0");
    expect(management).toContain("TARGET_SESSION_FULL");
    expect(management).toContain("payment.refundOperations.length > 0");
    expect(management).toContain("LEGAL_DOCUMENT_EXISTS");
  });

  test("an already-invoiced booking is superseded, not blocked, unless already credited", () => {
    const management = source("actions/workshops/manage-reservation.js");
    const transfer = management.slice(
      management.indexOf("export async function changeReservationSession"),
      management.indexOf("export async function changeReservationSeats")
    );

    // Only a credit note against the CURRENT invoice still blocks — a fresh,
    // never-corrected invoice is superseded as part of the transfer instead
    // of unconditionally blocking it (the old `payment.invoice ||` guard).
    expect(transfer).toContain('if (payment.invoice?.creditNotes?.length) throw new Error("LEGAL_DOCUMENT_EXISTS");');
    expect(transfer).not.toContain('if (payment.invoice || payment.invoice?.creditNotes?.length)');
    expect(transfer).toContain("supersedeInvoice(tx");
    expect(transfer).toContain("invoiceReplacement");
    expect(transfer).toContain("supersedesInvoiceId: payment.invoice.id");
    // A replacement invoice is only ever issued once the new total is still
    // fully covered by what's already paid — otherwise settleReservation
    // issues it later, exactly like any not-yet-fully-settled booking.
    expect(transfer).toContain("if (newBalanceDue <= 0.01)");
    // Regression guard: buildInvoiceCustomer needs billingProfile to print a
    // B2B replacement invoice's company name/BCE number — a bare
    // `customer: true` would silently drop them.
    expect(transfer).toContain("customer: { include: { billingProfile: true } }");
    // Regression guard: superseding an invoiced reservation issues a credit
    // note and (often) a replacement invoice inside this same transaction —
    // each allocates a gapless number under its own query on top of the row
    // locks and capacity checks already here, which blew past Prisma's 5s
    // default against a real remote connection in e2e testing.
    expect(transfer).toContain("{ timeout: 15_000 }");
  });

  test("higher, lower and equal prices have explicit safe outcomes", () => {
    const management = source("actions/workshops/manage-reservation.js");
    expect(management).toContain('APPLY_TARGET_PRICE: "APPLY_TARGET_PRICE"');
    expect(management).toContain('KEEP_CURRENT_PRICE: "KEEP_CURRENT_PRICE"');
    expect(management).toContain("OVERPAYMENT_REQUIRES_MANUAL_HANDLING");
    expect(management).toContain("remainingAmount: newBalanceDue");
    expect(management).toContain("RESERVATION_SESSION_TRANSFERRED");
  });

  test("the modal shows prices, requires a reason and labels the transfer as free", () => {
    const modal = source("components/dashboard/workshops/ChangeSessionModal.jsx");
    expect(modal).toContain("getWorkshopTransferOptions");
    expect(modal).toContain('if (!reason.trim())');
    expect(modal).toContain('t("freeAdminTransfer")');
    expect(modal).toContain('t("priceDecisionLabel")');
    expect(modal).toContain('t("overpaymentBlocked")');
  });

  test("operations exposes the transfer as a neutral, non-financial event", () => {
    const operations = source("actions/dashboard/admin-operations.js");
    const table = source("components/dashboard/operations/AdminOperationsClient.jsx");

    expect(operations).toContain("RESERVATION_SESSION_TRANSFERRED");
    expect(operations).toContain("'TRANSFER' AS \"sourceType\"");
    expect(operations).toContain("hydrateTransfers");
    expect(table).toContain('row.sourceType === "TRANSFER"');
    expect(table).toContain('kind: "Transfert de réservation"');
    expect(table).toContain('amountNote: "Aucun mouvement financier"');
    expect(table).toContain("Voir le détail");
    expect(table).toContain("Aucun encaissement ni remboursement n’a été déclenché");
    expect(table).toContain("row.operationOnly");
    expect(table).toContain('row.sourceType === "APPOINTMENT"');
    expect(table).toContain('title: "Actualisation requise"');
    expect(table).toContain('customerFallback: "Client non chargé"');
  });

  test("a stale legacy fee link cannot overwrite a newer direct transfer", () => {
    const webhook = source("app/api/webhooks/stripe/route.js");
    expect(webhook).toContain('action: "reservation.session_transferred"');
    expect(webhook).toContain('reason: "stale session change link"');
  });

  test("all supported locales contain the new transfer copy", () => {
    for (const locale of ["fr", "en", "nl"]) {
      const messages = JSON.parse(source(`messages/${locale}.json`));
      const modal = messages.dashboardWorkshops.changeSessionModal;
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
