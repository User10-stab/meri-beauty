import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  prisma: { order: { count: vi.fn() }, staff: { findFirst: vi.fn() } },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import {
  ROLES,
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_OPTIONS,
  normalizeStaffPermissions,
  canUseSalonTill,
} from "@/lib/authorization";
import { getNavDataForRole } from "@/components/dashboard/Layouts/sidebar/data";
import { countPickupsToVerify } from "@/lib/orders/count-pickups-to-verify";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const DELETED = ["POINT_OF_SALE", "CASH_REGISTER", "ORDERS", "SEND_TICKET_EMAIL"];
const SALON_SCREENS = ["/dashboard/boutique/point-of-sale", "/dashboard/boutique/caisse", "/dashboard/boutique/orders"];

const MARIE = { id: "u_marie", role: ROLES.STAFF, email: "contact@meribeautystudio.com" };
const JULIE = { id: "u_julie", role: ROLES.STAFF, email: "julieschoemans@gmail.com" };
const ADMIN = { id: "u_admin", role: ROLES.ADMIN, email: "admin@meribeauty.com" };

function visibleUrls(nav) {
  return nav
    .flatMap((section) => section.items.flatMap((item) => [item.url, ...(item.items ?? []).map((child) => child.url)]))
    .filter(Boolean);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.order.count.mockResolvedValue(3);
});

/**
 * The till, the Livre de caisse, boutique orders and the ticket e-mail are the
 * SALON's. Since 16/09/2026 they are not permissions at all: the admin and
 * Marie Mercier (isTillCashOperator, despite her STAFF role) have them, every
 * other practitioner — legally independent — does not, whatever is stored.
 */
describe("the four salon-only permissions no longer exist", () => {
  it("are gone from the permission list and from the staff form", () => {
    for (const key of DELETED) {
      expect(Object.values(STAFF_PERMISSIONS)).not.toContain(key);
      expect(STAFF_PERMISSION_OPTIONS.map((option) => option.key)).not.toContain(key);
    }
  });

  it("a value still stored on an old Staff row grants nothing", () => {
    expect(normalizeStaffPermissions([...DELETED, "APPOINTMENTS"])).toEqual(["APPOINTMENTS"]);
  });

  it("no code checks them any more — every guard asks the account (or canUseSalonTill for the till)", () => {
    // The till's own actions: admin + Marie, plus a staff member granted
    // CAISSE since 25/09/2026 (canUseSalonTill).
    for (const path of [
      "actions/boutique/point-of-sale.js",
      "actions/boutique/settlements.js",
      "actions/counter/create-reservation.js",
      "actions/counter/search.js",
      "actions/counter/update-buyer.js",
      "actions/counter/walk-in-service.js",
    ]) {
      const code = source(path);
      for (const key of DELETED) expect(code, `${path} ${key}`).not.toContain(`STAFF_PERMISSIONS.${key}`);
      expect(code, path).toContain("canUseSalonTill(");
    }
    for (const path of [
      "actions/boutique/orders.js",
      "actions/boutique/mondial-relay.js",
      "actions/dashboard/cash-book.js",
      "actions/dashboard/cash-movements.js",
      "actions/dashboard/cash-sessions.js",
      "actions/dashboard/global-search.js",
      "actions/dashboard/get-dashboard-stats.js",
      "app/api/invoices/[id]/pdf/route.js",
      "lib/orders/count-pickups-to-verify.js",
    ]) {
      const code = source(path);
      for (const key of DELETED) expect(code, `${path} ${key}`).not.toContain(`STAFF_PERMISSIONS.${key}`);
      expect(code, path).toContain("isTillCashOperator(");
    }
  });

  it("every salon screen is guarded on the account, not on a permission", () => {
    for (const path of [
      "app/(dashboard)/dashboard/boutique/scan/page.jsx",
      "app/dashboard/boutique/caisse/page.jsx",
      "app/dashboard/boutique/orders/page.jsx",
      "app/dashboard/boutique/orders/[id]/page.jsx",
    ]) {
      expect(source(path), path).toContain("await requireTillCashOperator();");
    }
    expect(source("lib/route-protection.js")).toContain("if (!isTillCashOperator(user)) redirect(\"/dashboard\");");
    // The till screen itself also admits a staff member granted CAISSE.
    expect(source("app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx")).toContain("await requireSalonTill();");
    expect(source("lib/route-protection.js")).toContain("if (!(await canUseSalonTill(user))) redirect(\"/dashboard\");");
  });
});

