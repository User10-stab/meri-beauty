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

describe("formation dashboard visibility", () => {
  test("staff see formations they animate as well as formations they created", () => {
    const action = source("actions/formations/get-formations.js");
    expect(action).toContain("{ createdById: session.user.id }");
    expect(action).toContain("{ animator: { email: session.user.email } }");
    expect(action).toContain("sessions: { some: { animator: { email: session.user.email } } }");
    expect(action).toContain("canEdit");
    expect(action).toContain("canDelete");
    expect(action).toContain("les formations qu'il a créées ou");
  });

  test("an assigned staff member may edit without gaining deletion or reassignment rights", () => {
    const actions = source("actions/formations/create-formation.js");
    const list = source("components/dashboard/formations/FormationsPageClient.jsx");
    const row = source("components/dashboard/formations/FormationRow.jsx");
    expect(actions).toContain("allowAssignedForEdit: true");
    expect(actions).toContain("isStaffEditor && item.id");
    expect(actions).toContain("existingSessionById.get(item.id).animatorId");
    expect(list).toContain("canEdit:");
    expect(list).toContain("canDelete:");
    expect(row).toContain("onEdit={row.canEdit ? onEdit : undefined}");
    expect(row).toContain("onDelete={row.canDelete ? onDelete : undefined}");
  });
});
