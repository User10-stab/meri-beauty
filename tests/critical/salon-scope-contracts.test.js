import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSalonScope, SALON_PAYMENT_WHERE } from "@/lib/authorization/salon-scope";
import { TILL_CASH_OPERATOR_EMAIL, isTillCashOperator } from "@/lib/authorization";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const MARIE_EMAIL = "contact@meribeautystudio.com";

// Production shape: one ADMIN with no Staff row, and Marie — role STAFF,
// with a Staff row her appointments key on.
const ADMIN = { id: "u_admin", staff: null };
const MARIE = { id: "u_marie", staff: { id: "s_marie" } };

function clientMock(users = [ADMIN, MARIE]) {
  return { user: { findMany: vi.fn(() => Promise.resolve(users)) } };
}

describe("resolveSalonScope — who counts as the salon", () => {
  it("returns both id spaces, because the schema attributes through two different keys", async () => {
    const client = clientMock();
    const scope = await resolveSalonScope(client);

    // Order.createdByStaffId → User.id ; Appointment.staffId → Staff.id.
    // Handing one where the other is expected matches nothing, silently.
    expect(scope.salonUserIds).toEqual(["u_admin", "u_marie"]);
    expect(scope.salonStaffIds).toEqual(["s_marie"]);
  });

  it("includes Marie despite her STAFF role — her VAT number IS the salon's", async () => {
    const scope = await resolveSalonScope(clientMock());
    expect(scope.salonUserIds).toContain("u_marie");
    expect(scope.salonStaffIds).toContain("s_marie");

    // And the query that found her asks for her by e-mail, not by role: a
    // where clause keyed on role alone would drop the salon's own revenue
    // out of the salon's own books.
    const c = clientMock();
    await resolveSalonScope(c);
    const where = c.user.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain(TILL_CASH_OPERATOR_EMAIL);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ role: { in: ["ADMIN", "OWNER"] } }])
    );
  });

  it("drops an admin with no Staff row from the staff ids rather than emitting undefined", async () => {
    const scope = await resolveSalonScope(clientMock([ADMIN]));
    expect(scope.salonStaffIds).toEqual([]);
    expect(scope.salonUserIds).toEqual(["u_admin"]);
  });

  it("keeps soft-deleted accounts: an admin leaving does not un-earn past sales", async () => {
    const c = clientMock();
    await resolveSalonScope(c);
    expect(c.user.findMany.mock.calls[0][0].where).not.toHaveProperty("isDeleted");
  });
});

describe("the exemption is expressed once, and never re-derived", () => {
  const scopeSource = source("lib/authorization/salon-scope.js");
  // Comments here explain the very rules being banned, so strip them first.
  const code = scopeSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("salon-scope never hard-codes the address — the constant is overridable per environment", () => {
    expect(code).not.toContain(MARIE_EMAIL);
    expect(scopeSource).toContain('from "@/lib/authorization"');
  });

  test("salon-scope never tests for the STAFF role or the contract type, which would exclude Marie", () => {
    expect(code).not.toMatch(/===\s*["']STAFF["']/);
    expect(code).not.toMatch(/ROLES\.STAFF/);
    expect(code).not.toContain("INDEPENDENT");
  });
});

describe("TILL_CASH_OPERATOR_EMAIL — the default is load-bearing", () => {
  // Production has no TILL_CASH_OPERATOR_EMAIL in its .env, so the code's
  // own default is what exempts Marie. Someone setting that variable to
  // anything else would silently strip her exemption — and with it, the
  // salon's revenue from the salon's books. Lock the literal down.
  test("the source default is Marie's production address", () => {
    const authorization = source("lib/authorization.js");
    expect(authorization).toContain(
      `process.env.TILL_CASH_OPERATOR_EMAIL || "${MARIE_EMAIL}"`
    );
  });

  test("with the variable unset, the constant resolves to it", () => {
    if (process.env.TILL_CASH_OPERATOR_EMAIL) {
      expect(TILL_CASH_OPERATOR_EMAIL).toBe(process.env.TILL_CASH_OPERATOR_EMAIL.toLowerCase());
      return;
    }
    expect(TILL_CASH_OPERATOR_EMAIL).toBe(MARIE_EMAIL);
  });

  test("isTillCashOperator passes Marie on e-mail alone, and fails another independent", () => {
    expect(isTillCashOperator({ role: "STAFF", email: TILL_CASH_OPERATOR_EMAIL })).toBe(true);
    expect(isTillCashOperator({ role: "STAFF", email: TILL_CASH_OPERATOR_EMAIL.toUpperCase() })).toBe(true);
    expect(isTillCashOperator({ role: "ADMIN", email: "admin@meribeauty.com" })).toBe(true);
    expect(isTillCashOperator({ role: "STAFF", email: "julieschoemans@gmail.com" })).toBe(false);
  });
});

// Every book and every headline figure the salon publishes about itself has
// to be scoped the same way, from the same module. A screen that quietly
// keeps summing everyone is the whole problem restated.
describe("every salon-wide figure resolves its scope from the one module", () => {
  const MONEY_CONSUMERS = [
    ["the livre de recettes", "lib/livre-de-recettes/build-recettes-journal.js"],
    ["the dashboard revenue card", "actions/dashboard/get-dashboard-stats.js"],
    ["Rapports", "actions/dashboard/get-reports-data.js"],
  ];

  test.each(MONEY_CONSUMERS)("%s keeps the salon's money through SALON_PAYMENT_WHERE", (_label, path) => {
    const code = source(path);
    expect(code).toMatch(/SALON_PAYMENT_WHERE \} from "@\/lib\/authorization\/salon-scope"/);
    // The old per-source OR arms keyed on ids are gone: ownership is the
    // payment's frozen payee now, never re-derived per screen.
    expect(code).not.toContain("salonPaymentArms");
  });

  test("Opérations scopes its raw SQL by the same payee, and lists independents from resolve-payee", () => {
    const code = source("actions/dashboard/admin-operations.js");
    expect(code).toContain('import { resolveSalonScope } from "@/lib/authorization/salon-scope"');
    expect(code).toContain("listIndependentPayeeStaffIds(prisma)");
    expect(code).toContain('."payeeStaffId" IS NULL');
  });

  test("the salon's payments are exactly the ones with no independent payee", () => {
    expect(SALON_PAYMENT_WHERE).toEqual({ payeeStaffId: null });
  });

  // An independent's money is hers. No salon screen may offer a way to pick
  // one practitioner and read her figures.
  test.each([
    ["the dashboard filter", "components/dashboard/DashboardFilters.jsx"],
    ["the dashboard stats", "actions/dashboard/get-dashboard-stats.js"],
    ["the dashboard page", "app/dashboard/page.jsx"],
    ["the reports filter bar", "components/dashboard/reports/ReportsFilterBar.jsx"],
    ["the recettes filter bar", "components/dashboard/recettes/RecettesFilterBar.jsx"],
    ["the recettes action", "actions/dashboard/get-recettes-journal.js"],
    ["the recettes page", "app/dashboard/livre-de-recettes/page.jsx"],
  ])("%s has no staff picker", (_label, path) => {
    const code = source(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("staffOptions");
    expect(code).not.toContain("viewedStaff");
    expect(code).not.toMatch(/params\?\.staffId|staffId:\s*filterStaffId|activeStaffId/);
  });
});
