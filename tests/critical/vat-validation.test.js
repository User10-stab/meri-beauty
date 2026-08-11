import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  getVatCountryCode,
  isValidVatFormat,
  normalizeVatNumber,
  parseViesResponse,
  verifyVatWithVies,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("retries a temporary country fault before accepting a valid response", async () => {
    const temporaryFault = `
      <soap:Envelope><soap:Body><soap:Fault>
        <faultstring>MS_UNAVAILABLE</faultstring>
      </soap:Fault></soap:Body></soap:Envelope>`;
    const validResponse = `
      <soap:Envelope><soap:Body><checkVatResponse>
        <valid>true</valid><name>Société Exemple</name><address>Bruxelles</address>
      </checkVatResponse></soap:Body></soap:Envelope>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => temporaryFault })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => validResponse });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyVatWithVies("BE0751854027")).resolves.toMatchObject({
      success: true,
      valid: true,
      name: "Société Exemple",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

describe("public VIES abuse protection", () => {
  it("uses shared limits by IP and VAT number and caches successful checks", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "actions/vat/verify-vat.js"), "utf8");
    expect(source).toContain('consumeSharedRateLimit("verify-vat-ip"');
    expect(source).toContain('consumeSharedRateLimit("verify-vat-number"');
    expect(source).toContain("RATE_LIMIT_MAX_PER_IP = 5");
    expect(source).toContain("RATE_LIMIT_MAX_PER_VAT_NUMBER = 3");
    expect(source).toContain("cachedResult(normalized)");
  });
});
