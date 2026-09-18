import { describe, expect, it } from "vitest";
import { registerClientSchema } from "@/lib/validations/register-client";

// Every signup validation failure must surface as a clear, French,
// field-level message — never a generic toast, a bare red border, or a raw
// Zod/English default (see the termsAccepted errorMap incident: Zod 4
// ignores errorMap, which used to leak "Invalid input: expected true").
describe("signup validation errors are clear and field-level", () => {
  it("every bad field gets a clear French field-level message", () => {
    const r = registerClientSchema.safeParse({
      fullName: "",
      email: "not-an-email",
      phone: "",
      password: "short",
      isCompany: true,
      vatNumber: "XX",
      companyLegalName: "",
      addressLine1: "",
      addressCity: "",
      addressPostalCode: "",
      addressCountry: "BE",
      termsAccepted: false,
    });
    expect(r.success).toBe(false);
    const fe = r.error.flatten().fieldErrors;
    expect(fe.fullName?.[0]).toContain("obligatoire");
    expect(fe.email?.[0]).toContain("invalide");
    expect(fe.phone?.[0]).toContain("obligatoire");
    expect(fe.password?.[0]).toContain("8 caractères");
    expect(fe.companyLegalName?.[0]).toContain("obligatoire");
    expect(fe.termsAccepted?.[0]).toContain("conditions générales");
    expect(fe.termsAccepted?.[0]).not.toContain("Invalid input");
  });

  it("empty email says required, not invalid", () => {
    const r = registerClientSchema.safeParse({
      fullName: "Marie Dupont",
      email: "",
      phone: "+32470123456",
      password: "mot-de-passe-solide",
      isCompany: false,
      termsAccepted: true,
    });
    expect(r.success).toBe(false);
    expect(r.error.flatten().fieldErrors.email?.[0]).toContain("obligatoire");
  });

  it("valid particulier passes with identity fields only", () => {
    const r = registerClientSchema.safeParse({
      fullName: "Marie Dupont",
      email: "marie@exemple.com",
      phone: "+32470123456",
      password: "mot-de-passe-solide",
      isCompany: false,
      addressCountry: "BE",
      termsAccepted: true,
    });
    expect(r.success).toBe(true);
  });
});
