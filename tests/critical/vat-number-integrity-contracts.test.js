import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRentalRequestSchema, updateRentalRequestSchema } from "../../lib/validations/rental-request.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const baseRequest = {
  rentalType: "Cabine privative",
  startDate: "2026-09-01",
  commissionType: "FIXED",
  specialty: "Coiffure",
};

// The rental form marks the VAT field with a red asterisk and sets `required`,
// but that is browser-only: the schema behind the POST route accepted the
// field missing, and accepted any string up to 50 characters when present.
// A rental request opens a B2B relationship that Marie invoices monthly.
describe("the rental request VAT number is really validated", () => {
  test("a request without a VAT number is rejected, in French", () => {
    const result = createRentalRequestSchema.safeParse(baseRequest);
    expect(result.success).toBe(false);
    // Guards the Zod 4 trap: `required_error` compiles but is ignored at
    // runtime, so the customer would get Zod's English default instead.
    expect(JSON.stringify(result.error.issues)).toContain("obligatoire");
    expect(JSON.stringify(result.error.issues)).not.toContain("Invalid input");
  });

  test.each([["abc"], ["123"], ["bonjour"], ["BE1234567890"], [""]])(
    "%s is rejected as a VAT number",
    (vatNumber) => {
      const result = createRentalRequestSchema.safeParse({ ...baseRequest, vatNumber });
      expect(result.success).toBe(false);
    }
  );

  test("a real Belgian number passes and is normalised", () => {
    // The salon's own number, with the punctuation people actually type.
    const result = createRentalRequestSchema.safeParse({
      ...baseRequest,
      vatNumber: "BE 0751.854.027",
    });
    expect(result.success).toBe(true);
    expect(result.data.vatNumber).toBe("BE0751854027");
  });

  test("a number failing the Belgian checksum is rejected, not just bad shapes", () => {
    // Correct length and prefix, wrong check digits.
    const result = createRentalRequestSchema.safeParse({ ...baseRequest, vatNumber: "BE0751854028" });
    expect(result.success).toBe(false);
  });

  test("admin edits do not have to resend the number, but a bad one still fails", () => {
    expect(updateRentalRequestSchema.safeParse({ id: "abc", status: "APPROVED" }).success).toBe(true);
    expect(updateRentalRequestSchema.safeParse({ id: "abc", vatNumber: "nope" }).success).toBe(false);
  });
});

// User.vatNumber is paired with vatValidatedAt / vatValidationName /
// vatValidationAddress. lib/tax-policy.js#hasRecentVatValidation reads the
// timestamp to decide reverse-charge, so the two must never drift apart.
describe("a VAT number is never stored apart from its verification proof", () => {
  test("tax policy really does gate on the timestamp", () => {
    const policy = source("lib/tax-policy.js");
    expect(policy).toContain("customer?.vatValidatedAt");
  });

  test("the rental route clears the proof when the number changes", () => {
    const route = source("app/api/rental-requests/route.js");
    expect(route).toContain("current?.vatNumber !== vatNumber");
    expect(route).toContain("vatValidatedAt: null");
    expect(route).toContain("vatValidationName: null");
    expect(route).toContain("vatValidationAddress: null");
  });

  test("the rental route no longer writes the number on its own", () => {
    const route = source("app/api/rental-requests/route.js");
    expect(route).not.toMatch(/data:\s*\{\s*vatNumber\s*\}/);
  });

  test.each([
    "actions/workshops/create-workshop-reservation.js",
    "actions/formations/create-formation-reservation.js",
  ])("%s records the VIES result it already paid for", (file) => {
    const content = source(file);
    expect(content).toContain("vatValidatedAt: new Date()");
    expect(content).toContain("vatValidationName: viesResult.name ?? null");
    expect(content).toContain("vatValidationAddress: viesResult.address ?? null");
    // Both the create and the update path carry it.
    expect(content.match(/\.\.\.\(vatValidation \?\? \{\}\)/g)).toHaveLength(2);
    // And neither writes the bare number any more.
    expect(content).not.toMatch(/data:\s*\{\s*vatNumber:\s*vatNumberToSave\s*\}/);
  });
});

describe("the VAT module's own messages are not mojibake", () => {
  test("no double-encoded accents survive in user-facing strings", () => {
    const lib = source("lib/vat-validation.js");
    for (const broken of ["Ã©", "Ãª", "Ã¨", "Ã "]) {
      expect(lib).not.toContain(broken);
    }
    expect(lib).toContain("Numéro de TVA invalide.");
    expect(lib).toContain("Le service européen de vérification (VIES)");
  });
});
