import { describe, expect, it } from "vitest";
import {
  customerEmailSchema,
  isDisposableEmail,
  validateCustomerIdentity,
} from "@/lib/validations/customer-identity";

describe("customer identity validation", () => {
  it("rejects known disposable email providers", () => {
    expect(isDisposableEmail("person@mailinator.com")).toBe(true);
    expect(isDisposableEmail("person@sub.yopmail.com")).toBe(true);
    expect(customerEmailSchema.safeParse("person@tempmail.com").success).toBe(false);
  });

  it("accepts and normalizes a normal customer email", () => {
    const result = customerEmailSchema.safeParse("  Client@Example-Beauty.be ");
    expect(result.success).toBe(true);
    expect(result.data).toBe("client@example-beauty.be");
  });

  it("validates the server-side identity payload before account creation", () => {
    expect(validateCustomerIdentity({
      fullName: "Marie Dupont",
      email: "marie@example-beauty.be",
      phone: "+32 470 12 34 56",
    }, { requirePhone: true }).success).toBe(true);

    const invalid = validateCustomerIdentity({
      fullName: "M",
      email: "bot@mailinator.com",
      phone: "abc",
    }, { requirePhone: true });
    expect(invalid.success).toBe(false);
  });
});
