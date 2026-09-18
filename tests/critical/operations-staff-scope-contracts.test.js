import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transactions: vi.fn(),
  workshops: vi.fn(),
  formations: vi.fn(),
  orders: vi.fn(),
  auditLogs: vi.fn(),
  userFindMany: vi.fn(),
  userFindFirst: vi.fn(),
  staffFindMany: vi.fn(),
  staffFindFirst: vi.fn(),
  staffFindUnique: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.query,
    transaction: { findMany: mocks.transactions },
    order: { findMany: mocks.orders },
    workshopReservation: { findMany: mocks.workshops },
    formationReservation: { findMany: mocks.formations },
    auditLog: { findMany: mocks.auditLogs },
    user: { findMany: mocks.userFindMany, findFirst: mocks.userFindFirst },
    staff: { findMany: mocks.staffFindMany, findFirst: mocks.staffFindFirst, findUnique: mocks.staffFindUnique },
  },
}));

const { getAdminOperations } = await import("@/actions/dashboard/admin-operations");

// Production's shape: one ADMIN with no Staff row, and Marie — role STAFF,
// but her VAT number IS the salon's, so she is the salon.
const SALON_USERS = [
  { id: "u_admin", staff: null },
  { id: "u_marie", staff: { id: "s_marie" } },
];

const JULIE = { id: "s_julie", isDeleted: false, user: { id: "u_julie", fullName: "Julie Schoemans" } };

const firstQuery = () => Prisma.sql(...mocks.query.mock.calls[0]);
const countQuery = () => Prisma.sql(...mocks.query.mock.calls[1]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u_admin", role: "ADMIN" } });
  mocks.userFindMany.mockResolvedValue(SALON_USERS);
  // Every INDEPENDENT profile — Marie's type is INDEPENDENT too; the salon
  // scope is what takes her back out of the payee list.
  mocks.staffFindMany.mockResolvedValue([{ id: "s_julie" }, { id: "s_marie" }]);
  mocks.staffFindUnique.mockResolvedValue(JULIE);
  mocks.query.mockResolvedValue([]);
  mocks.transactions.mockResolvedValue([]);
  mocks.orders.mockResolvedValue([]);
  mocks.workshops.mockResolvedValue([]);
  mocks.formations.mockResolvedValue([]);
  mocks.auditLogs.mockResolvedValue([]);
});

// The failure mode this whole file exists for: attribution applied during
// hydration instead of inside the UNION. The rows on screen would look right
// and every number around them would be wrong — `totalCount` counting rows
// the reader never sees, "Suivant" leading to a page that renders empty.
describe("attribution rides in the SQL, not in the hydration", () => {
  it("scopes money rows by the Payment's frozen owner, and orders by who rang them up", async () => {
    await getAdminOperations({});
    const query = firstQuery();

    // Appointments and paid seats: Payment.payeeStaffId null is the salon.
    expect(query.sql).toContain('p."payeeStaffId" IS NULL');
    expect(query.sql).toContain('po."payeeStaffId" IS NULL');
    // Orders still follow the account that rang them up (User.id).
    expect(query.sql).toContain('o."createdByStaffId" IN');
    expect(query.values).toContain("u_admin");
    expect(query.values).toContain("u_marie");
  });

  it("an unpaid seat follows its animator, and only independents are excluded — never Marie", async () => {
    await getAdminOperations({});
    const query = firstQuery();
    expect(query.sql).toContain('COALESCE(sa."staffId", ca."staffId")');
    expect(query.sql).toContain("NOT IN");
    expect(query.values).toContain("s_julie");
    expect(query.values).not.toContain("s_marie");
  });

  it("counts through the same arms, so totalCount and the page agree", async () => {
    await getAdminOperations({});
    // Two queries over one shared `unioned` fragment: if the scope reached
    // only the paged one, the header would promise rows the table cannot show.
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(countQuery().sql).toContain('p."payeeStaffId" IS NULL');
    expect(countQuery().sql).toContain('po."payeeStaffId" IS NULL');
    expect(countQuery().values).toContain("s_julie");
  });

  it("keeps an unstamped row in the salon view — nobody rang it up, so it is the salon's", async () => {
    await getAdminOperations({});
    const sql = firstQuery().sql;
    expect(sql).toContain('o."createdByStaffId" IS NULL');
    expect(sql).toContain('al."actorId" IS NULL');
  });

  it("keeps ateliers and formations in the salon view", async () => {
    await getAdminOperations({});
    const sql = firstQuery().sql;
    expect(sql).toContain("'WORKSHOP' AS");
    expect(sql).toContain("'FORMATION' AS");
  });

  it("a session transfer follows the reservation's owner, not the admin who moved it", async () => {
    await getAdminOperations({});
    const sql = firstQuery().sql;
    const transferArm = sql.slice(sql.indexOf("'TRANSFER' AS"));
    expect(transferArm).toContain('po."payeeStaffId" IS NULL');
  });
});

