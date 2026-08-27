import { describe, expect, test, vi } from "vitest";

// The render module reaches for the database to resolve the "PAYÉE le …"
// line. Nothing here needs it — the fixture carries its own payment — and a
// critical test must not depend on a reachable Neon branch.
vi.mock("@/lib/prisma", () => ({ prisma: { payment: { findUnique: async () => null } } }));
vi.mock("@/lib/pdf/seller-contact", () => ({ getSellerContact: async () => null }));

const { renderInvoicePdf } = await import("@/lib/pdf/render");

const invoice = {
  id: "inv_test",
  number: "2026-000042",
  issuedAt: new Date("2026-08-24T10:00:00Z"),
  paymentId: null,
  payment: { paidAt: new Date("2026-08-24T10:00:00Z") },
  sellerName: "Meri Beauty SRL",
  sellerAddress: "Rue de Test 1, 1000 Bruxelles, BE",
  sellerVatNumber: "BE0123456789",
  customerName: "Client Test",
  customerEmail: "client@example.com",
  customerVatNumber: null,
  customerAddress: "Avenue Test 2, 1050 Ixelles, BE",
  customerType: "B2C",
  customerLegalName: null,
  customerContactName: null,
  customerRegistrationNo: null,
  purchaseOrderReference: null,
  subtotalExclVat: 21.45,
  vatRate: 21,
  vatAmount: 4.5,
  totalInclVat: 25.95,
  taxCountryCode: "BE",
  vatTreatment: "DOMESTIC",
  taxNote: null,
  lines: [
    {
      id: "l1",
      description: "Popits - Almond Natural — Standard",
      quantity: 1,
      unitPrice: 25.95,
      lineTotal: 25.95,
      unitPriceExclVat: 21.4463,
      lineTotalExclVat: 21.45,
    },
  ],
};

describe("the invoice PDF still renders once the net columns are on the line", () => {
  test("a real PDF comes out, not an exception", async () => {
    const buffer = await renderInvoicePdf(invoice);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  test("an invoice issued before the net columns existed still renders", async () => {
    // LineItemsTable divides the gross by the invoice rate for these. The
    // fallback has to survive a real render, not just read plausibly.
    const legacy = {
      ...invoice,
      lines: [{ ...invoice.lines[0], unitPriceExclVat: null, lineTotalExclVat: null }],
    };
    const buffer = await renderInvoicePdf(legacy);
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
