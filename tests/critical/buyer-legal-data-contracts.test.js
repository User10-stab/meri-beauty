import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertBuyerLegalDataComplete, issueInvoice } from "../../lib/invoicing.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

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
    $queryRaw: vi.fn().mockResolvedValue([{ lastNumber: 7 }]),
    salon: { findUnique: vi.fn().mockResolvedValue(COMPLETE_SALON) },
    invoice: { create: vi.fn(async ({ data }) => ({ id: "inv-1", ...data })) },
  };
}

const VALID_BUYER = {
  fullName: "Client Test",
  email: "client@example.test",
  address: "Rue Test 1, 1000 Bruxelles",
};

// Invoice 2026-000039 printed a buyer block with no address line at all:
// PartyRow in lib/pdf/theme.jsx returns null on an empty value, so the
// mandatory mention simply vanished and the document still looked complete.
// Article 226(5) of Directive 2006/112/CE requires the full name AND address
// of both parties.
describe("an invoice is never issued without the buyer's mandatory mentions", () => {
  test("a complete buyer passes", () => {
    expect(() => assertBuyerLegalDataComplete(VALID_BUYER)).not.toThrow();
  });

  test.each([
    ["address", undefined],
    ["address", null],
    ["address", ""],
    ["address", "   "],
  ])("a missing %s (%s) is refused", (field, value) => {
    expect(() => assertBuyerLegalDataComplete({ ...VALID_BUYER, [field]: value })).toThrow(
      "BUYER_LEGAL_DATA_INCOMPLETE"
    );
  });

  test.each([[undefined], [null], [""], ["  "]])("a missing name (%s) is refused", (value) => {
    expect(() => assertBuyerLegalDataComplete({ ...VALID_BUYER, fullName: value })).toThrow(
      "BUYER_LEGAL_DATA_INCOMPLETE"
    );
  });

  test("the error names exactly what is missing, ready to show to staff", () => {
    try {
      assertBuyerLegalDataComplete({ email: "x@y.test" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.message).toBe("BUYER_LEGAL_DATA_INCOMPLETE");
      expect(error.missing).toEqual(["le nom", "l'adresse de facturation"]);
      // Plural agreement matters: this string is shown verbatim at the till.
      expect(error.userMessage).toContain("sont obligatoires et manquent");
      expect(error.userMessage).toContain("Complétez-la");
    }
  });

  test("a single missing field reads in the singular", () => {
    try {
      assertBuyerLegalDataComplete({ ...VALID_BUYER, address: null });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error.userMessage).toContain("est obligatoire et manque");
      expect(error.userMessage).not.toContain("sont obligatoires");
    }
  });
});

describe("the refusal happens before anything is written", () => {
  test("no invoice row is created", async () => {
    const tx = invoicingTx();
    await expect(
      issueInvoice(tx, {
        paymentId: "pay-1",
        source: "ORDER",
        totalInclVat: 121,
        customer: { fullName: "Client", email: "client@example.test" },
        lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
      })
    ).rejects.toThrow("BUYER_LEGAL_DATA_INCOMPLETE");

    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  test("no number is drawn from the gapless legal sequence", async () => {
    // Belgian VAT law wants an unbroken series. A refused invoice must not
    // consume one, rollback or no rollback.
    const tx = invoicingTx();
    await expect(
      issueInvoice(tx, {
        paymentId: "pay-1",
        source: "ORDER",
        totalInclVat: 121,
        customer: { fullName: "Client", email: "client@example.test" },
        lines: [{ description: "Produit", quantity: 1, unitPrice: 121 }],
      })
    ).rejects.toThrow();

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test("the buyer check runs after the seller check, so the salon's own gap wins", () => {
    // If both are incomplete, "complete Réglages > Salon" is the one action
    // that fixes every invoice at once — surface it first.
    const invoicing = source("lib/invoicing.js");
    expect(invoicing.indexOf('throw new Error("SELLER_LEGAL_DATA_INCOMPLETE")')).toBeLessThan(
      invoicing.indexOf("assertBuyerLegalDataComplete(customer);")
    );
  });
});

// isCompany without a registered name is deliberately degraded to a B2C
// document rather than refused: it makes no B2B claim, so it is complete as
// what it is. Refusing it would break a documented, tested fallback.
describe("the guard does not overreach into the B2B fallback", () => {
  test("a company with no legal name still passes the buyer check", () => {
    expect(() =>
      assertBuyerLegalDataComplete({ ...VALID_BUYER, isCompany: true })
    ).not.toThrow();
  });

  test("a real B2B invoice cannot lack a legal name by construction", () => {
    // customerType is DERIVED from legalName, so there is no state where a
    // B2B document exists without one — no separate check is needed.
    expect(source("lib/invoicing.js")).toContain(
      "const isB2B = Boolean(customer.isCompany && customer.legalName);"
    );
  });
});

describe("every settlement path turns the refusal into something staff can act on", () => {
  test.each([
    ["actions/boutique/point-of-sale.js"],
    ["actions/appointment/manage-appointment.js"],
    ["lib/reservations/settle-reservation.js"],
    ["actions/boutique/orders.js"],
  ])("%s surfaces the message instead of a generic failure", (file) => {
    const content = source(file);
    expect(content).toContain('if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE")');
    expect(content).toContain("message: error.userMessage");
  });

  test("it sits alongside the seller-side guard it mirrors", () => {
    for (const file of [
      "actions/boutique/point-of-sale.js",
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
      "actions/boutique/orders.js",
    ]) {
      const content = source(file);
      expect(content.indexOf('"SELLER_LEGAL_DATA_INCOMPLETE"')).toBeGreaterThan(-1);
      expect(content.indexOf('"BUYER_LEGAL_DATA_INCOMPLETE"')).toBeGreaterThan(-1);
    }
  });
});
