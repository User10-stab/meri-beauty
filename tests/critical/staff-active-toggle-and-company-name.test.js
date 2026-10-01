import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn().mockResolvedValue(null) } } }));

import { buildStaffCustomer } from "@/lib/staff-rent-payment";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * « Activer / Désactiver » in the auto-entrepreneur table sent a partial
 * payload to the full-profile update: it failed validation every time, and
 * had it passed it would have wiped the VAT number, photo, experience, rythme
 * and every service assignment. It now has its own action.
 */
describe("staff active toggle", () => {
  it("calls the dedicated action, never the full-profile update", () => {
    const table = source("components/dashboard/staff/StaffTable.jsx");
    expect(table).toContain("setIndependentStaffActive({ id: staff.id, isActive: !staff.isActive })");
    expect(table).not.toContain("updateIndependentStaff");
  });

  it("writes isActive (and the session bump) only", () => {
    const action = source("actions/staff/set-independent-staff-active.js");
    expect(action).toContain("prisma.staff.update({ where: { id }, data: { isActive } })");
    expect(action).toMatch(/data: \{ isActive, \.\.\.\(isActive \? \{\} : \{ sessionVersion: \{ increment: 1 \} \}\) \}/);
  });
});

/**
 * 2026-09-28: an independent's « Nom d'entreprise » is the « Entreprise » line
 * of her next rent invoices; her own name stays under « À l'attention de ».
 * Invoices already issued keep their own copy of the buyer.
 */
describe("staff company name on rent invoices", () => {
  const user = { id: "u1", fullName: "Julie Schoemans", email: "julie@example.com", vatNumber: "BE0542845058" };

  it("prints the company as Entreprise and the person as contact", async () => {
    const customer = await buildStaffCustomer({ vatNumber: null, companyName: "  JS Beauty SRL " }, user);
    expect(customer.legalName).toBe("JS Beauty SRL");
    expect(customer.billingContactName).toBe("Julie Schoemans");
    expect(customer.fullName).toBe("Julie Schoemans");
  });

  it("falls back to the old behaviour when blank", async () => {
    const customer = await buildStaffCustomer({ vatNumber: null, companyName: "  " }, user);
    expect(customer.legalName).toBeNull();
    expect(customer.billingContactName).toBeNull();
  });

  it("the update keeps a stored name when the field is absent", () => {
    const action = source("actions/staff/update-independent-staff.js");
    expect(action).toContain("...(companyName !== undefined ? { companyName: companyName?.trim() || null } : {}),");
  });
});

/**
 * 2026-10-01: « Nom professionnel », when filled in, replaces her account's
 * full name on the invoice (« À l'attention de »). It never takes the
 * « Entreprise » line — that stays « Nom d'entreprise ». Blank = unchanged.
 */
describe("staff professional name on rent invoices", () => {
  const user = { id: "u2", fullName: "Lyly Hannecart", email: "lyly@example.com", vatNumber: "BE0660821903" };

  it("replaces her full name, the company stays Entreprise", async () => {
    const customer = await buildStaffCustomer({ vatNumber: null, companyName: "Mylitha", professionalName: " Aurélie Hannecart " }, user);
    expect(customer.legalName).toBe("Mylitha");
    expect(customer.billingContactName).toBe("Aurélie Hannecart");
    expect(customer.fullName).toBe("Aurélie Hannecart");
  });

  it("without a company name it is simply her name on the invoice", async () => {
    const customer = await buildStaffCustomer({ vatNumber: null, companyName: null, professionalName: "Aurélie Hannecart" }, user);
    expect(customer.legalName).toBeNull();
    expect(customer.fullName).toBe("Aurélie Hannecart");
  });

  it("blank keeps her account name", async () => {
    const customer = await buildStaffCustomer({ vatNumber: null, companyName: "Mylitha", professionalName: "  " }, user);
    expect(customer.legalName).toBe("Mylitha");
    expect(customer.billingContactName).toBe("Lyly Hannecart");
    expect(customer.fullName).toBe("Lyly Hannecart");
  });

  it("is read by every rent issuing path and kept on update when absent", () => {
    for (const file of ["lib/staff-rent-payment.js", "lib/invoices/invoice-preview.js", "actions/invoices/staff-rent.js"]) {
      expect(source(file)).toContain("companyName: true, professionalName: true, user: true");
    }
    expect(source("actions/staff/update-independent-staff.js")).toContain(
      "...(professionalName !== undefined ? { professionalName: professionalName?.trim() || null } : {}),"
    );
  });
});
