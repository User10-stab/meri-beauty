import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { testTag } from "./helpers.js";

// The database path is real; the external VIES response is deterministic.
const authMock = vi.fn();
const { verifyVatWithViesMock } = vi.hoisted(() => ({ verifyVatWithViesMock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/vat-validation", async (importOriginal) => ({
  ...(await importOriginal()),
  verifyVatWithVies: verifyVatWithViesMock,
}));

const { prisma } = await import("@/lib/prisma");
const { setCustomerVatNumberManually } = await import("@/actions/customers/set-customer-vat-number");

const tag = testTag();
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

function sessionFor(user) {
  return { user: { id: user.id, role: user.role } };
}

describe("staff manual VAT number override", () => {
  let admin, customer;

  beforeAll(async () => {
    verifyVatWithViesMock.mockResolvedValue({ success: true, valid: true, name: "Meri Company", address: "Bruxelles" });
    admin = await prisma.user.create({
      data: { fullName: `${tag}-admin`, email: `${tag}-admin@example.test`, phone: uniquePhone(), password: "x", role: "ADMIN", emailVerified: true },
    });
    customer = await prisma.user.create({
      data: { fullName: `${tag}-customer`, email: `${tag}-customer@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "User", entityId: customer.id } });
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, customer.id] } } });
  });

  test("a non-admin cannot override a customer's VAT number", async () => {
    authMock.mockResolvedValue(sessionFor(customer));

    const result = await setCustomerVatNumberManually(customer.id, "BE0751854027");

    expect(result.success).toBe(false);

    const unchanged = await prisma.user.findUnique({ where: { id: customer.id } });
    expect(unchanged.vatNumber).toBeNull();
  });

  test("an admin cannot save a badly-formatted VAT number, even manually", async () => {
    authMock.mockResolvedValue(sessionFor(admin));

    const result = await setCustomerVatNumberManually(customer.id, "not-a-vat-number");

    expect(result.success).toBe(false);

    const unchanged = await prisma.user.findUnique({ where: { id: customer.id } });
    expect(unchanged.vatNumber).toBeNull();
  });

  test("an admin can save a VIES-validated VAT number and it is audit-logged", async () => {
    authMock.mockResolvedValue(sessionFor(admin));

    const result = await setCustomerVatNumberManually(customer.id, "BE0751854027");

    expect(result.success).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: customer.id } });
    expect(updated.vatNumber).toBe("BE0751854027");
    expect(updated.vatValidatedAt).toBeInstanceOf(Date);
    expect(updated.vatValidationName).toBe("Meri Company");
    expect(verifyVatWithViesMock).toHaveBeenCalledWith("BE0751854027");

    const logs = await prisma.auditLog.findMany({ where: { entityType: "User", entityId: customer.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("customer.vat_number_overridden");
    expect(logs[0].actorId).toBe(admin.id);
    expect(logs[0].after).toMatchObject({ vatNumber: "BE0751854027" });
  });

  test("an admin can clear a customer's VAT number", async () => {
    authMock.mockResolvedValue(sessionFor(admin));

    const result = await setCustomerVatNumberManually(customer.id, "");

    expect(result.success).toBe(true);

    const updated = await prisma.user.findUnique({ where: { id: customer.id } });
    expect(updated.vatNumber).toBeNull();
  });
});
