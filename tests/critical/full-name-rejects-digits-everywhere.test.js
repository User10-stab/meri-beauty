import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

// 31 Aug 2026: a real customer (fullName "User122") was permanently stuck on
// the atelier/formation booking page with zero feedback — the booking
// validator (lib/validations/customer-identity.js) was the only fullName
// check in the whole app that rejected digits. Registration, the profile
// editor, admin/staff account creation, POS walk-ins, and checkout all
// accepted a digit-bearing name outright, so an account could pass every one
// of those and only discover it was unbookable the first time it tried to
// book — by which point there was no UI left that could show why (see
// booking-field-errors-are-visible.test.js for that half of the fix).
//
// Centralizing on one exported fullNameSchema means every entry point that
// creates or edits a User.fullName enforces the same rule and reports the
// same specific message, instead of seven schemas that can drift again.
describe("fullNameSchema rejects digits with a specific, actionable message", () => {
  test("digits are rejected before the generic character check, with their own message", async () => {
    const { fullNameSchema } = await import("@/lib/validations/customer-identity.js");

    const digit = fullNameSchema.safeParse("User122");
    expect(digit.success).toBe(false);
    expect(digit.error.issues[0].message).toBe("Le nom ne peut pas contenir de chiffres.");

    const symbol = fullNameSchema.safeParse("User@@@");
    expect(symbol.success).toBe(false);
    expect(symbol.error.issues[0].message).toContain("lettres, espaces, apostrophes et tirets");

    const valid = fullNameSchema.safeParse("Marie-Ève O'Brien");
    expect(valid.success).toBe(true);
  });

  test("is exported for reuse, not kept private to this file", () => {
    const file = source("lib/validations/customer-identity.js");
    expect(file).toContain("export const fullNameSchema");
  });
});

describe("every place a name creates or edits a real account imports the shared schema", () => {
  const cases = [
    ["registration", "lib/validations/register.js", "fullName: fullNameSchema"],
    ["profile self-edit", "lib/validations/staff-settings.js", "fullName: fullNameSchema.optional()"],
    ["admin/staff account creation", "lib/validations/admin-account.js", "fullName: fullNameSchema"],
    ["independent staff onboarding", "lib/validations/independent-staff.js", "fullName: fullNameSchema"],
    ["POS walk-in customer", "lib/validations/point-of-sale.js", "fullName: fullNameSchema"],
    ["guest checkout", "lib/validations/commerce.js", "fullName: fullNameSchema"],
  ];

  for (const [label, path, expected] of cases) {
    test(`${label} (${path})`, () => {
      const file = source(path);
      expect(file).toContain('from "@/lib/validations/customer-identity"');
      expect(file).toContain(expected);
      // None of these should still carry their own duplicate, drift-prone
      // fullName length/regex check now that they import the shared one.
      expect(file).not.toMatch(/fullName:\s*z\s*\n?\s*\.string/);
    });
  }
});
