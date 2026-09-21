import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * « Carte QR » at « Pointage & encaissement » (2026-09-21).
 *
 * The retail till has always taken a QR payment; the counter's other screens
 * only offered Espèces and Terminal externe, so the same client at the same
 * counter could pay by QR for a lipstick but not for their formation balance.
 *
 * WHAT MAKES THIS SAFE
 *
 * Every other counter collection rests on an attestation: a human presses a
 * button saying « j'ai bien reçu X ». Nothing can observe a cash handover or
 * a terminal's APPROUVÉ screen, so that is the best evidence available there.
 * A QR payment has better evidence — Stripe knows — so the server asks
 * Stripe instead of trusting the operator, and refuses unless the session is
 * paid, belongs to THIS booking, and is for THIS exact amount.
 *
 * That last check is what makes the price adjustment safe: the QR is
 * generated for the amount due after « Prix final », and the settle call
 * carries the adjustment and the session id together, so a session created
 * for one price can never settle a booking at another.
 *
 * Source checks, like the other counter contracts.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const lib = source("lib/counter/qr-checkout.js");
const action = source("actions/counter/qr-checkout.js");

describe("the server verifies a QR payment rather than trusting the counter", () => {
  it("refuses a session that is not paid, not ours, for another booking or another amount", () => {
    expect(lib).toContain("export async function verifyCounterQrPayment");
    for (const guard of [
      'if (session.metadata?.kind !== "counter_qr") return { paid: false, reason: "COUNTER_QR_NOT_A_COUNTER_SESSION" }',
      'session.metadata?.surface !== surface || session.metadata?.targetId !== targetId',
      'if (session.payment_status !== "paid") return { paid: false, reason: "COUNTER_QR_NOT_PAID" }',
      "Math.abs(paidAmount - roundMoney(amount)) > 0.001",
    ]) {
      expect(lib).toContain(guard);
    }
    // Every refusal has a French message, so none surfaces as a raw code.
    for (const reason of [
      "COUNTER_QR_NOT_A_COUNTER_SESSION",
      "COUNTER_QR_WRONG_TARGET",
      "COUNTER_QR_NOT_PAID",
      "COUNTER_QR_AMOUNT_CHANGED",
    ]) {
      expect(lib, reason).toContain(`${reason}:`);
    }
  });

  it("the amount comes from Stripe, not from the caller", () => {
    expect(lib).toContain("const paidAmount = roundMoney((session.amount_total ?? 0) / 100)");
  });

  it("counter sessions never enter the webhook's booking dispatch", () => {
    // The webhook branches on metadata.kind; "counter_qr" is deliberately not
    // one of its cases, because the counter settles these itself.
    expect(lib).toContain('kind: "counter_qr"');
    const webhook = source("app/api/webhooks/stripe/route.js");
    expect(webhook).not.toContain('"counter_qr"');
  });
});

describe("every settle path accepts the QR only as verified money", () => {
  it("each one verifies before recording, and skips the tick-box attestation", () => {
    for (const [path, surface] of [
      ["actions/appointment/manage-appointment.js", "COUNTER_QR_SURFACES.APPOINTMENT"],
      ["actions/boutique/orders.js", "COUNTER_QR_SURFACES.ORDER"],
    ]) {
      const code = source(path);
      expect(code, path).toContain("await verifyCounterQrPayment(qrSessionId, {");
      expect(code, path).toContain(surface);
      expect(code, path).toContain("if (!qrPayment.paid) {");
    }
    // The reservation balance picks its surface from the activity kind.
    const settle = source("lib/reservations/settle-reservation.js");
    expect(settle).toContain('surface: kind === "WORKSHOP" ? COUNTER_QR_SURFACES.WORKSHOP : COUNTER_QR_SURFACES.FORMATION');
    // The QR replaces the attestation rather than being asked on top of it.
    expect(settle).toContain("if (collectsAtTill && !awaitsTransfer && !paidByQr && paymentConfirmed !== true)");
    expect(source("actions/appointment/manage-appointment.js")).toContain(
      "if (collectsAtTill && !awaitsTransfer && !paidByQr && paymentConfirmed !== true)"
    );
  });

  it("the QR is verified against the adjusted amount, never the original price", () => {
    const settle = source("lib/reservations/settle-reservation.js");
    expect(settle).toContain("amount: priceAdjustment.amountDue");
    expect(source("actions/appointment/manage-appointment.js")).toContain("amount: priceAdjustment.amountDue");
  });

  it("a QR charge records as ONLINE, outside the drawer, with its payment intent", () => {
    for (const path of [
      "lib/reservations/settle-reservation.js",
      "actions/appointment/manage-appointment.js",
      "actions/boutique/orders.js",
    ]) {
      const code = source(path);
      // Never CASH: a card charge on Stripe is not money in the till.
      expect(code, path).toContain('const isQr = !offTill && isCounterQr(method);');
      expect(code, path).toContain('isQr ? "ONLINE"');
      expect(code, path).toContain("isQr ? qrPayment.paymentIntentId : null");
      // useTill stays CASH-only, so no piece number and no cash session.
      expect(code, path).toContain('const useTill = !offTill && method === "CASH"');
    }
  });
});

describe("the counter offers the QR only where the salon banks the money", () => {
  it("an independent's sale never gets the option, client or server side", () => {
    expect(action).toContain("if (target.independent) return { success: false, message: COUNTER_QR_MESSAGES.COUNTER_QR_INDEPENDENT }");
    // The fiche withholds both the QR and the transfer for her sale.
    expect(source("components/dashboard/boutique/counter/FicheSettleAction.jsx")).toContain(
      `const settleMethods = ticket.independent
    ? ["CASH", "EXTERNAL_TERMINAL"]
    : ["CARD_QR", "CASH", "EXTERNAL_TERMINAL", "TRANSFER"]`
    );
  });

  it("only till operators can open or watch a QR", () => {
    expect(action).toContain("isTillCashOperator(session.user)");
    for (const fn of ["createCounterQrCheckout", "getCounterQrStatus", "cancelCounterQrCheckout"]) {
      expect(action, fn).toContain(`export async function ${fn}`);
    }
    // Polling is read-only: a status check must never move money.
    expect(action).toContain("Read-only: settling is");
  });

  it("a paid QR cannot be thrown away", () => {
    expect(action).toContain('if (session.payment_status === "paid") {');
    expect(action).toContain("Ce paiement a déjà été effectué");
  });
});

describe("the counter dialog settles only after Stripe confirms", () => {
  const dialog = source("components/dashboard/boutique/counter/CounterQrDialog.jsx");

  it("it polls, then hands the session id back to the caller's settle action", () => {
    expect(dialog).toContain("getCounterQrStatus(checkout.sessionId)");
    expect(dialog).toContain("onPaid(checkout.sessionId)");
    expect(dialog).toContain("setInterval(poll, 2500)");
  });

  it("the screens open it instead of settling, and pass the session id when it returns", () => {
    for (const [path, handler] of [
      ["components/dashboard/boutique/counter/FicheSettleAction.jsx", "handleSettle"],
      ["components/dashboard/boutique/counter/PickupFiche.jsx", "handleConfirm"],
    ]) {
      const code = source(path);
      expect(code, path).toContain("<CounterQrDialog");
      expect(code, path).toContain("setQrOpen(true);");
      expect(code, path).toContain(`onPaid={(qrSessionId) => ${handler}(qrSessionId)}`);
      expect(code, path).toContain("...(qrSessionId ? { qrSessionId } : {}),");
    }
  });
});
