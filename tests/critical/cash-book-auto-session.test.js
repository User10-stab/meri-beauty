import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    salon: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    cashSession: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    transaction: { aggregate: vi.fn() },
    cashMovement: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  resolveTodaysOpeningTime,
  autoOpenCashSession,
  autoCloseCashSession,
} from "@/lib/cash-book/auto-session";

const TILL_OPERATOR = { id: "user_marie" };

function salonFixture({ day = "TUESDAY", isOpen = true, openingTime = "09:00", closingTime = "19:00", closures = [] } = {}) {
  return {
    id: "main-salon",
    workingDays: [{ day, isOpen, openingTime, closingTime }],
    closures,
  };
}

// 2026-09-08 is a Tuesday.
const TUESDAY_MORNING = new Date("2026-09-08T07:00:00Z"); // 09:00 Brussels (UTC+2 in September)
const TUESDAY_AFTERNOON = new Date("2026-09-08T12:00:00Z"); // 14:00 Brussels

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback({
      $executeRaw: vi.fn(),
      cashSession: { findFirst: mocks.prisma.cashSession.findFirst, create: mocks.prisma.cashSession.create },
    })
  );
});

describe("resolveTodaysOpeningTime", () => {
  test("no salon configured — nothing to open", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(null);
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: false, openingTime: null });
  });

  test("uses the weekday's opening time when the salon is open that day", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture());
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: true, openingTime: "09:00" });
  });

  test("isOpen: false on the weekday skips the day entirely", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture({ isOpen: false }));
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: false, openingTime: null });
  });

  test("a full-day closure covering today skips it, even on an otherwise-open weekday", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(
      salonFixture({
        closures: [{ startDate: new Date("2026-09-08"), endDate: null, isFullDay: true, openingTime: null }],
      })
    );
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: false, openingTime: null });
  });

  test("a partial-day closure overrides the weekly opening time instead of skipping the day", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(
      salonFixture({
        closures: [{ startDate: new Date("2026-09-08"), endDate: null, isFullDay: false, openingTime: "13:00" }],
      })
    );
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: true, openingTime: "13:00" });
  });

  test("a multi-day closure range covers every day in between, inclusive", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(
      salonFixture({
        closures: [{ startDate: new Date("2026-09-07"), endDate: new Date("2026-09-09"), isFullDay: true, openingTime: null }],
      })
    );
    expect(await resolveTodaysOpeningTime(TUESDAY_MORNING)).toEqual({ shouldOpen: false, openingTime: null });
  });
});

describe("autoOpenCashSession", () => {
  test("skips before the salon's opening time — the daily cooldown alone cannot tell 'not yet' from 'already ran'", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture({ openingTime: "09:00" }));
    const beforeOpening = new Date("2026-09-08T06:00:00Z"); // 08:00 Brussels
    const result = await autoOpenCashSession(beforeOpening);
    expect(result).toEqual({ skipped: "not-yet-opening-time" });
    expect(mocks.prisma.cashSession.create).not.toHaveBeenCalled();
  });

  test("skips on a day the salon is closed", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture({ isOpen: false }));
    expect(await autoOpenCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "closed" });
  });

  test("skips when a session is already open — no double-open", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture());
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "already_open" });
    const result = await autoOpenCashSession(TUESDAY_AFTERNOON);
    expect(result).toEqual({ skipped: "already-open" });
    expect(mocks.prisma.cashSession.create).not.toHaveBeenCalled();
  });

  test("skips when no till-operator account exists — nobody to credit the session to", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture());
    mocks.prisma.cashSession.findFirst.mockResolvedValue(null);
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    expect(await autoOpenCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "no-till-operator-account" });
  });

  test("opens as the till operator, carrying the previous session's counted total forward", async () => {
    mocks.prisma.salon.findUnique.mockResolvedValue(salonFixture());
    mocks.prisma.cashSession.findFirst
      .mockResolvedValueOnce(null) // 1st call: autoOpenCashSession's own "already open?" check
      .mockResolvedValueOnce({ countedCash: 342.5 }); // 2nd call: suggestedOpeningFloat's lookup
      // A 3rd call happens inside openCashSessionInternal's own transaction
      // (its own "already open?" race check) — unmocked here, so it
      // resolves undefined, which is falsy and lets create() proceed; that's
      // exactly what "no session is open" means to that check too.
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);
    mocks.prisma.cashSession.create.mockResolvedValue({ id: "new_session", openingFloat: 342.5 });

    const result = await autoOpenCashSession(TUESDAY_AFTERNOON);
    expect(result).toEqual({ opened: true, sessionId: "new_session", openingFloat: 342.5 });
    expect(mocks.prisma.cashSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ openedById: "user_marie", openingFloat: 342.5, isAutoOpened: true }),
      })
    );
  });
});

describe("autoCloseCashSession", () => {
  function mockCashTotalsQueries({ cashIn = 0, cashOut = 0, movements = [] } = {}) {
    mocks.prisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: cashIn } })
      .mockResolvedValueOnce({ _sum: { amount: cashOut } })
      .mockResolvedValueOnce({ _sum: { amount: cashIn } }) // closeCashSessionInternal recomputes once more
      .mockResolvedValueOnce({ _sum: { amount: cashOut } });
    mocks.prisma.cashMovement.findMany.mockResolvedValue(movements);
  }

  test("no-op when nothing is open", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue(null);
    expect(await autoCloseCashSession()).toEqual({ skipped: "no-open-session" });
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });

  test("skips when no till-operator account exists", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100 });
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    expect(await autoCloseCashSession()).toEqual({ skipped: "no-till-operator-account" });
  });

  // The whole point of the midnight auto-close: nobody physically counted
  // the drawer, so countedCash is set equal to expectedCash and the variance
  // this produces is always exactly 0 — a pure day-boundary, not a real count.
  test("closes with countedCash forced equal to expectedCash — variance always 0", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100 });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);
    mockCashTotalsQueries({ cashIn: 250, cashOut: 30 });
    mocks.prisma.cashSession.findUnique
      .mockResolvedValueOnce({ id: "sess_1", closedAt: null, openingFloat: 100 }) // inside closeCashSessionInternal
      .mockResolvedValueOnce({ id: "sess_1", closedAt: new Date(), expectedCash: 320, countedCash: 320, variance: 0 });
    mocks.prisma.cashSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await autoCloseCashSession();
    expect(result).toEqual({ closed: true, sessionId: "sess_1", expectedCash: 320 });
    expect(mocks.prisma.cashSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess_1", closedAt: null },
        data: expect.objectContaining({ expectedCash: 320, countedCash: 320, variance: 0, isAutoClosed: true, closedById: "user_marie" }),
      })
    );
  });

  test("is a safe no-op if the session was already closed by the time it runs (e.g. a concurrent manual close)", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100 });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);
    mockCashTotalsQueries();
    mocks.prisma.cashSession.findUnique.mockResolvedValueOnce({ id: "sess_1", closedAt: new Date(), openingFloat: 100 });

    expect(await autoCloseCashSession()).toEqual({ skipped: "already-closed" });
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });
});
