import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  canAccessStaffPermission,
  DEFAULT_STAFF_PERMISSIONS,
  ROLES,
  STAFF_PERMISSIONS,
} from "../../lib/authorization.js";
import { getNavDataForRole } from "../../components/dashboard/Layouts/sidebar/data/index.js";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function visibleUrls(nav) {
  return nav.flatMap((section) =>
    section.items.flatMap((item) => [item.url, ...(item.items ?? []).map((child) => child.url)])
  ).filter(Boolean);
}

describe("granular staff dashboard permissions", () => {
  it("keeps administrators unrestricted and staff least-privileged by default", () => {
    expect(canAccessStaffPermission(ROLES.ADMIN, [], STAFF_PERMISSIONS.POINT_OF_SALE)).toBe(true);
    expect(canAccessStaffPermission(ROLES.STAFF, [], STAFF_PERMISSIONS.POINT_OF_SALE)).toBe(false);
    expect(DEFAULT_STAFF_PERMISSIONS).toEqual([
      STAFF_PERMISSIONS.APPOINTMENTS,
      STAFF_PERMISSIONS.SERVICES,
      STAFF_PERMISSIONS.CUSTOMERS,
      STAFF_PERMISSIONS.FORMATIONS,
      STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
      STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
      STAFF_PERMISSIONS.NEWSLETTER,
    ]);
  });

  it("does not expose the whole boutique when only the cash register is granted", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.STAFF, [STAFF_PERMISSIONS.POINT_OF_SALE]));
    expect(urls).toContain("/dashboard/boutique/point-of-sale");
    expect(urls).not.toContain("/dashboard/boutique/caisse");
    expect(urls).not.toContain("/dashboard/boutique/products");
    expect(urls).not.toContain("/dashboard/boutique/stock");
    expect(urls).not.toContain("/dashboard/boutique/orders");
    expect(urls).not.toContain("/dashboard/boutique/returns");
  });

  it("enforces sensitive boutique permissions in server actions", () => {
    expect(read("actions/boutique/point-of-sale.js")).toContain("STAFF_PERMISSIONS.POINT_OF_SALE");
    expect(read("actions/dashboard/cash-sessions.js")).toContain("STAFF_PERMISSIONS.CASH_REGISTER");
    expect(read("actions/boutique/orders.js")).toContain("STAFF_PERMISSIONS.ORDERS");
    expect(read("actions/boutique/returns.js")).toContain("STAFF_PERMISSIONS.RETURNS");
    expect(read("actions/boutique/stock.js")).toContain("STAFF_PERMISSIONS.BOUTIQUE_STOCK");
    const dashboardStats = read("actions/dashboard/get-dashboard-stats.js");
    expect(dashboardStats).toContain("const canSeeOrders");
    expect(dashboardStats).toContain("isAdmin ? prisma.payment.findMany");
  });

  it("persists the permission list on Staff", () => {
    expect(read("prisma/schema.prisma")).toContain("dashboardPermissions String[]");
    expect(read("actions/staff/update-independent-staff.js")).toContain("dashboardPermissions");
    expect(read("components/dashboard/staff/StaffPermissionsField.jsx")).toContain("Les droits non cochés sont masqués");
  });

  it("scopes staff customers and newsletters to their appointments and formations", () => {
    const customerScope = read("lib/staff-customer-scope.js");
    const newsletter = read("actions/newsletter/send-newsletter.js");
    const formations = read("actions/formations/get-reservations.js");
    expect(customerScope).toContain("formationReservations");
    expect(customerScope).toContain('status: { in: ["CONFIRMED", "COMPLETED"] }');
    expect(newsletter).toContain("marketingEligibleOnly: true");
    expect(formations).toContain("createdById: session.user.id");
  });
});
