import { describe, expect, test, vi } from "vitest";
import { issueCreditNote, issueInvoice } from "../../lib/invoicing.js";
import {
  DASHBOARD_PERMISSIONS,
  ROLES,
  hasPermission,
  isAdminRole,
  requireRole,
} from "../../lib/authorization.js";

function invoicingTx({ invoiceTotal = 121, credited = 0 } = {}) {
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ lastNumber: 7 }])
      .mockResolvedValueOnce([{ lastNumber: 3 }]),
    salon: { findUnique: vi.fn().mockResolvedValue({ name: "Meri Beauty", vatNumber: "BE0751854027" }) },
    invoice: {
      create: vi.fn(async ({ data }) => ({ id: "inv-1", ...data })),
      findUnique: vi.fn().mockResolvedValue({ totalInclVat: invoiceTotal }),
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
      customer: { fullName: "Client", email: "client@example.test" },
      lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(invoice.number).toMatch(/^\d{4}-000007$/);
    expect(invoice.subtotalExclVat).toBe(100);
    expect(invoice.vatAmount).toBe(21);
    expect(invoice.totalInclVat).toBe(121);
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
