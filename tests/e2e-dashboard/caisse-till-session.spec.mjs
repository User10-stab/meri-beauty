import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin } from "./fixtures/seed-dashboard.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";

/**
 * The daily till: opening it, the rule that everything at the counter needs
 * it, and the count at closing.
 *
 * Cash is the least reversible money in this system — there is no webhook to
 * reconcile it against and no Stripe dashboard to look it up in, only the
 * cash book. So the invariants here are worth exercising for real rather than
 * by grep.
 *
 * The one this suite exists to pin down is the answer to a question that came
 * up while building the permission model: holding CASH_REGISTER (or
 * POINT_OF_SALE) is *not* enough to take money at the counter. A till session
 * has to be open first, for every payment method — not just cash. Before that
 * gate existed, a card sale rung up with no session open completed normally
 * and carried `cashSessionId: null` forever, which is unrecoverable after the
 * fact.
 *
 * ── A global resource ───────────────────────────────────────────────────
 * There is exactly one open CashSession at a time, system-wide, and the
 * advisory lock in openCashSession enforces it. That makes this spec
 * unavoidably stateful: it opens the till it needs and closes it again, and
 * it refuses to start if somebody else's session is already open rather than
 * quietly closing it. Closing a till writes a Z-closure into a legally shaped
 * cash book — not something a test may do to a session it did not open.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";
const CAISSE_PAGE = "/dashboard/boutique/caisse";
const OPENING_FLOAT = 150;

test.describe("the daily till", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  /** The session this spec opened, so afterAll only ever closes its own. */
  let openedSessionId = null;

  test.beforeAll(async ({ browser }) => {
    const existing = await prisma.cashSession.findFirst({
      where: { closedAt: null },
      select: { id: true, openedAt: true, openedBy: { select: { fullName: true } } },
    });
    // Skipped, not failed. A salon with its till open is the normal state of
    // the world, not a broken build — turning the whole suite red because
    // somebody is mid-shift would train everyone to ignore it. The skip
    // reason says exactly what to do.
    test.skip(
      Boolean(existing),
      existing
        ? `A till session is already open (${existing.id}, opened ${existing.openedAt.toISOString()} by ` +
            `${existing.openedBy?.fullName ?? "?"}). Only one CashSession can be open system-wide, so this ` +
            "spec cannot open its own — and it will not close somebody else's, because closing a till " +
            "writes a Z-closure into the cash book. Close it from /dashboard/boutique/caisse and re-run."
        : "",
    );

    // One login for the file — actions/auth/login.js rate-limits to 10
    // attempts per email+IP per 5 minutes.
    page = await browser.newPage();
    const admin = await seedAdmin({ label: "caisse" });
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    // Leave the till as it was found: closed. Done directly rather than
    // through the UI so a mid-spec failure still tidies the global resource,
    // and gated on the id this spec opened.
    if (openedSessionId) {
      await prisma.cashSession.updateMany({
        where: { id: openedSessionId, closedAt: null },
        data: { closedAt: new Date(), countedCash: OPENING_FLOAT, expectedCash: OPENING_FLOAT, variance: 0 },
      });
    }
    await page?.close();
    await disconnect();
  });

  test("with no till open, the counter refuses to sell anything", async () => {
    await page.goto(POS_PAGE);

    await expect(page.getByRole("heading", { name: /caisse fermée/i })).toBeVisible();
    // The wording matters as much as the block: staff need to know this is
    // not a cash-only restriction.
    await expect(page.getByText(/quel que soit le mode de paiement/i)).toBeVisible();

    // And no sale surface is offered at all — not a disabled one.
    await expect(page.getByRole("button", { name: /encaisser|payer/i })).toHaveCount(0);
  });

  test("a cashier can open the till from the counter itself", async () => {
    // Opening is part of running the counter: POINT_OF_SALE is enough, and a
    // cashier must be able to start a shift without being handed the
    // financial-review capabilities that CASH_REGISTER carries.
    await page.goto(POS_PAGE);
    await page.locator("#pos-opening-float").fill(String(OPENING_FLOAT));
    await page.getByRole("button", { name: /ouvrir la caisse/i }).click();

    await expect(page.getByRole("heading", { name: /caisse fermée/i })).toHaveCount(0, { timeout: 20_000 });

    const opened = await prisma.cashSession.findFirst({
      where: { closedAt: null },
      select: { id: true, openingFloat: true, openedById: true },
    });
    expect(opened, "no till session was created").not.toBeNull();
    expect(Number(opened.openingFloat)).toBe(OPENING_FLOAT);
    openedSessionId = opened.id;
  });

  test("a second till cannot be opened alongside the first", async () => {
    // Two simultaneously-open sessions would leave every CASH sale with no
    // deterministic owner. openCashSession serialises the check-then-create
    // behind an advisory lock precisely so a double-click cannot do this.
    await page.goto(CAISSE_PAGE);
    await expect(page.getByRole("heading", { name: /session ouverte/i })).toBeVisible();
    // The opening form is not merely disabled — it is not rendered.
    await expect(page.locator("#opening-float")).toHaveCount(0);

    expect(await prisma.cashSession.count({ where: { closedAt: null } })).toBe(1);
  });

  test("closing reconciles what was counted against what was expected", async () => {
    const counted = OPENING_FLOAT + 5;

    await page.goto(CAISSE_PAGE);
    await page.locator("#counted-cash").fill(String(counted));
    await page.getByRole("button", { name: /clôturer la caisse/i }).click();

    await expect(page.getByRole("heading", { name: /aucune session ouverte/i })).toBeVisible({ timeout: 20_000 });

    const closed = await prisma.cashSession.findUnique({
      where: { id: openedSessionId },
      select: { closedAt: true, closedById: true, expectedCash: true, countedCash: true, variance: true },
    });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.closedById).not.toBeNull();

    // No sales were rung up, so expected is exactly the opening float, and
    // the 5 € surplus must be recorded rather than silently absorbed — an
    // unexplained surplus is as much a signal as a shortfall.
    expect(Number(closed.expectedCash)).toBe(OPENING_FLOAT);
    expect(Number(closed.countedCash)).toBe(counted);
    expect(Number(closed.variance)).toBe(5);

    openedSessionId = null; // closed through the UI; afterAll has nothing to do
  });
});
