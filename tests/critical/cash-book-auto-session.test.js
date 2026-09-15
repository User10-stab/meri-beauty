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

import { autoCloseCashSession } from "@/lib/cash-book/auto-session";

const TILL_OPERATOR = { id: "user_marie" };

// 2026-09-08 is a Tuesday. Brussels is UTC+2 in September.
const TUESDAY_AFTERNOON = new Date("2026-09-08T12:00:00Z"); // 14:00 Brussels
const OPENED_YESTERDAY = new Date("2026-09-07T08:00:00Z"); // Monday 10:00 Brussels
const OPENED_TODAY = new Date("2026-09-08T07:00:00Z"); // Tuesday 09:00 Brussels

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback({
      $executeRaw: vi.fn(),
      cashSession: { findFirst: mocks.prisma.cashSession.findFirst, create: mocks.prisma.cashSession.create },
    })
  );
});

// 15/09/2026: the till opened and closed itself every 5 minutes for four
// hours — 52 empty sessions, +702 € of phantom "Solde initial" rows. Two
// faults compounded: revalidateCaisseRoutes threw (no request context in a
// background job) after the session was already written, so the caller's 24h
// cooldown was never recorded; and this job had no time gate of its own, so
// it shut each new session instantly. The scheduled auto-open is gone
// entirely now — the till opens on the first cash-taking action, via
// ensureCashSessionOpen — and the day check below replaces the cooldown as
// the real guard.
describe("autoCloseCashSession only closes once the day is actually over", () => {
  function mockCashTotalsQueries({ cashIn = 0, cashOut = 0, movements = [] } = {}) {
    mocks.prisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: cashIn } })
      .mockResolvedValueOnce({ _sum: { amount: cashOut } })
      .mockResolvedValueOnce({ _sum: { amount: cashIn } }) // closeCashSessionInternal recomputes once more
      .mockResolvedValueOnce({ _sum: { amount: cashOut } });
    mocks.prisma.cashMovement.findMany.mockResolvedValue(movements);
  }

  test("refuses to close a session opened on the same Brussels day", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100, openedAt: OPENED_TODAY });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);

    expect(await autoCloseCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "still-the-same-day" });
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });

  test("a till opened minutes ago survives a tick — the loop cannot restart", async () => {
    // The exact shape of the incident: a session opened seconds earlier, and
    // a scheduler calling this on every 5-minute tick with no cooldown left.
    const openedSecondsAgo = new Date(TUESDAY_AFTERNOON.getTime() - 30_000);
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 13.5, openedAt: openedSecondsAgo });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);

    for (let tick = 0; tick < 5; tick += 1) {
      expect(await autoCloseCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "still-the-same-day" });
    }
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });

  test("no-op when nothing is open", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue(null);
    expect(await autoCloseCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "no-open-session" });
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });

  test("skips when no till-operator account exists", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100, openedAt: OPENED_YESTERDAY });
    mocks.prisma.user.findFirst.mockResolvedValue(null);
    expect(await autoCloseCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "no-till-operator-account" });
  });

  // The whole point of the midnight auto-close: nobody physically counted
  // the drawer, so countedCash is set equal to expectedCash and the variance
  // this produces is always exactly 0 — a pure day-boundary, not a real count.
  test("closes yesterday's session with countedCash forced equal to expectedCash — variance always 0", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100, openedAt: OPENED_YESTERDAY });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);
    mockCashTotalsQueries({ cashIn: 250, cashOut: 30 });
    mocks.prisma.cashSession.findUnique
      .mockResolvedValueOnce({ id: "sess_1", closedAt: null, openingFloat: 100 }) // inside closeCashSessionInternal
      .mockResolvedValueOnce({ id: "sess_1", closedAt: new Date(), expectedCash: 320, countedCash: 320, variance: 0 });
    mocks.prisma.cashSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await autoCloseCashSession(TUESDAY_AFTERNOON);
    expect(result).toEqual({ closed: true, sessionId: "sess_1", expectedCash: 320 });
    expect(mocks.prisma.cashSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sess_1", closedAt: null },
        data: expect.objectContaining({ expectedCash: 320, countedCash: 320, variance: 0, isAutoClosed: true, closedById: "user_marie" }),
      })
    );
  });

  test("is a safe no-op if the session was already closed by the time it runs (e.g. a concurrent manual close)", async () => {
    mocks.prisma.cashSession.findFirst.mockResolvedValue({ id: "sess_1", openingFloat: 100, openedAt: OPENED_YESTERDAY });
    mocks.prisma.user.findFirst.mockResolvedValue(TILL_OPERATOR);
    mockCashTotalsQueries();
    mocks.prisma.cashSession.findUnique.mockResolvedValueOnce({ id: "sess_1", closedAt: new Date(), openingFloat: 100 });

    expect(await autoCloseCashSession(TUESDAY_AFTERNOON)).toEqual({ skipped: "already-closed" });
    expect(mocks.prisma.cashSession.updateMany).not.toHaveBeenCalled();
  });
});

describe("nothing opens the till on a timer any more", () => {
  const source = (path) =>
    // eslint-disable-next-line no-undef
    require("node:fs").readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  test("the auto-session module exposes no scheduled open", () => {
    const job = source("lib/cash-book/auto-session.js");
    expect(job).not.toContain("autoOpenCashSession");
    expect(job).not.toContain("openCashSessionInternal");
  });

  test("neither runner calls one", () => {
    expect(source("lib/background-jobs.js")).not.toContain("autoOpenCashSession");
    // The route keeps one mention: a comment explaining why it was removed.
    const route = source("app/api/cron/cash-book/route.js").replace(/^\s*\*.*$/gm, "");
    expect(route).not.toContain("autoOpenCashSession");
  });

  test("the till still opens lazily, on the first cash-taking action", () => {
    const lifecycle = source("lib/cash-book/session-lifecycle.js");
    expect(lifecycle).toContain("export async function ensureCashSessionOpen");
    for (const caller of [
      "actions/boutique/point-of-sale.js",
      "actions/boutique/orders.js",
      "actions/appointment/manage-appointment.js",
      "actions/counter/create-reservation.js",
    ]) {
      expect(source(caller), caller).toContain("ensureCashSessionOpen");
    }
  });

  // The throw that broke the cooldown in the first place.
  test("revalidating the caisse page can never fail its caller", () => {
    const revalidate = source("lib/cash-book/revalidate-caisse.js");
    expect(revalidate).toMatch(/try\s*\{[\s\S]*revalidatePath[\s\S]*\}\s*catch/);
  });
});