// Every practitioner other than Marie is legally independent: the salon has
// no right to read her takings. The admin "qui" picker is gone, and a staffId
// smuggled into the params must change nothing.
describe("an admin can never open an independent's ledger", () => {
  it("ignores a staffId in the params and stays on the salon scope", async () => {
    const result = await getAdminOperations({ staffId: "s_julie" });
    const query = firstQuery();

    expect(result.success).toBe(true);
    expect(result.staffId).toBe("");
    expect(query.sql).not.toContain('"payeeStaffId" =');
    expect(query.values).not.toContain("u_julie");
    // Never even looked up — there is no code path that resolves one.
    expect(mocks.staffFindUnique).not.toHaveBeenCalled();
  });

  it("offers no staff directory to pick from", async () => {
    const result = await getAdminOperations({});
    expect(result).not.toHaveProperty("staffOptions");
  });
});

describe("a practitioner reading her own ledger", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ user: { id: "u_julie", role: "STAFF" } });
    mocks.staffFindFirst.mockResolvedValue({ id: "s_julie" });
    mocks.staffFindUnique.mockResolvedValue(JULIE);
  });

  it("gets her own rows without being an admin", async () => {
    const result = await getAdminOperations({});
    expect(result.success).toBe(true);
    expect(result.staffId).toBe("s_julie");
    expect(result.readOnly).toBe(true);
    expect(firstQuery().values).toContain("s_julie");
    expect(firstQuery().sql).toContain('p."payeeStaffId" =');
    expect(firstQuery().sql).not.toContain('"payeeStaffId" IS NULL');
  });

  it("sees the ateliers and formations she animates — they are her own sales", async () => {
    await getAdminOperations({});
    const sql = firstQuery().sql;
    expect(sql).toContain("'WORKSHOP' AS");
    expect(sql).toContain("'FORMATION' AS");
    expect(sql).toContain('COALESCE(sa."staffId", ca."staffId") =');
  });

  it("cannot read a colleague's takings by hand-editing the query string", async () => {
    const result = await getAdminOperations({ staffId: "s_marie" });
    // Forced server-side. Every export of a "use server" module is a public
    // endpoint in its own right, so the page's guard is not the boundary.
    expect(result.staffId).toBe("s_julie");
    expect(firstQuery().values).not.toContain("s_marie");
  });

  it("gets no filter to drive, and no salon-wide fallback if her Staff row is gone", async () => {
    const withOptions = await getAdminOperations({});
    expect(withOptions).not.toHaveProperty("staffOptions");

    mocks.staffFindFirst.mockResolvedValue(null);
    mocks.query.mockClear();
    const orphan = await getAdminOperations({});
    expect(orphan.success).toBe(false);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

describe("empty lists never reach Postgres as `IN ()`", () => {
  it("degrades to a false predicate rather than a syntax error", async () => {
    // A salon with no resolvable account at all is a misconfiguration, not a
    // reason to 500 — and certainly not a reason to show everything.
    mocks.userFindMany.mockResolvedValue([]);
    const result = await getAdminOperations({});
    expect(result.success).toBe(true);
    const sql = firstQuery().sql;
    expect(sql).not.toContain("IN ()");
    expect(sql).toContain("AND false");
  });

  it("with no independent at all, the animator check stays open instead of emitting NOT IN ()", async () => {
    mocks.staffFindMany.mockResolvedValue([{ id: "s_marie" }]);
    await getAdminOperations({});
    const sql = firstQuery().sql;
    expect(sql).not.toContain("IN ()");
    expect(sql).not.toContain("NOT IN");
  });
});

describe("the personal view is a separate, read-only route", () => {
  const page = source("app/dashboard/mes-operations/page.jsx");
  const operations = source("app/dashboard/operations/page.jsx");
  const client = source("components/dashboard/operations/AdminOperationsClient.jsx");

  test("/dashboard/operations stays admin-only, and never forwards a staff id", () => {
    expect(operations).toContain("await requireAdmin(false)");
    expect(operations).not.toContain("staffId:");
  });

  test("the staff picker is gone from the shared client", () => {
    expect(client).not.toContain("StaffFilter");
    expect(client).not.toContain("staffOptions");
    expect(client).not.toContain('search.set("staffId"');
  });

  test("the personal page never takes the staff id from the URL", () => {
    expect(page).toContain("getCurrentStaffId()");
    expect(page).not.toContain("params?.staffId");
    expect(page).not.toContain("staffId:");
  });

  test("it is dashboard-gated, and sends an admin back to the full ledger", () => {
    expect(page).toContain("await requireDashboard()");
    expect(page).toContain('redirect("/dashboard/operations")');
    expect(page).toContain('redirect("/dashboard")');
  });

  test("it renders the same table with every salon-side action withheld", () => {
    expect(page).toContain('basePath="/dashboard/mes-operations"');
    expect(client).toContain("readOnly={readOnly}");
    // The drawer and InvoiceRowActions are backed by admin-only actions and
    // reach the salon's own documents, so the whole Actions cell goes away.
    expect(client).toContain("{readOnly ? (");
  });
});
