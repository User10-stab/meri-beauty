import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    invoice: { count: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
  },
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { listInvoices } from "@/actions/dashboard/invoices";
import { buildInvoiceWhere, creditNoteEligibility, normalizeInvoiceFilters } from "@/lib/invoices/list-filters";
import { buildPendingPaymentRows, pendingPaymentState } from "@/lib/invoices/pending-rows";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const ADMIN = { id: "u_admin", role: "ADMIN", email: "admin@meribeauty.com" };
const MARIE = { id: "u_marie", role: "STAFF", email: "contact@meribeautystudio.com" };

const INVOICE = {
  id: "inv_3",
  number: "F-2026-000003",
  source: "ORDER",
  paymentId: "pay_3",
  issuedAt: new Date("2026-08-29T14:11:18Z"),
  dueDate: null,
  customerName: "Sydney Lempereur",
  customerEmail: "sydneylempereur@gmail.com",
  customerType: "B2B",
  customerLegalName: "Lempereur, Sydney",
  customerVatNumber: "BE1025184684",
  subtotalExclVat: "12.40",
  vatRate: "21.00",
  vatAmount: "2.60",
  totalInclVat: "15.00",
  emailSentAt: null,
  peppyrusSentAt: null,
  supersededAt: null,
  supersededReason: null,
  creditNotes: [],
  payment: {
    order: { orderNumber: 4, status: "COMPLETED" },
    appointment: null,
    workshopReservation: null,
    formationReservation: null,
    _count: { refundOperations: 0 },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.invoice.count.mockResolvedValue(1);
  mocks.prisma.invoice.findMany.mockResolvedValue([INVOICE]);
  mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { totalInclVat: "15.00" } });
});

describe("filters never widen or break the query", () => {
  it("unknown values fall back to ALL, bad dates are dropped, page is at least 1", () => {
    expect(normalizeInvoiceFilters({ delivery: "DROP TABLE", source: "X", from: "31/08/2026", page: "-3" })).toEqual({
      page: 1,
      q: "",
      delivery: "ALL",
      source: "ALL",
      from: "",
      to: "",
    });
  });

  it("manual invoices have their own origin filter", () => {
    expect(buildInvoiceWhere(normalizeInvoiceFilters({ source: "MANUAL" }))).toEqual({ AND: [{ source: "MANUAL" }] });
  });

  it("no filter means every invoice", () => {
    expect(buildInvoiceWhere(normalizeInvoiceFilters({}))).toEqual({});
  });

  it("'jamais envoyées' means neither e-mail nor Peppol", () => {
    expect(buildInvoiceWhere(normalizeInvoiceFilters({ delivery: "UNSENT" }))).toEqual({ AND: [{ emailSentAt: null, peppyrusSentAt: null }] });
  });

  it("'Peppol à envoyer' is Belgian B2B only, the rule sendInvoiceToPeppyrus enforces", () => {
    const where = buildInvoiceWhere(normalizeInvoiceFilters({ delivery: "PEPPOL_PENDING" }));
    expect(where.AND[0]).toMatchObject({ customerType: "B2B", peppyrusSentAt: null, customerVatNumber: { startsWith: "BE" } });
  });

  it("a date range covers the whole last day", () => {
    const { AND } = buildInvoiceWhere(normalizeInvoiceFilters({ from: "2026-09-01", to: "2026-09-30" }));
    expect(AND[0].issuedAt.gte.getDate()).toBe(1);
    expect(AND[0].issuedAt.lte.getHours()).toBe(23);
    expect(AND[0].issuedAt.lte.getMinutes()).toBe(59);
  });
});

describe("the credit note button follows the Opérations rule", () => {
  const row = (over = {}) => ({ supersededAt: null, paymentId: "pay", totalInclVat: 15, creditNotes: [], refundOperationCount: 0, itemKind: "ORDER", itemStatus: "COMPLETED", ...over });

  it("a finished, uncredited sale may be credited", () => {
    expect(creditNoteEligibility(row()).allowed).toBe(true);
    expect(creditNoteEligibility(row({ itemKind: "APPOINTMENT", itemStatus: "COMPLETED" })).allowed).toBe(true);
  });

  it("refused: contract invoice, superseded, fully credited, operation in flight, item not finished", () => {
    expect(creditNoteEligibility(row({ paymentId: null })).allowed).toBe(false);
    expect(creditNoteEligibility(row({ supersededAt: new Date() })).allowed).toBe(false);
    expect(creditNoteEligibility(row({ creditNotes: [{ totalInclVat: 15 }] })).allowed).toBe(false);
    expect(creditNoteEligibility(row({ refundOperationCount: 1 })).allowed).toBe(false);
    expect(creditNoteEligibility(row({ itemKind: "APPOINTMENT", itemStatus: "CONFIRMED" })).allowed).toBe(false);
  });

  it("a partial credit leaves the rest creditable", () => {
    expect(creditNoteEligibility(row({ creditNotes: [{ totalInclVat: 5 }] })).allowed).toBe(true);
  });
});

