import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("formation staff assignment", () => {
  test("lists active staff accounts instead of unrelated animator profiles", () => {
    const options = source("actions/formations/get-formation-staff.js");
    expect(options).toContain("isActive: true");
    expect(options).toContain('role: "STAFF"');
    expect(options).toContain("getFormationStaffOptions");
  });

  test("forces staff creators to assign formations and sessions to themselves", () => {
    const actions = source("actions/formations/create-formation.js");
    expect(actions).toContain("isAdminRole(session.user.role) ? requestedStaffUserId : session.user.id");
    expect(actions).toContain("resolveFormationAnimatorId(session, item.staffUserId)");
  });

  test("only renders the staff selector for admins", () => {
    const modal = source("components/dashboard/formations/CreateFormationModal.jsx");
    expect(modal).toContain("canAssignStaff ? (");
    expect(modal).toContain("staffOptions.map((staff)");
  });
});
