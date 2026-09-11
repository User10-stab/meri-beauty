import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    cashSession: { findUnique: vi.fn(), update: vi.fn() },
    transaction: { aggregate: vi.fn() },
    cashMovement: { findMany: vi.fn() },
  },
  auth: vi.fn(),
  isTillCashOperator: vi.fn(),
  isAdminRole: vi.fn(),
  hasDashboardPermission: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/authorization", () => ({
  isTillCashOperator: mocks.isTillCashOperator,
  isAdminRole: mocks.isAdminRole,
  hasDashboardPermission: mocks.hasDashboardPermission,
  STAFF_PERMISSIONS: { CASH_REGISTER: "CASH_REGISTER" },
}));

import { verifyCashSessionBalance } from "@/actions/dashboard/cash-session-verification";

const CLOSED_SESSION = {
  id: "sess_1",
  closedAt: new Date("2026-09-08T00:00:00Z"),
  openingFloat: 100,
  expectedCash: 320,
  countedCash: 320,
  variance: 0,
};

const OPEN_SESSION = { id: "sess_2", closedAt: null, openingFloat: 100, expectedCash: null, countedCash: null, variance: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "marie_1", role: "STAFF", email: "contact@meribeautystudio.com" } });
  mocks.isTillCashOperator.mockReturnValue(true);
  mocks.isAdminRole.mockReturnValue(false);
  mocks.hasDashboardPermission.mockResolvedValue(false);
  mocks.prisma.cashSession.update.mockImplementation(({ data }) => Promise.resolve({ id: "sess_1", ...data }));
});

// This is deliberately layered on top of the (auto or manual) close, not a
// reopen — see the schema comment on CashSession.verifiedAt: a closed
// session is immutable elsewhere in the codebase (closeCashSession only
// ever acts on closedAt: null), and this must not disturb that.
describe("verifyCashSessionBalance access", () => {
  test("rejects an unauthenticated caller", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320 });
    expect(result.success).toBe(false);
  });

  test("rejects a staff member who is neither the till operator, an admin, nor CASH_REGISTER-permitted", async () => {
    mocks.isTillCashOperator.mockReturnValue(false);
    mocks.isAdminRole.mockReturnValue(false);
    mocks.hasDashboardPermission.mockResolvedValue(false);
    const result = await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320 });
    expect(result.success).toBe(false);
  });

  test("allows an admin even if not the designated till operator", async () => {
    mocks.isTillCashOperator.mockReturnValue(false);
    mocks.isAdminRole.mockReturnValue(true);
    mocks.prisma.cashSession.findUnique.mockResolvedValue(CLOSED_SESSION);
    const result = await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320 });
    expect(result.success).toBe(true);
  });

  test("allows the designated till operator", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(CLOSED_SESSION);
    const result = await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320 });
    expect(result.success).toBe(true);
  });
});

describe("verifyCashSessionBalance validation", () => {
  test("rejects a missing sessionId", async () => {
    const result = await verifyCashSessionBalance({ countedAmount: 320 });
    expect(result.success).toBe(false);
  });

  test("rejects a negative or non-numeric counted amount", async () => {
    expect((await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: -1 })).success).toBe(false);
    expect((await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: "abc" })).success).toBe(false);
  });

  test("reports the session as not found rather than throwing", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(null);
    const result = await verifyCashSessionBalance({ sessionId: "missing", countedAmount: 320 });
    expect(result.success).toBe(false);
  });
});

describe("verifyCashSessionBalance math and immutability", () => {
  test("a closed session reuses its own pinned expectedCash — never recomputed live", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(CLOSED_SESSION);
    const result = await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 325 });
    expect(result.success).toBe(true);
    expect(result.data.expectedCash).toBe(320);
    expect(result.data.verifiedVariance).toBe(5);
    expect(mocks.prisma.transaction.aggregate).not.toHaveBeenCalled();
  });

  test("an open session computes expectedCash live, the same way the close/withdrawal-guard do", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(OPEN_SESSION);
    mocks.prisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 250 } }) // cash in
      .mockResolvedValueOnce({ _sum: { amount: 30 } }); // cash out
    mocks.prisma.cashMovement.findMany.mockResolvedValue([]);

    const result = await verifyCashSessionBalance({ sessionId: "sess_2", countedAmount: 300 });
    // 100 (opening) + 250 - 30 = 320 expected; counted 300 -> variance -20.
    expect(result.data.expectedCash).toBe(320);
    expect(result.data.verifiedVariance).toBe(-20);
  });

  test("never writes closedById, countedCash or variance — only the verification fields", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(CLOSED_SESSION);
    await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320, note: "Recompte du soir" });
    const { data } = mocks.prisma.cashSession.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("closedById");
    expect(data).not.toHaveProperty("countedCash");
    expect(data).not.toHaveProperty("variance");
    expect(data).toMatchObject({ verifiedById: "marie_1", verifiedVariance: 0, verificationNote: "Recompte du soir" });
    expect(data.verifiedAt).toBeInstanceOf(Date);
  });

  test("an empty note is stored as null, not an empty string", async () => {
    mocks.prisma.cashSession.findUnique.mockResolvedValue(CLOSED_SESSION);
    await verifyCashSessionBalance({ sessionId: "sess_1", countedAmount: 320 });
    const { data } = mocks.prisma.cashSession.update.mock.calls[0][0];
    expect(data.verificationNote).toBeNull();
  });
});
