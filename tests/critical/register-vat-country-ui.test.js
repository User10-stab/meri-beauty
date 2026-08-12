import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("registration VAT country UX", () => {
  test("company signup only shows VIES-supported countries and syncs country from the VAT prefix", () => {
    const form = source("app/(auth)/register/register-form.js");

    expect(form).toContain("companyCountryOptions");
    expect(form).toContain("visibleCountryOptions");
    expect(form).toContain("handleVatNumberChange");
    expect(form).toContain('prefix === "EL" ? "GR"');
    expect(form).toContain('prefix === "XI" ? "GB"');
    expect(form).toContain('setValue("addressCountry", countryCode');
  });
});
