import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdminAccountSchema } from "@/lib/validations/admin-account";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// Before this, the only way to create an ADMIN account was prisma/seed.mjs —
// a CLI script requiring server/terminal access. This adds a dashboard path
// so an existing ADMIN/OWNER can create another admin without a developer.
describe("createAdminAccount is gated and never self-service", () => {
  const actions = source("actions/dashboard/admin-accounts.js");

  test("both exports require an existing ADMIN/OWNER session, not just any authenticated user", () => {
    const guard = actions.slice(
      actions.indexOf("async function requireAdminAccountAccess"),
      actions.indexOf("function buildWelcomeEmail")
    );
    expect(guard).toContain("isAdminRole(session.user.role)");

    expect(actions).toContain("export async function listAdminAccounts()");
    expect(actions).toContain("export async function createAdminAccount(input)");
    // Both call the same guard rather than reimplementing the check.
    const createFn = actions.slice(
      actions.indexOf("export async function createAdminAccount"),
      actions.length
    );
    expect(createFn).toContain("await requireAdminAccountAccess()");
  });

  test("always creates role ADMIN, never OWNER — one admin can't grant founder-level access", () => {
    const createFn = actions.slice(
      actions.indexOf("export async function createAdminAccount"),
      actions.length
    );
    expect(createFn).toContain('role: "ADMIN"');
    expect(createFn).not.toContain('role: "OWNER"');
  });

  test("password is generated, hashed with bcrypt, and never stored in plain text", () => {
    expect(actions).toContain("generateSecurePassword()");
    expect(actions).toContain("bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS)");
    const createFn = actions.slice(
      actions.indexOf("export async function createAdminAccount"),
      actions.length
    );
    expect(createFn).toContain("password: hashedPassword");
  });

  test("the plain password is only ever returned to the caller if the welcome e-mail failed to send", () => {
    expect(actions).toContain("temporaryPassword: emailResult?.success ? undefined : plainPassword");
  });

  test("handles a duplicate e-mail as a normal validation error, not a 500", () => {
    expect(actions).toContain('error?.code === "P2002"');
    expect(actions).toContain('error.meta?.target?.includes?.("email")');
  });

  test("listAdminAccounts returns every ADMIN/OWNER row, including soft-deleted ones", () => {
    const listFn = actions.slice(
      actions.indexOf("export async function listAdminAccounts"),
      actions.indexOf("async function loadMutationTarget")
    );
    expect(listFn).toContain('role: { in: ["ADMIN", "OWNER"] }');
    // Deliberately NOT filtered on isDeleted — a deleted admin must still be
    // visible so it can be restored from the same screen, or "Supprimer"
    // becomes a one-way door back to needing CLI access.
    expect(listFn).not.toMatch(/where:\s*{\s*role:[^}]*isDeleted:\s*false/);
    expect(listFn).toContain("isDeleted: true");
  });
});

