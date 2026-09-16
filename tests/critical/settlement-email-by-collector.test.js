import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  sendTicketByEmail: vi.fn(),
  buildPaymentTicket: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/actions/payments/send-ticket-email", () => ({ sendTicketByEmail: mocks.sendTicketByEmail }));
vi.mock("@/lib/cash-book/build-payment-ticket", () => ({ buildPaymentTicket: mocks.buildPaymentTicket }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));

import { sendSettlementEmail } from "@/lib/payments/send-settlement-email";
import { paymentConfirmedEmail } from "@/lib/email-templates";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com", fullName: "Marie Mercier" };
const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const JULIE = { id: "u_julie", role: "STAFF", email: "julieschoemans@gmail.com", fullName: "Julie Schoemans" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendTicketByEmail.mockResolvedValue({ success: true });
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.buildPaymentTicket.mockResolvedValue({
    ticket: {
      ticketNumber: null,
      issuedAt: new Date("2026-09-16T10:00:00Z"),
      totalInclVat: 45,
      lines: [{ description: "Rendez-vous — Brushing", quantity: 1, unitPrice: 45 }],
    },
    customer: { fullName: "Cliente Test", email: "cliente@example.com" },
  });
});

/**
 * Since 16/09/2026 an independent's sale carries no salon ticket. The client
 * must still hear that the payment was recorded — just never by an e-mail
 * that promises or attaches a ticket.
 */
describe("the settlement e-mail depends on who collected", () => {
  it("the salon — Marie despite her STAFF role, and the admin — still sends the ticket", async () => {
    await sendSettlementEmail(MARIE, "pay_1", { transactionId: "tx_1" });
    await sendSettlementEmail(ADMIN, "pay_2");
    expect(mocks.sendTicketByEmail).toHaveBeenNthCalledWith(1, "pay_1", { transactionId: "tx_1" });
    expect(mocks.sendTicketByEmail).toHaveBeenNthCalledWith(2, "pay_2", { transactionId: null });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("an independent's client gets a plain payment confirmation, with no attachment", async () => {
    const result = await sendSettlementEmail(JULIE, "pay_3", { transactionId: "tx_3" });

    expect(result.success).toBe(true);
    expect(mocks.sendTicketByEmail).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    const mail = mocks.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe("cliente@example.com");
    expect(mail.attachments).toBeUndefined();
    expect(mail.subject).toBe("Confirmation de votre paiement – Meri Beauty");
    expect(mail.text).toContain("€45.00");
    expect(mail.text).toContain("Rendez-vous — Brushing");
    // Just the confirmation: no ticket, no "encaissé", no who-took-the-money.
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toMatch(/ticket|encaiss|indépendante|Julie/i);
    }
  });

  it("never throws into a settlement that already committed", async () => {
    mocks.buildPaymentTicket.mockRejectedValue(new Error("db down"));
    await expect(sendSettlementEmail(JULIE, "pay_4")).resolves.toMatchObject({ success: false });
  });
});

describe("paymentConfirmedEmail", () => {
  it("escapes what it interpolates", () => {
    const { html } = paymentConfirmedEmail({
      customerName: "<b>x</b>",
      description: "Commande n°12",
      amount: 10,
      paidAt: new Date("2026-09-16T10:00:00Z"),
    });
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("every settlement path routes through the collector-aware sender", () => {
  it("no settlement wrapper calls sendTicketByEmail directly any more", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "actions/workshops/manage-reservation.js",
      "actions/formations/manage-reservation.js",
    ]) {
      expect(source(path), path).not.toContain("sendTicketByEmail(");
    }
  });

});
