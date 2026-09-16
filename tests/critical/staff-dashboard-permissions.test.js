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
    expect(canAccessStaffPermission(ROLES.STAFF, [], STAFF_PERMISSIONS.ACTIVITY_SETTLEMENTS)).toBe(false);
    expect(canAccessStaffPermission(ROLES.STAFF, [], STAFF_PERMISSIONS.ACTIVITY_ATTENDANCE)).toBe(false);
    expect(DEFAULT_STAFF_PERMISSIONS).toEqual([
      STAFF_PERMISSIONS.APPOINTMENTS,
      STAFF_PERMISSIONS.SERVICES,
      STAFF_PERMISSIONS.CUSTOMERS,
      STAFF_PERMISSIONS.FORMATIONS,
      STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
      STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
      STAFF_PERMISSIONS.NEWSLETTER,
      // SEND_TICKET_EMAIL was a default until 16/09/2026. A ticket carries
      // the salon's name and VAT number, and every practitioner here is
      // legally independent — her sale is hers to document. See
      // canSendTicketEmail(), which no longer reads this list at all.
    ]);
  });

  it("the salon account gets the till screens without exposing the rest of the boutique", () => {
    // Caisse, Livre de caisse and Commandes follow the account (admin + Marie),
    // not a permission; products/stock/returns keep their own permissions.
    const urls = visibleUrls(getNavDataForRole(ROLES.STAFF, [], { isSalonAccount: true }));
    expect(urls).toContain("/dashboard/boutique/point-of-sale");
    expect(urls).toContain("/dashboard/boutique/caisse");
    expect(urls).toContain("/dashboard/boutique/orders");
    expect(urls).not.toContain("/dashboard/boutique/products");
    expect(urls).not.toContain("/dashboard/boutique/stock");
    expect(urls).not.toContain("/dashboard/boutique/returns");
  });

  it("enforces sensitive boutique permissions in server actions", () => {
    // The till, the cash book and orders are the salon's own (admin + Marie).
    expect(read("actions/boutique/point-of-sale.js")).toContain("isTillCashOperator(session.user)");
    expect(read("actions/dashboard/cash-sessions.js")).toContain("isTillCashOperator(session.user)");
    expect(read("actions/boutique/orders.js")).toContain("isTillCashOperator(session.user)");
    expect(read("actions/boutique/returns.js")).toContain("STAFF_PERMISSIONS.RETURNS");
    expect(read("actions/boutique/stock.js")).toContain("STAFF_PERMISSIONS.BOUTIQUE_STOCK");
    const stock = read("actions/boutique/stock.js");
    const movement = stock.slice(stock.indexOf("export async function recordStockMovement"), stock.indexOf("export async function recordStockCount"));
    const count = stock.slice(stock.indexOf("export async function recordStockCount"), stock.indexOf("export async function getAllVariants"));
    expect(movement).toContain("requireStockAccess()");
    expect(count).toContain("requireStockAccess()");
    const dashboardStats = read("actions/dashboard/get-dashboard-stats.js");
    expect(dashboardStats).toContain("const canSeeOrders");
    expect(dashboardStats).toContain("isAdmin ? prisma.payment.findMany");
  });

  it("opening and closing a till session are both the salon's own", () => {
    const cashSessions = read("actions/dashboard/cash-sessions.js");
    const openingGuard = cashSessions.slice(
      cashSessions.indexOf("async function requireCashSessionOpeningAccess()"),
      cashSessions.indexOf("const SESSION_INCLUDE")
    );
    const openSession = cashSessions.slice(
      cashSessions.indexOf("export async function openCashSession("),
      cashSessions.indexOf("export async function closeCashSession(sessionId, countedCash)")
    );
    const closeSession = cashSessions.slice(cashSessions.indexOf("export async function closeCashSession(sessionId, countedCash)"));

    expect(openingGuard).toContain("isTillCashOperator(session.user)");
    expect(openSession).toContain("requireCashSessionOpeningAccess()");
    expect(closeSession).toContain("requireCashSessionAccess()");
  });

  it("persists the permission list on Staff", () => {
    expect(read("prisma/schema.prisma")).toMatch(/dashboardPermissions\s+String\[\]/);
    expect(read("actions/staff/update-independent-staff.js")).toContain("dashboardPermissions");
    expect(read("components/dashboard/staff/StaffPermissionsField.jsx")).toContain("Les droits non cochés sont masqués");
  });

  it("scopes staff customers and activity reservations to their appointments and assigned sessions", () => {
    const customerScope = read("lib/staff-customer-scope.js");
    const newsletter = read("actions/newsletter/send-newsletter.js");
    const formations = read("actions/formations/get-reservations.js");
    expect(customerScope).toContain("formationReservations");
    expect(customerScope).toContain('status: { in: ["CONFIRMED", "COMPLETED"] }');
    expect(newsletter).toContain("marketingEligibleOnly: true");
    expect(formations).toContain("activityReservationStaffScope");
    expect(formations).toContain("getActivityReservationCapabilities");
  });
});
