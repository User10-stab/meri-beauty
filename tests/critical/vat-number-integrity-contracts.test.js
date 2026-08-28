import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRentalRequestSchema, updateRentalRequestSchema } from "../../lib/validations/rental-request.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

const baseRequest = {
  rentalType: "Cabine privative",
  startDate: formatDateInputValue(addDays(new Date(), 30)),
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

  test("a start date before today is rejected", () => {
    const result = createRentalRequestSchema.safeParse({
      ...baseRequest,
      startDate: formatDateInputValue(addDays(new Date(), -1)),
      vatNumber: "BE0751854027",
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error.issues)).toContain("pass");
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

  test("the rental route verifies with VIES and stores the proof with the number", () => {
    const route = source("app/api/rental-requests/route.js");
    expect(route).toContain("verifyVatWithVies(vatNumber)");
    expect(route).toContain("vatValidatedAt: new Date()");
    expect(route).toContain("vatValidationName: viesResult.name ?? null");
    expect(route).toContain("vatValidationAddress: viesResult.address ?? null");
    expect(route).toContain("...vatValidation");
  });

  test.each([
    "actions/auth/register.js",
    "actions/customer/settings.js",
    "actions/customers/set-customer-vat-number.js",
    "lib/customer-vat.js",
    "actions/formations/create-formation-reservation.js",
    "actions/formations/waiting-list.js",
    "actions/workshops/create-workshop-reservation.js",
    "actions/workshops/waiting-list.js",
    "actions/salon/update-salon.js",
    "actions/staff/create-independent-staff.js",
    "actions/staff/create-staff-from-rental.js",
    "app/api/rental-requests/route.js",
  ])("%s performs a server-side VIES lookup before accepting VAT", (file) => {
    expect(source(file)).toContain("verifyVatWithVies(");
  });

  test("the rental route no longer writes the number on its own", () => {
    const route = source("app/api/rental-requests/route.js");
    expect(route).not.toMatch(/data:\s*\{\s*vatNumber\s*\}/);
  });

  test.each([
    "lib/customer-vat.js",
    "actions/workshops/create-workshop-reservation.js",
    "actions/workshops/waiting-list.js",
    "actions/formations/create-formation-reservation.js",
    "actions/formations/waiting-list.js",
  ])("%s records the VIES result it already paid for", (file) => {
    const content = source(file);
    expect(content).toContain("vatValidatedAt: new Date()");
    expect(content).toContain("vatValidationName: viesResult.name ?? null");
    expect(content).toContain("vatValidationAddress: viesResult.address ?? null");
    // And neither writes the bare number any more.
    expect(content).not.toMatch(/data:\s*\{\s*vatNumber:\s*vatNumberToSave\s*\}/);
  });

  test("product checkout exposes the same VIES field used by reservations", () => {
    const checkout = source("components/boutique/CheckoutPageClient.jsx");
    expect(checkout).toContain("verifyVatNumber(customerInfo.vatNumber)");
    expect(checkout).toContain("Numéro de TVA (optionnel)");
    expect(checkout).toContain("Vérifier");
  });

  test.each([
    "lib/customer-vat.js",
    "actions/workshops/create-workshop-reservation.js",
    "actions/workshops/waiting-list.js",
    "actions/formations/create-formation-reservation.js",
    "actions/formations/waiting-list.js",
  ])("%s reuses a matching recent VIES proof", (file) => {
    expect(source(file)).toContain("hasReusableVatValidation(");
  });

  // Checkout's own VAT saving used to duplicate this exact validate+persist
  // logic; both now delegate to lib/customer-vat.js's single implementation
  // instead of drifting between two copies. POS shares it for the same
  // reason: a counter sale's optional B2B field must be verified the same
  // way, whether the customer already existed or is created on the spot.
  test.each(["actions/boutique/orders.js", "actions/boutique/point-of-sale.js"])(
    "%s delegates VAT verification+persistence to the shared helper",
    (file) => {
      const content = source(file);
      expect(content).toContain('import { saveCheckoutVatNumber } from "@/lib/customer-vat"');
      expect(content).toContain("saveCheckoutVatNumber(");
      // The old local copy of the VIES-calling logic must not have crept back in.
      expect(content).not.toContain("verifyVatWithVies(");
      expect(content).not.toContain("vatValidationName: viesResult");
    }
  );

  test("the POS VAT field is optional and available for every payment method", () => {
    const client = source("components/dashboard/boutique/PointOfSaleClient.jsx");
    expect(client).toContain("facultatif");
    // Not gated inside any `method === "..."` branch: it lives in the general
    // customer section, so it is equally reachable for CASH, CARD_QR and
    // EXTERNAL_TERMINAL.
    expect(client).toContain('customer.vatNumber');
    expect(client).toContain("updateCustomerVat");
  });

  test.each([
    "components/boutique/CheckoutPageClient.jsx",
    "app/(public)/reservation-atelier/page.js",
    "app/(public)/reservation-formation/page.js",
  ])("%s hides repeat VAT entry behind the saved 90-day proof", (file) => {
    const content = source(file);
    expect(content).toContain("hasSavedVatProof");
    expect(content).toContain('href="/profile"');
    expect(content).toContain("90 jours");
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
