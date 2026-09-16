import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    order: { findUnique: vi.fn() },
    salon: { findUnique: vi.fn() },
    creditNote: { findUnique: vi.fn() },
  },
  renderTicketPdf: vi.fn(),
  renderCreditNotePdf: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/pdf/render", () => ({
  renderTicketPdf: mocks.renderTicketPdf,
  renderCreditNotePdf: mocks.renderCreditNotePdf,
}));

import { GET as getOrderTicket } from "@/app/api/orders/[id]/ticket/route";
import { GET as getCreditNotePdf } from "@/app/api/credit-notes/[id]/pdf/route";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const JULIE = { id: "u_julie", role: "STAFF", email: "julieschoemans@gmail.com" };
const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com" };
const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };

const params = Promise.resolve({ id: "doc_1" });
const request = new Request("http://localhost/api/doc_1");

const ORDER = {
  userId: "customer_1",
  orderNumber: 41,
  ticketNumber: "T-2026-000041",
  payment: { invoice: null, transactions: [{ id: "tx_1", pieceNumber: null, paidAt: new Date() }] },
  createdAt: new Date(),
  totalExclVat: 10,
  vatRate: 21,
  totalVat: 2.1,
  totalAmount: 12.1,
  items: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.order.findUnique.mockResolvedValue(ORDER);
  mocks.prisma.salon.findUnique.mockResolvedValue({ legalName: "Meri Beauty" });
  mocks.prisma.creditNote.findUnique.mockResolvedValue({ id: "cn_1", number: "NC-2026-001", invoice: { lines: [] } });
  mocks.renderTicketPdf.mockResolvedValue(Buffer.from("%PDF-1.4"));
  mocks.renderCreditNotePdf.mockResolvedValue(Buffer.from("%PDF-1.4"));
});

/**
 * Since 16/09/2026 no independent practitioner generates, sends or reprints a
 * salon ticket, invoice or credit note. The admin and Marie Mercier
 * (isTillCashOperator, despite her STAFF role) still do.
 */
describe("a boutique ticket reprint is the salon's", () => {
  it("an independent is refused", async () => {
    mocks.auth.mockResolvedValue({ user: JULIE });
    expect((await getOrderTicket(request, { params })).status).toBe(403);
    expect(mocks.renderTicketPdf).not.toHaveBeenCalled();
  });

  it("Marie and the admin still reprint it", async () => {
    for (const user of [MARIE, ADMIN]) {
      mocks.auth.mockResolvedValue({ user });
      expect((await getOrderTicket(request, { params })).status).toBe(200);
    }
  });

  it("a customer still reprints her own", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "customer_1", role: "CUSTOMER" } });
    expect((await getOrderTicket(request, { params })).status).toBe(200);
  });
});

describe("a credit note PDF is the salon's", () => {
  it("an independent is refused before the database is read", async () => {
    mocks.auth.mockResolvedValue({ user: JULIE });
    expect((await getCreditNotePdf(request, { params })).status).toBe(401);
    expect(mocks.prisma.creditNote.findUnique).not.toHaveBeenCalled();
  });

  it("Marie and the admin still open it", async () => {
    for (const user of [MARIE, ADMIN]) {
      mocks.auth.mockResolvedValue({ user });
      expect((await getCreditNotePdf(request, { params })).status).toBe(200);
    }
  });
});

describe("changing places never lets an independent replace an invoice", () => {
  it("the seat change refuses an invoiced booking unless the caller may replace invoices", () => {
    const lib = source("lib/reservations/change-reservation-seats.js");
    expect(lib).toContain("canReplaceInvoice = false");
    expect(lib).toContain('if (payment.invoice && !canReplaceInvoice) throw new Error("INVOICE_REPLACEMENT_SALON_ONLY");');
    // The refusal sits before supersedeInvoice, inside the same transaction.
    expect(lib.indexOf("INVOICE_REPLACEMENT_SALON_ONLY\");")).toBeLessThan(lib.indexOf("await supersedeInvoice(tx"));
  });

  it("both wrappers pass the salon rule, never a role test", () => {
    for (const path of ["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"]) {
      expect(source(path), path).toContain("canReplaceInvoice: isTillCashOperator(session.user)");
    }
  });
});

describe("sending invoices and credit notes stays admin-only", () => {
  it("every send action checks isAdminRole", () => {
    for (const path of [
      "actions/invoices/send-invoice-email.js",
      "actions/invoices/send-invoice-peppyrus.js",
      "actions/invoices/send-credit-note-email.js",
      "actions/invoices/send-credit-note-peppyrus.js",
    ]) {
      expect(source(path), path).toContain("!isAdminRole(session.user.role)");
    }
  });
});
