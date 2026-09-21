import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A transfer may only be announced on a sale the salon actually banks
 * (2026-09-21).
 *
 * « Virement » closes the visit and collects nothing: the money is recorded
 * only when an admin accepts it from « Ventes en attente de paiement ». That
 * list is salon-only — listAwaitedTransfers filters `payeeStaffId: null` —
 * and the settle paths compute `awaitsTransfer` from `collectsAtTill`, which
 * is false for a non-operator AND for an independent's sale.
 *
 * Two things went wrong before these guards existed:
 *
 *   1. Phantom money. With `collectsAtTill` false, `awaitsTransfer` was false
 *      too, so TRANSFER fell through to the ordinary collection branch and
 *      wrote paidAmount = total. The client left without paying and the
 *      system recorded the sale as settled.
 *
 *   2. An unrecoverable transfer. createCounterReservation computed
 *      `awaitsTransfer` with no off-till gate at all, so an independent
 *      animator's formation could be written with BOTH awaitedTransferAmount
 *      and payeeStaffId — invisible to listAwaitedTransfers, so it could
 *      never be accepted.
 *
 * Only formations and appointments can belong to an independent:
 * resolvePayeeForWorkshopSession always returns the salon.
 *
 * Source checks, like the other counter contracts.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

describe("a transfer is refused on any sale the salon does not bank", () => {
  it("one message says why, so every path refuses it the same way", () => {
    const lib = source("lib/payments/awaited-transfer.js");
    expect(lib).toContain("export const AWAITED_TRANSFER_OFF_TILL_MESSAGE");
    expect(lib).toContain("indépendante");
  });

  it("every settle path refuses instead of falling through to the collection branch", () => {
    // The bug: `awaitsTransfer = collectsAtTill && isAwaitedTransfer(method)`
    // silently became false off-till, and the else-branch marked it paid.
    for (const [path, guard] of [
      [
        "actions/appointment/manage-appointment.js",
        "if (collectsMoney && !collectsAtTill && isAwaitedTransfer(method)) {",
      ],
      [
        "lib/reservations/settle-reservation.js",
        "if (hasBalanceDue && !collectsAtTill && isAwaitedTransfer(method)) {",
      ],
      [
        "actions/boutique/orders.js",
        "if (needsPayment && !collectsAtTill && isAwaitedTransfer(method)) {",
      ],
    ]) {
      const code = source(path);
      expect(code, path).toContain(guard);
      expect(code, path).toContain("AWAITED_TRANSFER_OFF_TILL_MESSAGE");
    }
  });

  it("a séance sold at the counter gates the transfer on offTill, twice", () => {
    const code = source("actions/counter/create-reservation.js");
    // Refused before the transaction…
    expect(code).toContain("if (isAwaitedTransfer(data.payment.method) && offTill) {");
    expect(code).toContain("AWAITED_TRANSFER_OFF_TILL_MESSAGE");
    // …and the flag itself can no longer be true off-till, so an
    // awaitedTransferAmount can never be written beside a payeeStaffId.
    expect(code).toContain("const awaitsTransfer = !offTill && isAwaitedTransfer(data.payment.method);");
  });

  it("the acceptance list stays salon-only, and the action refuses an independent's payment", () => {
    const action = source("actions/payments/awaited-transfer.js");
    expect(action).toContain("payeeStaffId: null");
    expect(action).toContain('throw new Error("AWAITED_TRANSFER_INDEPENDENT")');
  });

  it("the counter knows whose sale it is before offering the option", () => {
    // The flag has to come from the server: the screens only knew whether
    // the ACTOR was a till operator, never whose sale it was.
    const settlements = source("actions/boutique/settlements.js");
    expect(settlements).toContain("payeeStaffId: true");
    expect(settlements).toContain("independent: Boolean(appointment.payment?.payeeStaffId)");
    expect(settlements).toContain("independent: Boolean(reservation.payment?.payeeStaffId)");

    // The fiche itself is fed by the check-in lookup, not by the search row,
    // so the flag has to travel that path too — otherwise the option is
    // offered and only the server refuses it.
    const checkIn = source("actions/activities/check-in.js");
    expect(checkIn).toContain("payeeStaffId: true");
    expect(checkIn).toContain("independent: Boolean(reservation.payment?.payeeStaffId)");
    // An appointment can have no Payment row yet; the practitioner decides then.
    expect(checkIn).toContain('independent: appointment.payment\n      ? Boolean(appointment.payment.payeeStaffId)\n      : appointment.staff?.type === "INDEPENDENT"');

    // A formation's animator decides, resolved by the real resolver rather
    // than a copy of its rules.
    const search = source("actions/counter/search.js");
    expect(search).toContain('import { resolvePayeeForFormationSession } from "@/lib/payments/resolve-payee"');
    expect(search).toContain("independent: formationPayees.get(session.id) ?? false");
    // A workshop is always the salon's.
    expect(search).toContain("independent: false");
  });
});

