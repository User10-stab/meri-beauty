import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { syncAccountVatNumber, findKnownVatNumber } from "@/lib/vat/account-vat";
import { createIndependentStaffSchema, updateIndependentStaffSchema } from "@/lib/validations/independent-staff";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Julie Schoemans, 17/09/2026: VIES-validated BE0542845058 on her customer
 * account (invoice F-2026-000009), nothing at all on her staff profile — so
 * she had sales of her own she could not issue a single document for, while
 * the number sat one table away.
 */
const JULIE_VAT = "BE0542845058";

function clientMock({ user = null } = {}) {
  return {
    user: { update: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(user) },
    staff: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe("one person, one VAT number", () => {
  it("writes the number to the customer account and the staff profile at once", async () => {
    const client = clientMock();
    const validatedAt = new Date("2026-09-17T08:00:00Z");
    const result = await syncAccountVatNumber(client, { userId: "u1", vatNumber: "be 0542845058", validatedAt, viesName: "SCHOEMANS" });

    expect(result).toEqual({ normalized: JULIE_VAT, staffUpdated: 1 });
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ isCompany: true, vatNumber: JULIE_VAT, vatValidatedAt: validatedAt, vatValidationName: "SCHOEMANS" }),
    });
    expect(client.staff.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", isDeleted: false },
      data: { vatNumber: JULIE_VAT },
    });
  });

  it("holding a VAT number makes the account a business, like issueInvoice's own rule", async () => {
    const client = clientMock();
    await syncAccountVatNumber(client, { userId: "u1", vatNumber: JULIE_VAT });
    expect(client.user.update.mock.calls[0][0].data.isCompany).toBe(true);
    // Not validated by VIES this time: the old confirmation must not stand for a number it never saw.
    expect(client.user.update.mock.calls[0][0].data.vatValidatedAt).toBeNull();
  });

  it("never throws for someone who has no staff profile", async () => {
    const client = clientMock();
    client.staff.updateMany.mockResolvedValue({ count: 0 });
    await expect(syncAccountVatNumber(client, { userId: "u_customer", vatNumber: JULIE_VAT })).resolves.toEqual({
      normalized: JULIE_VAT,
      staffUpdated: 0,
    });
  });

  it("finds the number already held on either account, preferring the VIES-validated one", async () => {
    const validated = await findKnownVatNumber(
      clientMock({ user: { id: "u1", vatNumber: JULIE_VAT, vatValidatedAt: new Date("2026-09-07T00:00:00Z"), staff: { vatNumber: null } } }),
      { userId: "u1" }
    );
    expect(validated.vatNumber).toBe(JULIE_VAT);

    const fromStaff = await findKnownVatNumber(
      clientMock({ user: { id: "u2", vatNumber: null, vatValidatedAt: null, staff: { vatNumber: "BE0660.821.903" } } }),
      { email: "lylyht.mylitha@gmail.com" }
    );
    expect(fromStaff).toEqual({ vatNumber: "BE0660821903", validatedAt: null });

    expect(await findKnownVatNumber(clientMock(), { userId: "nobody" })).toBeNull();
  });
});

describe("an independent staff profile can be created without a VAT number", () => {
  // Policy reversed 2026-09-18: onboarding must not block on a number the
  // admin doesn't have yet (same for the professional address below). She
  // just can't issue her own invoices until one is added — see
  // createIndependentStaff/createStaffFromRental, which skip the VIES round
  // trip entirely when vatNumber is blank instead of rejecting the form.
  const base = {
    fullName: "Julie Schoemans",
    email: "julieschoemans@gmail.com",
    phone: "+32470000000",
    languages: ["fr"],
    yearsOfExperience: 3,
    contract: { fixedRent: 300, startDate: "2026-09-01" },
  };

  it("accepts a missing or empty number at creation", () => {
    for (const vatNumber of [undefined, "", "   "]) {
      expect(createIndependentStaffSchema.safeParse({ ...base, vatNumber }).success).toBe(true);
    }
  });

  it("still refuses a number that isn't a real EU one, and accepts a valid one", () => {
    expect(createIndependentStaffSchema.safeParse({ ...base, vatNumber: "0542845058" }).success).toBe(false);
    // Julie's own number with one digit changed: right shape, wrong Belgian checksum.
    expect(createIndependentStaffSchema.safeParse({ ...base, vatNumber: "BE0542845059" }).success).toBe(false);
    expect(createIndependentStaffSchema.safeParse({ ...base, vatNumber: JULIE_VAT }).success).toBe(true);
  });

  it("also accepts a missing professional address at creation", () => {
    for (const field of ["addressLine1", "addressCity", "addressPostalCode", "addressCountry"]) {
      expect(createIndependentStaffSchema.safeParse({ ...base, [field]: "" }).success).toBe(true);
      expect(createIndependentStaffSchema.safeParse({ ...base, [field]: undefined }).success).toBe(true);
    }
  });

  it("still requires a VAT number when editing, so a profile that already needs one can't go blank", () => {
    const edit = { ...base, id: "staff_1", isActive: true };
    expect(updateIndependentStaffSchema.safeParse({ ...edit, vatNumber: "" }).success).toBe(false);
    expect(updateIndependentStaffSchema.safeParse({ ...edit, vatNumber: JULIE_VAT }).success).toBe(true);
  });
});

describe("the screens that learn a VAT number pass it on", () => {
  it("a customer validating their number pushes it onto their staff profile", () => {
    const settings = source("actions/customer/settings.js");
    expect(settings).toContain("syncAccountVatNumber(prisma, {");
    expect(settings).toContain("validatedAt: new Date(),");
  });

  it("the edit form shows the number instead of hiding it, so a missing one can be fixed", () => {
    const edit = source("components/dashboard/staff/EditStaffModal.jsx");
    expect(edit).not.toContain('<input type="hidden" {...register("vatNumber")} />');
    expect(edit).toContain('<Label htmlFor="editVatNumber" icon={Hash} required>Numéro de TVA</Label>');
    // Creation itself no longer marks it required — see the schema change above.
    expect(source("components/dashboard/staff/CreateStaffModal.jsx")).toContain('<Label htmlFor="vatNumber" icon={Hash}>');
  });

  it("an unchanged number doesn't spend a VIES call, but still backfills the customer account", () => {
    const update = source("actions/staff/update-independent-staff.js");
    expect(update).toContain("const vatChanged = normalizedVat !== normalizeVatNumber(existing.vatNumber);");
    expect(update).toContain("if (vatChanged) {");
    expect(update).toContain("where: { id: existing.userId, NOT: { vatNumber: normalizedVat } },");
  });

  it("a VIES outage still lets the salon onboard, unvalidated, like every sale entry point", () => {
    const gate = source("lib/vat/account-vat.js");
    expect(gate).toContain("if (isViesOutage(vies)) {");
    expect(gate).toContain("validatedAt: null");
    expect(gate).toContain("if (!vies.valid) {");
  });
});
