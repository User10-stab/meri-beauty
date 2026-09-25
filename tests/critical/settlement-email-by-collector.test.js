import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  emailPaymentTicket: vi.fn(),
  staffFindFirst: vi.fn(),
  buildPaymentTicket: vi.fn(),
  sendEmail: vi.fn(),
  paymentFindUnique: vi.fn(),
}));

vi.mock("@/lib/tickets/email-payment-ticket", () => ({ emailPaymentTicket: mocks.emailPaymentTicket }));
vi.mock("@/lib/cash-book/build-payment-ticket", () => ({ buildPaymentTicket: mocks.buildPaymentTicket }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
// sendSettlementEmail reads Payment.payeeStaffId to decide whose sale it is.
// Mocked deliberately rather than left to reach a real database: unmocked, it
// answered `null` against a developer's DB — so "the salon's sale" was never
// actually asserted, it was just what a missing row happened to look like —
// and in CI, whose DATABASE_URL is a placeholder, the connection error was
// swallowed by the function's own catch and no e-mail was sent at all.
// staff.findFirst answers canUseSalonTill's CAISSE permission lookup.
vi.mock("@/lib/prisma", () => ({
  prisma: { payment: { findUnique: mocks.paymentFindUnique }, staff: { findFirst: mocks.staffFindFirst } },
}));

import { sendSettlementEmail } from "@/lib/payments/send-settlement-email";
import { paymentConfirmedEmail } from "@/lib/email-templates";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com", fullName: "Marie Mercier" };
const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const JULIE = { id: "u_julie", role: "STAFF", email: "julieschoemans@gmail.com", fullName: "Julie Schoemans" };
const ROSE_WITH_CAISSE = { id: "u_rose", role: "STAFF", email: "rose@example.com", fullName: "Rose" };

const JULIES_SALE = { payeeStaffId: "staff_julie" };
const SALONS_SALE = { payeeStaffId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.emailPaymentTicket.mockResolvedValue({ success: true });
  mocks.staffFindFirst.mockResolvedValue({ dashboardPermissions: [] });
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.paymentFindUnique.mockResolvedValue(SALONS_SALE);
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
    expect(mocks.emailPaymentTicket).toHaveBeenNthCalledWith(1, "pay_1", { transactionId: "tx_1", actor: MARIE });
    expect(mocks.emailPaymentTicket).toHaveBeenNthCalledWith(2, "pay_2", { transactionId: null, actor: ADMIN });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("a staff member granted CAISSE collecting the salon's sale sends the salon's ticket", async () => {
    mocks.staffFindFirst.mockResolvedValue({ dashboardPermissions: ["CAISSE"] });
    await sendSettlementEmail(ROSE_WITH_CAISSE, "pay_6", { transactionId: "tx_6" });
    expect(mocks.emailPaymentTicket).toHaveBeenCalledWith("pay_6", { transactionId: "tx_6", actor: ROSE_WITH_CAISSE });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("the same staff member collecting HER OWN sale sends no ticket, whatever she holds", async () => {
    mocks.staffFindFirst.mockResolvedValue({ dashboardPermissions: ["CAISSE"] });
    mocks.paymentFindUnique.mockResolvedValue({ payeeStaffId: "staff_rose" });
    await sendSettlementEmail(ROSE_WITH_CAISSE, "pay_7");
    expect(mocks.emailPaymentTicket).not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("an independent's client gets a plain payment confirmation, with no attachment", async () => {
    mocks.paymentFindUnique.mockResolvedValue(JULIES_SALE);
    const result = await sendSettlementEmail(JULIE, "pay_3", { transactionId: "tx_3" });

    expect(result.success).toBe(true);
    expect(mocks.emailPaymentTicket).not.toHaveBeenCalled();
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

  /**
   * The case the payee column exists for. Marie is the till cash operator, so
   * the collector test alone would send the salon's ticket — but the sale is
   * Julie's, and the salon issues no document for it. Whose sale it is has to
   * beat who collected it, or Marie settling a balance at the counter would
   * mint a salon ticket for money that is not the salon's.
   */
  it("the salon collecting an independent's sale still issues no ticket", async () => {
    mocks.paymentFindUnique.mockResolvedValue(JULIES_SALE);

    const result = await sendSettlementEmail(MARIE, "pay_5", { transactionId: "tx_5" });

    expect(result.success).toBe(true);
    expect(mocks.emailPaymentTicket, "Marie collected, but the sale is Julie's").not.toHaveBeenCalled();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
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