describe("the client hears nothing until the transfer is accepted", () => {
  it("a séance booked by transfer sends no confirmation and no check-in QR", () => {
    const code = source("actions/counter/create-reservation.js");
    expect(code).toContain("const awaitsTransfer = result.awaitedTransferAmount != null;");
    // The confirmation carries the check-in QR: sending it would tell the
    // client the seat is confirmed before a cent arrived.
    expect(code).toContain("const emailResult = awaitsTransfer\n    ? null\n    : await sendEmail({");
    expect(code).toContain("Le client sera confirmé par e-mail à l'acceptation du virement.");
  });

  it("accepting the transfer is what sends it", () => {
    const action = source("actions/payments/awaited-transfer.js");
    expect(action).toContain('import { sendSettlementEmail } from "@/lib/payments/send-settlement-email"');
    // The ticket is a receipt for money, so it waits for the whole amount.
    expect(action).toContain("if (outcome.fullyPaid) {");
    expect(action).toContain("sendSettlementEmail(session.user, paymentId, { transactionId: outcome.transactionId })");
    // Which needs the Transaction the acceptance just wrote.
    expect(source("lib/payments/awaited-transfer.js")).toContain(
      "return { received, invoice, details, fullyPaid, transactionId: collection.id, reservation };"
    );
  });

  // 21/09/2026, found on a real booking: a formation booked by transfer with a
  // 50 € acompte on 100 €. Nothing was sent at booking (correct — nothing was
  // paid), and the acceptance only sent on FULL payment, so the seat was
  // confirmed, its check-in code minted, and the client never told.
  it("a séance confirmed by its acompte gets its confirmation and check-in QR", () => {
    const action = source("actions/payments/awaited-transfer.js");
    expect(action).toContain('import { sendReservationConfirmation } from "@/lib/reservations/send-reservation-confirmation"');
    // Sent on the seat being confirmed, NOT on fullyPaid.
    expect(action).toContain("if (outcome.reservation) {");
    expect(action).toContain("sendReservationConfirmation(outcome.reservation.kind, outcome.reservation.row,");

    const lib = source("lib/payments/awaited-transfer.js");
    // Both séance kinds, never an order or an appointment.
    expect(lib).toContain('? { kind: "WORKSHOP", row: payment.workshopReservation }');
    expect(lib).toContain('? { kind: "FORMATION", row: payment.formationReservation }');
    // And only when the client had nothing before — a BALANCE paid by
    // transfer must not re-send a confirmation they have held since booking.
    expect(lib).toContain("const wasUnpaidBefore = alreadyPaid <= 0.001;");
    expect(lib).toContain("const reservation = wasUnpaidBefore ? reservationRow : null;");

    // The sender reuses the same template and QR as the online path.
    const sender = source("lib/reservations/send-reservation-confirmation.js");
    expect(sender).toContain("ensureCheckInCode");
    expect(sender).toContain("qrPngAttachment");
    expect(sender).toContain("workshopReservationConfirmationEmail");
    expect(sender).toContain("formationReservationConfirmationEmail");
  });

  it("the settle paths still send nothing when nothing was collected", () => {
    // completeAppointment: no collection object for an awaited transfer.
    expect(source("actions/appointment/manage-appointment.js")).toContain("if (balance > 0 && result.collection) {");
    // settleReservation returns collection: null, so its wrappers mail nothing.
    expect(source("lib/reservations/settle-reservation.js")).toContain(
      "return { claimed: true, invoice: null, creditNote: null, balance, collection: null, awaited: true };"
    );
  });
});
