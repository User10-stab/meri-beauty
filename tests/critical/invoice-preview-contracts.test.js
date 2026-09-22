import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    salon: { findUnique: vi.fn() },
    payment: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    staffMonthlyInvoice: { findUnique: vi.fn() },
    numberingCounter: { findUnique: vi.fn() },
    order: { findUnique: vi.fn() },
    invoice: { create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { buildPendingInvoicePreview } from "@/lib/invoices/invoice-preview";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const SALON = {
  name: "Meri Beauty",
  legalName: "Meri Beauty Studio SRL",
  vatNumber: "BE0751854027",
  addressLine1: "Rue Bonaventure 113",
  postalCode: "1090",
  city: "Jette",
  countryCode: "BE",
};

const LYLY = {
  id: "u_lyly",
  fullName: "Lyly Hannecart",
  email: "lylyht.mylitha@gmail.com",
  isCompany: false,
  vatNumber: null,
  addressLine1: "Steenweg op Merchtem 45",
  addressPostalCode: "1780",
  addressCity: "Wemmel",
  addressCountry: "BE",
  billingProfile: null,
};

const RENT = {
  status: "AWAITING_PAYMENT",
  invoiceId: null,
  paymentId: "p_rent",
  amount: "500.00",
  lineDescription: "Location d'une cabine professionnelle — septembre 2026",
  staff: { id: "s_lyly", vatNumber: "BE0660821903", user: LYLY },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.salon.findUnique.mockResolvedValue(SALON);
  mocks.prisma.payment.findUnique.mockResolvedValue({ payeeStaffId: null });
  mocks.prisma.user.findUnique.mockResolvedValue(LYLY);
  mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue(RENT);
  mocks.prisma.numberingCounter.findUnique.mockResolvedValue({ lastNumber: 12 });
});

describe("« Aperçu » shows the invoice « Accepter » would issue, without issuing it", () => {
  it("a rent due previews as its invoice: same figures and buyer, its forecast number, nothing taken or written", async () => {
    const preview = await buildPendingInvoicePreview({ kind: "RENT", id: "smi_lyly" });
    expect(preview.invoice).toMatchObject({
      isPreview: true,
      // The next free number, read — not taken (the counter is never incremented).
      number: expect.stringMatching(/^F-\d{4}-000013$/),
      source: "STAFF_CONTRACT",
      customerName: "Lyly Hannecart",
      // Her VAT number sits on her staff record: a B2B document, like the real one.
      customerVatNumber: "BE0660821903",
      customerType: "B2B",
      totalInclVat: 500,
    });
    expect(preview.invoice.lines).toEqual([
      expect.objectContaining({ description: "Location d'une cabine professionnelle — septembre 2026", quantity: 1, lineTotal: 500 }),
    ]);
    // The gapless legal sequence is untouched and no Invoice row exists.
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("an accept that would fail says so before anyone clicks — incomplete salon data", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue({ ...SALON, legalName: null });
    const preview = await buildPendingInvoicePreview({ kind: "RENT", id: "smi_lyly" });
    expect(preview).toMatchObject({ reason: "SELLER_LEGAL_DATA_INCOMPLETE", message: expect.stringContaining("Paramètres") });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("a rent already accepted, or an unknown row, has nothing to preview", async () => {
    mocks.prisma.staffMonthlyInvoice.findUnique.mockResolvedValue({ ...RENT, status: "GENERATED", invoiceId: "inv_1" });
    expect(await buildPendingInvoicePreview({ kind: "RENT", id: "smi_lyly" })).toMatchObject({ reason: "ALREADY_INVOICED" });
    expect(await buildPendingInvoicePreview({ kind: "LEGACY_INVOICE", id: "x" })).toMatchObject({ reason: "UNKNOWN_KIND" });
  });

  it("a counter transfer from a particulier explains that only a ticket is issued", async () => {
    mocks.prisma.payment.findUnique.mockResolvedValue({
      id: "p_t",
      isDeleted: false,
      totalAmount: "48.88",
      paidAmount: "0.00",
      awaitedTransferAmount: "48.88",
      discountAmount: "0.00",
      invoice: null,
      order: {
        orderNumber: 4,
        createdAt: new Date(),
        user: { fullName: "Zuld Roxana", email: "z@example.com", vatNumber: null, billingProfile: null },
        items: [{ quantity: 1, productName: "Masque", variantName: null, unitPrice: "48.88" }],
      },
    });
    const preview = await buildPendingInvoicePreview({ kind: "TRANSFER", id: "p_t" });
    expect(preview).toMatchObject({ reason: "NOT_VAT_REGISTERED", message: expect.stringContaining("ticket") });
  });
});

describe("the same inputs as the accept paths — the preview cannot drift from the real invoice", () => {
  it("issueInvoice is prepareInvoice plus the number, and every accept path builds its input from the shared helpers", () => {
    const invoicing = source("lib/invoicing.js");
    expect(invoicing).toContain("const draft = await prepareInvoice(tx, input);");
    expect(source("actions/invoices/staff-rent.js")).toContain("rentInvoiceInput({ paymentId: rent.paymentId");
    expect(source("actions/invoices/manual-invoice.js")).toContain("issueInvoice(tx, manualSaleInvoiceInput({ order, buyer, paymentId }))");
    expect(source("lib/payments/awaited-transfer.js")).toContain("issueInvoice(tx, awaitedTransferInvoiceInput(payment, details, customer))");
  });

  it("the preview PDF is marked as such and the route is admin-only", () => {
    expect(source("lib/pdf/InvoiceDocument.jsx")).toContain('label: "APERÇU — NON ÉMISE"');
    const route = source("app/api/invoices/preview/route.js");
    expect(route).toContain("if (!isAdminRole(session.user.role))");
    expect(route).toContain('"Cache-Control": "no-store"');
  });

  it("the Factures table offers « Aperçu » before « Accepter », with the buttons pinned to the right edge", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain("/api/invoices/preview?kind=");
    expect(client).toContain('const stickyActions = "sticky right-0');
    expect(client.match(/\$\{stickyActions\}/g)).toHaveLength(3);
  });

  it("the action buttons are icons only, each still named by a tooltip and for screen readers", () => {
    const client = source("components/dashboard/invoices/InvoicesClient.jsx");
    expect(client).toContain('"inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border');
    for (const label of ["Voir le PDF", "Envoyer par e-mail", "Envoyer via Peppol", "Aperçu de la facture", "Accepter le paiement", "Encaisser autrement", "Générer une note de crédit"]) {
      expect(client, label).toContain(`aria-label="${label}"`);
    }
    // No text label left beside an icon in the Actions column.
    expect(client).not.toMatch(/size=\{ICON\} \/> [A-ZÉ]/);
    // The status badge no longer breaks « En attente » over two lines.
    expect(client).toContain("inline-flex items-center gap-1 whitespace-nowrap rounded-full");
  });
});
