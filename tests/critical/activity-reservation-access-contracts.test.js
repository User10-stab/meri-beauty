import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("staff activity reservation operations", () => {
  const access = source("lib/activity-reservation-access.js");

  test("uses separate, opt-in permissions for attendance and settlement", () => {
    const authorization = source("lib/authorization.js");
    expect(authorization).toContain('ACTIVITY_ATTENDANCE: "ACTIVITY_ATTENDANCE"');
    expect(authorization).toContain('ACTIVITY_SETTLEMENTS: "ACTIVITY_SETTLEMENTS"');
    const defaults = authorization.slice(
      authorization.indexOf("export const DEFAULT_STAFF_PERMISSIONS"),
      authorization.indexOf("export const STAFF_PERMISSION_OPTIONS")
    );
    expect(defaults).not.toContain("ACTIVITY_SETTLEMENTS");
    expect(defaults).not.toContain("ACTIVITY_ATTENDANCE");
  });

  test("keeps a session animator within that session while allowing the creator or main animator across the item", () => {
    expect(access).toContain("{ createdById: user.id }");
    expect(access).toContain("{ animator: { email: user.email } }");
    expect(access).toContain("session: {");
  });

  test("enforces the row scope again in the server action guard", () => {
    expect(access).toContain("where: { id: reservationId, ...activityReservationStaffScope(kind, user) }");
  });
});
