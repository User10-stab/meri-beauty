import { describe, expect, test, vi } from "vitest";
import { issueCreditNote, issueInvoice } from "../../lib/invoicing.js";
import {
  DASHBOARD_PERMISSIONS,
  ROLES,
  hasPermission,
  isAdminRole,
  requireRole,
} from "../../lib/authorization.js";

const COMPLETE_SALON = {
  name: "Meri Beauty",
  vatNumber: "BE0751854027",
  legalName: "Meri Beauty",
  companyRegistrationNo: "0751.854.027",
  addressLine1: "Rue Bonaventure 113",
  addressLine2: null,
  postalCode: "1090",
  city: "Jette",
  countryCode: "BE",
};

function invoicingTx({ invoiceTotal = 121, invoiceVatRate = 21, credited = 0, salon = COMPLETE_SALON } = {}) {
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ lastNumber: 7 }])
      .mockResolvedValueOnce([{ lastNumber: 3 }]),
    salon: { findUnique: vi.fn().mockResolvedValue(salon) },
    invoice: {
      create: vi.fn(async ({ data }) => ({ id: "inv-1", ...data })),
      findUnique: vi.fn().mockResolvedValue({ totalInclVat: invoiceTotal, vatRate: invoiceVatRate }),
    },
    creditNote: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { totalInclVat: credited } }),
      create: vi.fn(async ({ data }) => ({ id: "cn-1", ...data })),
    },
  };
}

describe("invoice and credit-note issuance", () => {
  test("invoice numbering and VAT totals are generated inside the supplied transaction", async () => {
    const tx = invoicingTx();
    const invoice = await issueInvoice(tx, {
      paymentId: "pay-1",
      source: "ORDER",
      totalInclVat: 121,
      customer: { fullName: "Client", email: "client@example.test", address: "Rue Test 1, 1000 Bruxelles" },
      lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(invoice.number).toMatch(/^F-\d{4}-000007$/);
    expect(invoice.subtotalExclVat).toBe(100);
    expect(invoice.vatAmount).toBe(21);
    expect(invoice.totalInclVat).toBe(121);
    expect(invoice.customerType).toBe("B2C");
  });

  test("fails closed when the seller's legal identity is incomplete, rather than emitting a partial document", async () => {
    const tx = invoicingTx({ salon: { ...COMPLETE_SALON, addressLine1: null } });
    await expect(issueInvoice(tx, {
      paymentId: "pay-1",
      source: "ORDER",
      totalInclVat: 121,
      customer: { fullName: "Client", email: "client@example.test", address: "Rue Test 1, 1000 Bruxelles" },
      lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
    })).rejects.toThrow("SELLER_LEGAL_DATA_INCOMPLETE");
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  test("a company customer with a billing profile produces a B2B invoice snapshot", async () => {
    const tx = invoicingTx();
    const invoice = await issueInvoice(tx, {
      paymentId: "pay-1",
      source: "ORDER",
      totalInclVat: 121,
      customer: {
        fullName: "Jane Doe",
        email: "jane@example.test",
        address: "Rue Test 1, 1000 Bruxelles",
        isCompany: true,
        legalName: "Doe Consulting SRL",
        companyRegistrationNo: "0123.456.789",
        purchaseOrderReference: "PO-42",
      },
      lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
    });

    expect(invoice.customerType).toBe("B2B");
    expect(invoice.customerLegalName).toBe("Doe Consulting SRL");
    expect(invoice.customerContactName).toBe("Jane Doe");
    expect(invoice.customerRegistrationNo).toBe("0123.456.789");
    expect(invoice.purchaseOrderReference).toBe("PO-42");
  });

  test("isCompany alone (no BillingProfile legalName yet) stays B2C, not a half-populated B2B invoice", async () => {
    const tx = invoicingTx();
    const invoice = await issueInvoice(tx, {
      paymentId: "pay-1",
      source: "ORDER",
      totalInclVat: 121,
      customer: { fullName: "Jane Doe", email: "jane@example.test", address: "Rue Test 1, 1000 Bruxelles", isCompany: true },
      lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
    });

    expect(invoice.customerType).toBe("B2C");
    expect(invoice.customerLegalName).toBeNull();
  });

  test("a credit note is broken down into HT/TVA/TTC at the original invoice's rate", async () => {
    const tx = invoicingTx({ invoiceTotal: 121, invoiceVatRate: 21 });
    const creditNote = await issueCreditNote(tx, {
      invoiceId: "inv-1",
      reason: "Retour partiel",
      totalInclVat: 60.5,
    });

    expect(creditNote.vatRate).toBe(21);
    expect(creditNote.subtotalExclVat).toBe(50);
    expect(creditNote.vatAmount).toBe(10.5);
    expect(creditNote.totalInclVat).toBe(60.5);
  });

  test("credit notes cannot exceed the original invoice", async () => {
    const tx = invoicingTx({ invoiceTotal: 100, credited: 80 });
    await expect(issueCreditNote(tx, {
      invoiceId: "inv-1",
      reason: "Retour",
      totalInclVat: 25,
    })).rejects.toThrow("CREDIT_NOTE_EXCEEDS_INVOICE");
    expect(tx.creditNote.create).not.toHaveBeenCalled();
  });
});

describe("role and IDOR policy matrix", () => {
  test("only owner/admin are admin roles", () => {
    expect(isAdminRole(ROLES.OWNER)).toBe(true);
    expect(isAdminRole(ROLES.ADMIN)).toBe(true);
    expect(isAdminRole(ROLES.STAFF)).toBe(false);
    expect(isAdminRole(ROLES.CUSTOMER)).toBe(false);
  });

  test("financial ledgers stay admin-only while operational orders allow staff", () => {
    expect(hasPermission(ROLES.STAFF, DASHBOARD_PERMISSIONS.INVOICES)).toBe(false);
    expect(hasPermission(ROLES.STAFF, DASHBOARD_PERMISSIONS.ORDERS)).toBe(true);
    expect(hasPermission(ROLES.CUSTOMER, DASHBOARD_PERMISSIONS.ORDERS)).toBe(false);
  });

  test("requireRole returns unauthorized/forbidden without trusting caller input", () => {
    const unauthorized = vi.fn(() => "401");
    const forbidden = vi.fn(() => "403");
    expect(requireRole(null, [ROLES.ADMIN], unauthorized, forbidden)).toBe("401");
    expect(requireRole({ user: { role: ROLES.CUSTOMER } }, [ROLES.ADMIN], unauthorized, forbidden)).toBe("403");
    expect(requireRole({ user: { role: ROLES.ADMIN } }, [ROLES.ADMIN], unauthorized, forbidden)).toBeNull();
  });
});
