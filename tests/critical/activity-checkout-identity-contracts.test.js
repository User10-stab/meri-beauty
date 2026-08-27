import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

const PAGES = [
  "app/(public)/reservation-atelier/page.js",
  "app/(public)/reservation-formation/page.js",
];

const RESERVATION_ACTIONS = [
  "actions/workshops/create-workshop-reservation.js",
  "actions/formations/create-formation-reservation.js",
];

describe("activity checkout identity", () => {
  test.each(PAGES)("%s reuses the signed-in profile and reports a missing phone", (file) => {
    const page = source(file);

    expect(page).toContain("getMyCheckoutProfile");
    expect(page).toContain("session.user.fullName");
    expect(page).toContain("result.data.phone || prev.phone");
    expect(page).not.toContain('phone: "",\n      }));');
    expect(page).toContain('requiredErrors.phone = "Le numéro de téléphone est obligatoire."');
    expect(page).toContain("Veuillez compléter les champs indiqués avant de continuer.");
    expect(page.match(/name="fullName"/g)).toHaveLength(1);
    expect(page).toContain("noValidate");
  });

  test("the checkout profile exposes only the contact and VAT fields the form needs", () => {
    const settings = source("actions/customer/settings.js");

    expect(settings).toContain("export async function getMyCheckoutProfile");
    for (const field of ["fullName: true", "email: true", "phone: true", "vatNumber: true"]) {
      expect(settings).toContain(field);
    }
    expect(settings).toContain('user.phone?.startsWith("temp-") ? ""');
  });

  test.each(RESERVATION_ACTIONS)("%s trusts the account identity and requires a phone server-side", (file) => {
    const action = source(file);

    expect(action).toContain("const authSession = await auth()");
    expect(action).toContain("fullName: authenticatedUser.fullName");
    expect(action).toContain("email: authenticatedUser.email");
    expect(action).toContain("phone: storedPhone || customerInfo.phone");
    expect(action).toContain("validateCustomerIdentity(customerInfo, { requirePhone: true })");
    expect(action).toContain("needsPhoneBackfill");
  });

  test.each([
    "actions/workshops/waiting-list.js",
    "actions/formations/waiting-list.js",
  ])("%s also rejects a missing phone", (file) => {
    expect(source(file)).toContain("validateCustomerIdentity(customerInfo, { requirePhone: true })");
  });
});
