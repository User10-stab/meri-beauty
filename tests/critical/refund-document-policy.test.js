import { describe, expect, test } from "vitest";
import { isBusinessRefundCustomer } from "../../lib/refunds/document-policy.js";

describe("refund document customer classification", () => {
  test("a company flag without a reusable VIES validation remains B2C", () => {
    expect(isBusinessRefundCustomer({ isCompany: true, vatNumber: null, vatValidatedAt: null })).toBe(false);
    expect(isBusinessRefundCustomer({ isCompany: true, vatNumber: "BE0751854027", vatValidatedAt: null })).toBe(false);
  });

  test("only a current VIES-validated VAT identity is B2B", () => {
    expect(
      isBusinessRefundCustomer({
        isCompany: true,
        vatNumber: "BE0751854027",
        vatValidatedAt: new Date(),
      })
    ).toBe(true);
  });
});