// The riskiest part of this feature: an ADMIN/OWNER with dashboard access
// could otherwise deactivate/delete every other admin (including themself),
// or a plain ADMIN could strip an OWNER's access — either one is a real
// lockout, not just a UX bug. Both mutating actions route through the same
// two guards rather than reimplementing them per-action.
describe("deactivate/delete/reactivate admin accounts — lockout guards", () => {
  const actions = source("actions/dashboard/admin-accounts.js");
  const guardFn = actions.slice(
    actions.indexOf("async function loadMutationTarget"),
    actions.indexOf("async function assertAnotherActiveAdminRemains")
  );
  const remainingFn = actions.slice(
    actions.indexOf("async function assertAnotherActiveAdminRemains"),
    actions.indexOf("export async function deactivateAdminAccount")
  );

  test("nobody can act on their own account", () => {
    expect(guardFn).toContain("targetId === session.user.id");
  });

  test("a plain ADMIN can never mutate an OWNER's status — only another OWNER can", () => {
    expect(guardFn).toContain('target.role === "OWNER" && session.user.role !== "OWNER"');
  });

  test("the last-admin-standing check excludes the target itself and requires at least one OTHER active admin", () => {
    expect(remainingFn).toContain('role: { in: ["ADMIN", "OWNER"] }, isActive: true, isDeleted: false, id: { not: targetId }');
    expect(remainingFn).toMatch(/remaining === 0/);
  });

  test("deactivateAdminAccount and deleteAdminAccount both call the self/owner guard and the last-admin guard", () => {
    for (const fnName of ["deactivateAdminAccount", "deleteAdminAccount"]) {
      const fnBody = actions.slice(
        actions.indexOf(`export async function ${fnName}`),
        actions.indexOf("export async function", actions.indexOf(`export async function ${fnName}`) + 1)
      );
      expect(fnBody).toContain("await loadMutationTarget(guard.session, targetId)");
      expect(fnBody).toContain("await assertAnotherActiveAdminRemains(targetId)");
    }
  });

  test("deleteAdminAccount never issues a hard SQL delete — isDeleted is set, the row is preserved", () => {
    const fnBody = actions.slice(
      actions.indexOf("export async function deleteAdminAccount"),
      actions.indexOf("export async function reactivateAdminAccount")
    );
    expect(fnBody).not.toContain("prisma.user.delete(");
    expect(fnBody).toContain("isDeleted: true");
    expect(fnBody).toContain("deletedAt: new Date()");
  });

  test("reactivateAdminAccount skips the last-admin check — it only ever adds access back", () => {
    const fnBody = actions.slice(
      actions.indexOf("export async function reactivateAdminAccount"),
      actions.length
    );
    // Still runs the self/owner guard...
    expect(fnBody).toContain("await loadMutationTarget(guard.session, targetId)");
    // ...but never the count check, since restoring access can't cause a lockout.
    expect(fnBody).not.toContain("assertAnotherActiveAdminRemains");
    expect(fnBody).toContain("isActive: true, isDeleted: false, deletedAt: null");
  });
});

describe("admin accounts UI exposes deactivate/delete/restore with a confirm step", () => {
  const client = source("components/dashboard/settings/SalonSettingsClient.jsx");

  test("deactivate and delete both go through ConfirmDialog before calling the server action", () => {
    expect(client).toContain("deactivateAdminAccount");
    expect(client).toContain("deleteAdminAccount");
    expect(client).toContain("reactivateAdminAccount");
    expect(client).toContain("<ConfirmDialog");
    expect(client).toContain("pendingAction");
  });

  test("the current user's own row has no action buttons rendered", () => {
    expect(client).toContain("const isSelf = admin.id === currentUserId");
    const actionsCell = client.slice(client.indexOf("{isSelf ? ("), client.indexOf("{isSelf ? (") + 300);
    expect(actionsCell).toContain("—");
  });
});

describe("createAdminAccountSchema", () => {
  test("accepts a valid full name and email", () => {
    const result = createAdminAccountSchema.safeParse({ fullName: "Sophie Dupont", email: "sophie@example.com" });
    expect(result.success).toBe(true);
  });

  test("lowercases and trims the e-mail", () => {
    const result = createAdminAccountSchema.safeParse({ fullName: "Sophie Dupont", email: "  Sophie@Example.COM  " });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe("sophie@example.com");
  });

  test("rejects a missing or too-short name", () => {
    expect(createAdminAccountSchema.safeParse({ fullName: "S", email: "sophie@example.com" }).success).toBe(false);
    expect(createAdminAccountSchema.safeParse({ fullName: "", email: "sophie@example.com" }).success).toBe(false);
  });

  test("rejects an invalid e-mail", () => {
    expect(createAdminAccountSchema.safeParse({ fullName: "Sophie Dupont", email: "not-an-email" }).success).toBe(false);
  });
});

describe("dashboard settings page wires the admin-accounts UI", () => {
  test("Paramètres page fetches admins server-side and passes them down, matching the salon-data pattern", () => {
    const page = source("app/dashboard/settings/page.jsx");
    expect(page).toContain("listAdminAccounts()");
    expect(page).toContain("initialAdmins={admins}");
  });

  test("settings client exposes the create-admin form, not a raw fetch-on-mount", () => {
    const client = source("components/dashboard/settings/SalonSettingsClient.jsx");
    expect(client).toContain("createAdminAccount");
    expect(client).toContain("Ajouter un administrateur");
    expect(client).toContain("initialAdmins");
  });
});
