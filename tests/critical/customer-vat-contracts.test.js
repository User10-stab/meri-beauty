import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/vat-validation", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, verifyVatWithVies: vi.fn() };
});

const { saveCheckoutVatNumber } = await import("@/lib/customer-vat");
const { verifyVatWithVies } = await import("@/lib/vat-validation");

function fakeClient(user) {
  return { user: { update: vi.fn(async ({ data }) => ({ ...user, ...data })) } };
}

const BASE_USER = { id: "u1", isCompany: false, vatNumber: null, vatValidatedAt: null };

describe("saveCheckoutVatNumber — shared by online checkout and POS", () => {
  test("a blank number is a no-op success — the field is optional (B2C)", async () => {
    const client = fakeClient(BASE_USER);
    const result = await saveCheckoutVatNumber(client, BASE_USER, "");
    expect(result).toEqual({ success: true, user: BASE_USER });
    expect(client.user.update).not.toHaveBeenCalled();
    expect(verifyVatWithVies).not.toHaveBeenCalled();
  });

  test("a malformed number fails without ever calling VIES", async () => {
    const client = fakeClient(BASE_USER);
    const result = await saveCheckoutVatNumber(client, BASE_USER, "not-a-vat-number");
    expect(result.success).toBe(false);
    expect(verifyVatWithVies).not.toHaveBeenCalled();
    expect(client.user.update).not.toHaveBeenCalled();
  });

  test("a well-formed number VIES rejects fails the whole sale, not a silent drop", async () => {
    verifyVatWithVies.mockResolvedValueOnce({ success: true, valid: false });
    const client = fakeClient(BASE_USER);
    const result = await saveCheckoutVatNumber(client, BASE_USER, "BE0751854027");
    expect(result.success).toBe(false);
    expect(client.user.update).not.toHaveBeenCalled();
  });

  test("VIES being down fails closed rather than saving an unverified number", async () => {
    verifyVatWithVies.mockResolvedValueOnce({ success: false, message: "VIES indisponible." });
    const client = fakeClient(BASE_USER);
    const result = await saveCheckoutVatNumber(client, BASE_USER, "BE0751854027");
    expect(result.success).toBe(false);
    expect(client.user.update).not.toHaveBeenCalled();
  });

  test("a VIES-valid number is persisted with its full proof — works for a brand-new customer too", async () => {
    verifyVatWithVies.mockResolvedValueOnce({ success: true, valid: true, name: "Acme SPRL", address: "Bruxelles" });
    const client = fakeClient(BASE_USER);
    const result = await saveCheckoutVatNumber(client, BASE_USER, "BE0751854027");
    expect(result.success).toBe(true);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({
        isCompany: true,
        vatNumber: "BE0751854027",
        vatValidationName: "Acme SPRL",
        vatValidationAddress: "Bruxelles",
      }),
    });
  });

  test("re-submitting the same already-validated number skips VIES (reusable within 90 days)", async () => {
    const validated = {
      id: "u2",
      isCompany: true,
      vatNumber: "BE0751854027",
      vatValidatedAt: new Date(),
    };
    const client = fakeClient(validated);
    const result = await saveCheckoutVatNumber(client, validated, "BE 0751 854 027");
    expect(result).toEqual({ success: true, user: validated });
    expect(verifyVatWithVies).not.toHaveBeenCalled();
    expect(client.user.update).not.toHaveBeenCalled();
  });

  test("an existing customer with no VAT number on file gets one verified and attached", async () => {
    verifyVatWithVies.mockResolvedValueOnce({ success: true, valid: true, name: "Nail Pro SRL", address: null });
    const existingNoVat = { id: "u3", isCompany: false, vatNumber: null, vatValidatedAt: null };
    const client = fakeClient(existingNoVat);
    const result = await saveCheckoutVatNumber(client, existingNoVat, "BE0403201185");
    expect(result.success).toBe(true);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "u3" },
      data: expect.objectContaining({ isCompany: true, vatNumber: "BE0403201185" }),
    });
  });
});

describe("POS wires the shared helper before pricing so the invoice reflects it", () => {
  test("completePointOfSaleSale calls saveCheckoutVatNumber before resolveGoodsVatPolicy", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../../actions/boutique/point-of-sale.js", import.meta.url)),
      "utf8"
    );
    const vatSaveIndex = source.indexOf("saveCheckoutVatNumber(tx, customer");
    const policyIndex = source.indexOf("resolveGoodsVatPolicy({ customer })");
    expect(vatSaveIndex).toBeGreaterThan(-1);
    expect(policyIndex).toBeGreaterThan(vatSaveIndex);
  });
});
