import { describe, expect, it } from "vitest";
import {
  getVatCountryCode,
  isValidVatFormat,
  normalizeVatNumber,
  parseViesResponse,
  viesPrefixForCountry,
} from "@/lib/vat-validation";
import { registerSchema } from "@/lib/validations/register";

const registration = {
  fullName: "Société Exemple",
  nickName: "",
  email: "facturation@example.com",
  phone: "+33 1 23 45 67 89",
  password: "mot-de-passe-solide",
  isCompany: true,
  vatNumber: "FR40303265045",
  addressLine1: "10 rue de Paris",
  addressLine2: "",
  addressCity: "Paris",
  addressPostalCode: "75001",
  addressCountry: "FR",
  termsAccepted: true,
  newsletterSubscribed: false,
};

describe("EU VAT validation", () => {
  it("accepts supported non-Belgian VIES formats and normalizes separators", () => {
    expect(isValidVatFormat("FR 40 303 265 045")).toBe(true);
    expect(isValidVatFormat("DE136695976")).toBe(true);
    expect(normalizeVatNumber("nl 123.456.789-b01")).toBe("NL123456789B01");
    expect(getVatCountryCode("FR40303265045")).toBe("FR");
  });

  it("maps Greece and Northern Ireland to their VIES prefixes", () => {
    expect(viesPrefixForCountry("GR")).toBe("EL");
    expect(viesPrefixForCountry("GB")).toBe("XI");
  });

  it("parses namespace-prefixed VIES SOAP responses", () => {
    const response = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:checkVatResponse xmlns:ns2="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
            <ns2:valid>true</ns2:valid>
            <ns2:name>Société &amp; Fils</ns2:name>
            <ns2:address>10 rue de Paris\n75001 Paris</ns2:address>
          </ns2:checkVatResponse>
        </soap:Body>
      </soap:Envelope>`;

    expect(parseViesResponse(response)).toEqual({
      valid: true,
      name: "Société & Fils",
      address: "10 rue de Paris\n75001 Paris",
    });
  });
});

describe("company registration VAT rules", () => {
  it("requires a VAT number for a company", () => {
    const result = registerSchema.safeParse({ ...registration, vatNumber: "" });
    expect(result.success).toBe(false);
    expect(result.error.flatten().fieldErrors.vatNumber?.[0]).toContain("obligatoire");
  });

  it("accepts a French company with a French VAT number", () => {
    expect(registerSchema.safeParse(registration).success).toBe(true);
  });

  it("rejects a VAT prefix that differs from the billing country", () => {
    const result = registerSchema.safeParse({ ...registration, addressCountry: "DE" });
    expect(result.success).toBe(false);
    expect(result.error.flatten().fieldErrors.vatNumber?.[0]).toContain("DE");
  });
});
