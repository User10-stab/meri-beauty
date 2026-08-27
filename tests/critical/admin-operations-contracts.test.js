import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("admin operations dashboard", () => {
  test("keeps the consolidated ledger admin-only and paginated", () => {
    const action = source("actions/dashboard/admin-operations.js");
    expect(action).toContain("isAdminRole(session.user.role)");
    expect(action).toContain("PAGE_SIZE = 30");
    expect(action).toContain("skip,");
    expect(action).toContain("take: PAGE_SIZE");
  });

  test("covers transactions, orders, workshops/events, and formations", () => {
    const action = source("actions/dashboard/admin-operations.js");
    expect(action).toContain('"transactions", "orders", "workshops", "formations"');
    expect(action).toContain("prisma.transaction.findMany");
    expect(action).toContain("prisma.order.findMany");
    expect(action).toContain("prisma.workshopReservation.findMany");
    expect(action).toContain("prisma.formationReservation.findMany");
  });

  test("exposes the admin-only Operations navigation tab", () => {
    const nav = source("components/dashboard/Layouts/sidebar/data/index.js");
    expect(nav).toContain('title: "Opérations"');
    expect(nav).toContain('url: "/dashboard/operations"');
    expect(nav).toContain("roles: [ROLES.OWNER, ROLES.ADMIN]");
  });
});
