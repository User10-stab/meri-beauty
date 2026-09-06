import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transactions: vi.fn(),
  workshops: vi.fn(),
  formations: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: mocks.query,
  transaction: { findMany: mocks.transactions },
  workshopReservation: { findMany: mocks.workshops },
  formationReservation: { findMany: mocks.formations },
} }));
import { getAdminOperations } from "@/actions/dashboard/admin-operations";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
});

it("retains the deposit and final payment when filtering completed appointments", async () => {
  const events = [
    { id: "deposit", amount: 60, method: "ONLINE", transactionType: "DEPOSIT", paidAt: new Date("2026-09-01"), isDeleted: false },
    { id: "balance", amount: 60, method: "CASH", transactionType: "FINAL_PAYMENT", paidAt: new Date("2026-09-05"), isDeleted: false },
  ];
  const payment = { id: "p", status: "PAID", transactions: events, invoice: null, appointment: { status: "COMPLETED", user: null } };
  mocks.query.mockResolvedValueOnce(events.map(({ id }) => ({ id, sourceType: "APPOINTMENT" }))).mockResolvedValueOnce([{ count: 2 }]);
  mocks.transactions.mockResolvedValue(events.map((event) => ({ ...event, payment })));
  const result = await getAdminOperations({ lifecycleStatus: "COMPLETED" });
  const query = Prisma.sql(...mocks.query.mock.calls[0]);
  expect(query.sql).toContain('a."status"::text =');
  expect(query.values).toContain("COMPLETED");
  expect(query.sql).not.toContain("AND false");
  expect(query.sql).not.toContain("AND NOT (");
  expect(result.success).toBe(true);
  expect(result.data.map((row) => row.id)).toEqual(["deposit", "balance"]);
  expect(result.data[0].payment.appointment.status).toBe("COMPLETED");
});

it.each([["workshops", "WORKSHOP", "workshops"], ["formations", "FORMATION", "formations"]])(
  "%s keeps completed reservations and exposes their entire payment history",
  async (tab, sourceType, delegate) => {
    const transactions = [
      { id: "deposit", amount: 60, method: "ONLINE", transactionType: "DEPOSIT", paidAt: new Date("2026-08-01"), isDeleted: false },
      { id: "balance", amount: 60, method: "CARD", transactionType: "FINAL_PAYMENT", paidAt: new Date("2026-09-05"), isDeleted: false },
    ];
    mocks.query.mockResolvedValueOnce([{ id: "r", sourceType }]).mockResolvedValueOnce([{ count: 1 }]);
    mocks[delegate].mockResolvedValue([{ id: "r", status: "COMPLETED", customer: null, payment: { id: "p", transactions, invoice: null } }]);
    const result = await getAdminOperations({ tab, lifecycleStatus: "COMPLETED" });
    const query = Prisma.sql(...mocks.query.mock.calls[0]);
    expect(query.sql).toContain('MAX(t."paidAt")');
    expect(query.values).toContain("COMPLETED");
    expect(result.success).toBe(true);
    expect(result.data[0].status).toBe("COMPLETED");
    expect(result.data[0].payment.transactions).toHaveLength(2);
    expect(result.data[0].latestTransactionId).toBe("balance");
    expect(result.data[0].refundState.totalCollected).toBe(120);
  },
);
