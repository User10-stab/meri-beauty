import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServiceInvoiceLines } from "../../lib/invoicing.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const sum = (lines) =>
  Math.round(lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0) * 100) / 100;

/**
 * What an invoice says when the price moved at the counter.
 *
 * `buildServiceInvoiceLines` never charges the amount it prints on the first
 * line: it prints a *reconstructed* gross and then subtracts the promo code,
 * so the lines add up to what was actually taken. That works while the promo
 * is the only thing between catalogue price and total.
 *
 * The counter price adjustment broke that assumption. A booking with a promo
 * code whose price was then changed at the till printed a first line at a
 * figure nobody was ever quoted, a "Code promotionnel" line, and nothing at
 * all about the adjustment — the total and the VAT were right, but the
 * document explained them with an invented number. That is the same failure
 * as a screen describing a refund the app never sends, except it is a legal
 * document and it is filed.
 */
describe("an invoice explains the price it charges", () => {
  test("with no discount and no adjustment it is still one plain line", () => {
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 60 });
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(60);
  });

  test("a promo code keeps its own negative line", () => {
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 50, discountAmount: 10 });
    expect(lines).toHaveLength(2);
    expect(lines[0].unitPrice).toBe(60);
    expect(lines[1]).toMatchObject({ description: "Code promotionnel", unitPrice: -10 });
    expect(sum(lines), "the lines no longer add up to what was charged").toBe(50);
  });

  test("a counter adjustment is named rather than folded into the price", () => {
    // €60 catalogue, €5 off at the till. Without the adjustment line the first
    // line would read €55 — a price that was never quoted and that no promo
    // explains.
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 55,
      adjustmentAmount: -5,
      adjustmentReason: "geste commercial",
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].unitPrice, "the catalogue price was not restored").toBe(60);
    expect(lines[1]).toMatchObject({ description: "Ajustement — geste commercial", unitPrice: -5 });
    expect(sum(lines)).toBe(55);
  });

  test("promo and adjustment together — the case that was wrong", () => {
    // €60 catalogue, €10 promo (so €50 was quoted), then €5 off at the till.
    // Every line names something that really happened, and they sum to €45.
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 45,
      discountAmount: 10,
      adjustmentAmount: -5,
      adjustmentReason: "correction de tarif",
    });
    expect(lines).toHaveLength(3);
    expect(lines[0].unitPrice, "the catalogue price was not restored").toBe(60);
    expect(lines[1].unitPrice).toBe(-10);
    expect(lines[2].unitPrice).toBe(-5);
    expect(sum(lines), "the invoice does not add up to the amount collected").toBe(45);
  });

  test("an upward correction is signed the other way", () => {
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 70,
      adjustmentAmount: 10,
      adjustmentReason: "supplément longueur",
    });
    expect(lines[0].unitPrice).toBe(60);
    expect(lines[1].unitPrice).toBe(10);
    expect(sum(lines)).toBe(70);
  });

  test("an adjustment with no reason still gets a line", () => {
    // A nameless line is worse than none only if it hides money. This one
    // shows the money and admits the reason is missing.
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 55, adjustmentAmount: -5 });
    expect(lines[1]).toMatchObject({ description: "Ajustement au comptoir", unitPrice: -5 });
    expect(sum(lines)).toBe(55);
  });

  test("both settlement paths pass the adjustment through", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).toContain("adjustmentAmount: priceAdjustment.changed");
      expect(code, path).toContain("adjustmentReason: priceAdjustment.reason");
    }
  });
});

/**
 * A ticket is e-mailed to the client after settlement only when the acting
 * staff member holds SEND_TICKET_EMAIL — neither settlement path builds or
 * sends a ticket itself; both delegate to the same shared, permission-gated
 * sendTicketByEmail (actions/payments/send-ticket-email.js), which re-derives
 * auth() and checks the permission internally. lib/reservations/
 * settle-reservation.js stays a pure money module (deliberately not
 * "use server") — it only exposes paymentId/transactionId/balance for its
 * two wrappers to act on. The post-commit send is fire-and-forget, so it
 * cannot throw in a way that risks the settlement's own success response.
 */
describe("a ticket is e-mailed after settlement only when the acting staff holds SEND_TICKET_EMAIL", () => {
  test("neither settlement path inlines ticket-building — both delegate to the shared sender", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).not.toContain("consolidatedTicketFields(");
      expect(code, path).not.toContain("renderTicketPdf(");
      expect(code, path).not.toContain("[POST_COMMIT] settlement succeeded but the ticket step failed:");
    }
  });

  test("manage-appointment.js sends the ticket only when a balance was actually collected", () => {
    const code = source("actions/appointment/manage-appointment.js");
    expect(code).toContain('import { sendTicketByEmail } from "@/actions/payments/send-ticket-email"');
    expect(code).toContain("if (balance > 0) {");
    expect(code).toContain("sendTicketByEmail(result.collection.paymentId");
  });

  test("settle-reservation.js stays free of any send/permission code — it only exposes paymentId/transactionId/balance for its callers", () => {
    const lib = source("lib/reservations/settle-reservation.js");
    expect(lib).not.toContain("sendTicketByEmail");
    expect(lib).toContain("paymentId: payment.id");
    expect(lib).toContain("transactionId: result.collection?.id ?? null");
  });

  test("both reservation wrappers call sendTicketByEmail gated on a collected balance, and never leak the internal fields to the client", () => {
    for (const path of [
      "actions/workshops/manage-reservation.js",
      "actions/formations/manage-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).toContain('import { sendTicketByEmail } from "@/actions/payments/send-ticket-email"');
      expect(code, path).toContain("if (result.balance > 0) {");
      expect(code, path).toContain("const { paymentId, transactionId, balance, ...publicResult } = result;");
    }
  });

  test("the cash-book UI still refreshes after a CASH collection", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).toContain('method === "CASH") revalidateCaisseRoutes()');
    }
  });
});
