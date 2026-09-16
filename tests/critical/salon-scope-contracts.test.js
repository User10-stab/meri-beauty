import { describe, expect, it, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSalonScope } from "@/lib/authorization/salon-scope";
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