/**
 * 25/09/2026: the till (« Caisse ») is grantable again, as CAISSE — but the
 * money follows whose sale it is, never who stands at the till. A boutique
 * sale is the salon's (on-till, salon ticket, salon revenue); her own
 * appointment or formation is hers (off-till, no salon ticket or invoice).
 * The Livre de caisse, Commandes and invoice sales stay the salon's own.
 */
describe("CAISSE opens the till, and only the till", () => {
  const ROSE = { id: "u_rose", role: ROLES.STAFF, email: "rose@example.com" };

  it("is a grantable permission, offered on the staff form, not a default", async () => {
    expect(STAFF_PERMISSIONS.CAISSE).toBe("CAISSE");
    expect(STAFF_PERMISSION_OPTIONS.map((option) => option.key)).toContain("CAISSE");
    const { DEFAULT_STAFF_PERMISSIONS } = await import("@/lib/authorization");
    expect(DEFAULT_STAFF_PERMISSIONS).not.toContain("CAISSE");
  });

  it("canUseSalonTill: the salon's accounts always, a staff member only with CAISSE", async () => {
    expect(await canUseSalonTill(ADMIN)).toBe(true);
    expect(await canUseSalonTill(MARIE)).toBe(true);
    mocks.prisma.staff.findFirst.mockResolvedValue({ dashboardPermissions: ["APPOINTMENTS"] });
    expect(await canUseSalonTill(ROSE)).toBe(false);
    mocks.prisma.staff.findFirst.mockResolvedValue({ dashboardPermissions: ["APPOINTMENTS", "CAISSE"] });
    expect(await canUseSalonTill(ROSE)).toBe(true);
    expect(await canUseSalonTill(null)).toBe(false);
  });

  it("shows her the Caisse entry, never the Livre de caisse or Commandes", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.STAFF, ["CAISSE"], { isSalonAccount: false }));
    expect(urls).toContain("/dashboard/boutique/point-of-sale");
    expect(urls).not.toContain("/dashboard/boutique/caisse");
    expect(urls).not.toContain("/dashboard/boutique/orders");
  });

  it("keeps invoice sales and pickups off her till", () => {
    const page = source("app/(dashboard)/dashboard/boutique/point-of-sale/page.jsx");
    expect(page).toContain("canPickup={isSalonAccount}");
    expect(page).toContain("canInvoiceSale={isSalonAccount}");
    expect(source("actions/invoices/manual-invoice.js")).toContain("isTillCashOperator(session.user)");
    const pos = source("actions/boutique/point-of-sale.js");
    expect(pos).toContain("if (sourceOrderId && !isTillCashOperator(guard.session.user)) {");
  });

  it("counts every boutique order as the salon's, whoever rang it up", () => {
    expect(source("actions/dashboard/get-reports-data.js")).toContain("const salonOrder = {};");
    expect(source("actions/dashboard/admin-operations.js")).toContain(
      'const orderScope = scope.mode === "STAFF" ? Prisma.sql`AND false` : Prisma.empty;'
    );
  });
});

describe("the sidebar follows the account", () => {
  it("an independent never sees Caisse, Livre de caisse or Commandes", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.STAFF, [...DELETED], { isSalonAccount: false }));
    for (const url of SALON_SCREENS) expect(urls).not.toContain(url);
  });

  it("Marie sees all three — STAFF role, salon account", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.STAFF, [], { isSalonAccount: true }));
    for (const url of SALON_SCREENS) expect(urls).toContain(url);
  });

  it("the admin sees all three by default", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.ADMIN, []));
    for (const url of SALON_SCREENS) expect(urls).toContain(url);
  });

  it("the layout resolves the flag server-side with isTillCashOperator", () => {
    expect(source("app/dashboard/layout.jsx")).toContain("isSalonAccount={isTillCashOperator(session.user)}");
  });
});

describe("the Commandes badge follows the same rule", () => {
  it("counts for Marie and the admin, never for an independent", async () => {
    expect(await countPickupsToVerify(MARIE)).toBe(3);
    expect(await countPickupsToVerify(ADMIN)).toBe(3);
    expect(await countPickupsToVerify(JULIE, [...DELETED])).toBe(0);
  });
});

describe("Mes opérations is reachable from the sidebar", () => {
  it("for every staff account, Marie included", () => {
    expect(visibleUrls(getNavDataForRole(ROLES.STAFF, []))).toContain("/dashboard/mes-operations");
  });

  it("but not for an admin, who has the full Opérations instead", () => {
    const urls = visibleUrls(getNavDataForRole(ROLES.ADMIN, []));
    expect(urls).not.toContain("/dashboard/mes-operations");
    expect(urls).toContain("/dashboard/operations");
  });
});
