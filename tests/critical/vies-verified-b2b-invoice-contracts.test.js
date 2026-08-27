import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildInvoiceCustomer, issueInvoice } from "@/lib/invoicing";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const VALID_FR_VAT = "FR89929364818"; // same number as the real client-test@meribeauty.com account

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

function invoicingTx() {
  return {
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ lastNumber: 7 }])
      .mockResolvedValueOnce([{ lastNumber: 3 }]),
    salon: { findUnique: vi.fn().mockResolvedValue(COMPLETE_SALON) },
    invoice: { create: vi.fn(async ({ data }) => ({ id: "inv-1", ...data, lines: data.lines.create })) },
  };
}

const viesVerifiedUser = {
  fullName: "Marie Client",
  email: "marie@example.test",
  isCompany: true,
  vatNumber: VALID_FR_VAT,
  vatValidatedAt: new Date(), // just validated, well inside the 90-day window
  vatValidationName: "MARIE CLIENT SASU", // the name VIES itself returned
  addressLine1: "Rue Test 1",
  addressLine2: null,
  addressCity: "Bruxelles",
  addressPostalCode: "1000",
  addressCountry: "BE",
  billingProfile: null, // never filled in /mon-compte — the case this fixes
};

/**
 * A VIES-validated VAT number is itself proof the buyer is a registered
 * business — that is literally what VAT registration means. Requiring a
 * separately-typed BillingProfile.companyLegalName on top of that produced
 * an internally contradictory document: an EU_REVERSE_CHARGE invoice (a
 * strictly B2B mechanism) labelled customerType B2C, invisible to the
 * dashboard's B2B ledger for manual Peppol entry (invoices 2026-000044 and
 * 2026-000045, discovered 2026-08-27).
 */
describe("a VIES-validated company is a real B2B invoice, no BillingProfile required", () => {
  test("buildInvoiceCustomer derives legalName from the VIES-returned name", () => {
    const customer = buildInvoiceCustomer(viesVerifiedUser);
    expect(customer.isCompany).toBe(true);
    expect(customer.legalName).toBe("MARIE CLIENT SASU");
  });

  test("a manually-entered BillingProfile name still wins over the VIES one", () => {
    const customer = buildInvoiceCustomer({
      ...viesVerifiedUser,
      billingProfile: { companyLegalName: "Marie Client SASU (nom officiel)" },
    });
    expect(customer.legalName).toBe("Marie Client SASU (nom officiel)");
  });

  test("a stale or mismatched proof does not count", () => {
    // Validated 91 days ago — outside hasRecentVatValidation's window.
    const stale = { ...viesVerifiedUser, vatValidatedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) };
    expect(buildInvoiceCustomer(stale).legalName).toBeNull();

    // The number actually charged on this invoice differs from the one
    // VIES validated (vatNumberOverride) — the proof doesn't transfer.
    const overridden = buildInvoiceCustomer(viesVerifiedUser, { vatNumberOverride: "FR00000000000" });
    expect(overridden.legalName).toBeNull();
  });

  test("isCompany with no VIES proof and no BillingProfile still stays B2C (unchanged behaviour)", () => {
    const customer = buildInvoiceCustomer({
      fullName: "Jane Doe",
      email: "jane@example.test",
      isCompany: true,
      vatNumber: null,
      vatValidatedAt: null,
      vatValidationName: null,
      addressLine1: "Rue Test 1",
      addressCity: "Bruxelles",
      addressPostalCode: "1000",
      addressCountry: "BE",
      billingProfile: null,
    });
    expect(customer.legalName).toBeNull();
  });

  test("end-to-end: the resulting invoice is a coherent B2B document, not EU_REVERSE_CHARGE-under-B2C", async () => {
    const tx = invoicingTx();
    const customer = buildInvoiceCustomer(viesVerifiedUser);
    const invoice = await issueInvoice(tx, {
      paymentId: "pay-1",
      source: "WORKSHOP",
      totalInclVat: 100,
      customer,
      lines: [{ description: "Atelier", quantity: 1, unitPrice: 100 }],
      vatRate: 0,
      vatTreatment: "EU_REVERSE_CHARGE",
      taxCountryCode: "FR",
    });
    expect(invoice.customerType).toBe("B2B");
    expect(invoice.customerLegalName).toBe("MARIE CLIENT SASU");
    expect(invoice.vatTreatment).toBe("EU_REVERSE_CHARGE");
  });

  test("every select() that feeds buildInvoiceCustomer also loads vatValidationName", () => {
    // Sites that `include` the full user/customer row (no restrictive select)
    // already get every scalar column — only the ones with an explicit,
    // partial `select` needed extending.
    for (const [file, count] of [
      ["lib/orders/fulfill-order-payment.js", 1],
      ["actions/appointment/manage-appointment.js", 3],
      ["actions/boutique/orders.js", 1],
      ["app/api/webhooks/stripe/route.js", 1],
    ]) {
      const content = source(file);
      const validated = (content.match(/vatValidatedAt: true,/g) || []).length;
      const validationName = (content.match(/vatValidationName: true,/g) || []).length;
      expect(validated, `${file}: vatValidatedAt count`).toBe(count);
      expect(validationName, `${file}: vatValidationName count should match vatValidatedAt`).toBe(count);
    }
  });
});