describe("listInvoices is admin only", () => {
  it("refuses anyone who is not an admin — Marie included, like the send actions", async () => {
    for (const user of [null, MARIE, { id: "c", role: "CUSTOMER" }]) {
      mocks.auth.mockResolvedValue(user ? { user } : null);
      expect((await listInvoices()).success).toBe(false);
    }
    expect(mocks.prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("returns delivery state, Peppol applicability and credit note eligibility", async () => {
    mocks.auth.mockResolvedValue({ user: ADMIN });
    const result = await listInvoices({ delivery: "UNSENT" });
    expect(result.success).toBe(true);
    const [first] = result.data.rows;
    expect(first).toMatchObject({
      number: "F-2026-000003",
      totalInclVat: 15,
      peppolApplicable: true,
      emailSentAt: null,
      itemRef: "Commande n°4",
      canGenerateCreditNote: true,
    });
    expect(result.data.stats).toMatchObject({ count: 1, totalInclVat: 15 });
  });

});

describe("what is still owed, in the invoice table itself", () => {
  const MANUAL = {
    kind: "MANUAL_SALE",
    orderId: "o_1",
    orderNumber: 77,
    createdAt: new Date("2026-09-10T09:00:00Z"),
    paymentDueDate: new Date("2026-09-17T00:00:00Z"),
    customerName: "Lara Reniers",
    customerLegalName: "Lara Reniers Beauty",
    customerEmail: "lara@example.com",
    summary: "2 × Sérum",
    totalAmount: 174.2,
    paidAmount: 50,
    remainingAmount: 124.2,
    awaitedTransferAmount: null,
    invoiceNumber: null,
  };
  const TRANSFER = {
    kind: "TRANSFER",
    paymentId: "p_t",
    reference: "Commande n°4",
    createdAt: new Date("2026-09-12T09:00:00Z"),
    customerName: "Zuld Roxana",
    customerEmail: "zuld@example.com",
    summary: "1 × Masque",
    totalAmount: 48.88,
    paidAmount: 0,
    awaitedTransferAmount: 48.88,
    remainingAmount: 48.88,
  };
  const RENT = {
    kind: "RENT",
    rentId: "smi_1",
    invoiceId: null,
    number: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    dueDate: new Date("2026-09-08T00:00:00Z"),
    staffName: "Lyly Hannecart",
    staffEmail: "lyly@example.com",
    period: "Location d'une cabine professionnelle — septembre 2026",
    remainingAmount: 500,
  };
  const LEGACY = { ...RENT, kind: "LEGACY_INVOICE", rentId: null, invoiceId: "inv_old", number: "F-2026-000010", dueDate: null, staffName: "Sabrina" };

  it("puts a manual sale, a counter transfer and a staff rent in one list, soonest échéance first", () => {
    const rows = buildPendingPaymentRows({ manualSales: [MANUAL, TRANSFER], staffRent: [RENT, LEGACY] });
    // Dated rows first, soonest échéance leading; the undated ones follow, newest first.
    expect(rows.map((row) => row.key)).toEqual(["rent-smi_1", "sale-o_1", "transfer-p_t", "rent-inv_old"]);
    expect(rows[0]).toMatchObject({ origin: "Loyer staff", label: "Loyer", remainingAmount: 500, accept: { kind: "RENT", rentId: "smi_1" } });
    expect(rows[1]).toMatchObject({ origin: "Vente sur facture", label: "Vente n°77", settleOrderId: "o_1", accept: { kind: "MANUAL_SALE", orderId: "o_1" } });
    expect(rows[2]).toMatchObject({ origin: "Virement comptoir", accept: { kind: "TRANSFER", paymentId: "p_t" } });
  });

  it("a rent invoiced before the payment-first rule carries its number, so its row is the invoice's own", () => {
    const [legacy] = buildPendingPaymentRows({ staffRent: [LEGACY] });
    expect(legacy).toMatchObject({ invoiceNumber: "F-2026-000010", accept: { kind: "LEGACY_INVOICE", invoiceId: "inv_old" } });
    // Only the settle dialog is manual-sale-only: a rent is accepted, nothing else.
    expect(legacy.settleOrderId).toBeNull();
  });

  it("a row waits for its échéance, then reads as late — it is never refused", () => {
    const now = new Date("2026-09-21T00:00:00Z").getTime();
    expect(pendingPaymentState({ dueDate: new Date("2026-09-08T00:00:00Z") }, now)).toEqual({ late: true, dueDate: expect.any(Date) });
    expect(pendingPaymentState({ dueDate: new Date("2026-10-07T00:00:00Z") }, now).late).toBe(false);
    // A counter transfer has no échéance: it waits without ever turning late.
    expect(pendingPaymentState({ dueDate: null }, now)).toEqual({ late: false, dueDate: null });
    // Waiting or late are the only two states a row can be in — nothing records a refusal.
    expect(Object.keys(pendingPaymentState({ dueDate: null }, now))).toEqual(["late", "dueDate"]);
    expect(buildPendingPaymentRows({ staffRent: [RENT] })[0]).not.toHaveProperty("rejectedAt");
  });
});

describe("the page", () => {
  it("is admin-guarded and listed under Ventes & paiements", () => {
    expect(source("app/dashboard/factures/page.jsx")).toContain("await requireAdmin(false)");
    // « Vendre avec facture » opens la caisse, where invoice sales are composed.
    expect(source("app/dashboard/factures/page.jsx")).toContain('href="/dashboard/boutique/point-of-sale#counter-cart"');
    // Manual sales paid by acompte or later have no invoice yet: they are rows
    // of the invoice table itself, with the « Paiement » column and its tick.
    expect(source("app/dashboard/factures/page.jsx")).toContain("listPendingManualSales()");
    expect(source("app/dashboard/factures/page.jsx")).toContain("buildPendingPaymentRows({");
    expect(source("components/dashboard/Layouts/sidebar/data/index.js")).toContain(
      '{ title: "Factures", url: "/dashboard/factures", roles: [ROLES.OWNER, ROLES.ADMIN] }'
    );
  });

  it("reuses the Opérations delivery card and credit note flow, and never deletes an invoice", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain("<DocumentDeliveryDialog");
    expect(client).toContain("<GenerateCreditNoteDialog");
    const action = source("actions/dashboard/invoices.js");
    expect(action).not.toMatch(/invoice\.(delete|deleteMany|update|updateMany)\(/);
  });

  it("once a credit note exists, Voir / E-mail / Peppol for it replace the Note de crédit button", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    // No notes column/badge, no separate card.
    expect(client).not.toContain("Notes de crédit</th>");
    expect(client).not.toContain("setNotesCard");
    expect(client).toContain("{noteCount === 0 && (");
    expect(client).toContain('<a href={pdfHref} target="_blank" rel="noopener noreferrer"');
    // "Voir" only — the PDF opens in a new tab, never a forced download.
    expect(client).not.toContain("download=");
    expect(client).toContain('pdfHref={`/api/invoices/${invoice.id}/pdf`}');
    expect(client).toContain('pdfHref={`/api/credit-notes/${note.id}/pdf`}');
    expect(client).toContain('onSend={(channel) => setDelivery({ kind: "CREDIT_NOTE", document: note, invoice, channel })}');
    expect(client).toContain('onClick={() => onSend("EMAIL")}');
    // Peppol only where the server would accept it.
    expect(client).toContain('{peppolApplicable && (\n        <button type="button" onClick={() => onSend("PEPPYRUS")}');
    expect(client).toContain("initialChannel={delivery?.channel ?? null}");
  });

  it("the channel button pre-ticks only its own channel, and Peppol only when eligible", () => {
    const delivery = source("components/dashboard/operations/DocumentDeliveryDialog.jsx");
    expect(delivery).toContain('setEmailChecked(initialChannel === "EMAIL");');
    expect(delivery).toContain('setPeppyrusChecked(initialChannel === "PEPPYRUS" && canUsePeppyrus);');
    // Opérations passes no channel: nothing pre-ticked there, as before.
    expect(delivery).toContain("initialChannel = null");
  });
});
