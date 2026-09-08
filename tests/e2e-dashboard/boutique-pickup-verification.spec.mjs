import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStockedVariant, seedOrder, readStock } from "./fixtures/seed-dashboard.mjs";

/**
 * The expired-pickup worklist, and the stock arithmetic behind its two
 * buttons.
 *
 * An expired on-site pickup is two completely different situations wearing
 * one status: the goods are still on a shelf, or they are already in a
 * customer's bag because staff handed them over without running the pickup
 * flow. The cron cannot tell, so it stopped restocking on a guess — it holds
 * the reservation and lists the order here, where whoever can walk over and
 * look decides.
 *
 * That decision moves real stock, which is why it is worth an end-to-end
 * test: the contract tests in tests/critical/ prove the branch exists in the
 * source; only running it proves reservedQuantity actually lands where it
 * should. Getting this wrong in either direction is expensive — restock a
 * item that has left the shop and it gets sold twice; fail to restock one
 * that never left and it is invisible stock nobody can buy.
 */

const ORDERS_PAGE = "/dashboard/boutique/orders";

async function seedExpiredPickup({ label, stockQuantity = 10, quantity = 2, stockReleasedAt = null }) {
  const customer = await seedCustomer({ label: `pickup-${label}` });
  const { variant } = await seedStockedVariant({ label, stockQuantity });
  const order = await seedOrder({
    variant,
    customer,
    status: "EXPIRED",
    fulfilmentMode: "PICKUP_ON_SITE",
    quantity,
    stockReleasedAt,
  });
  return { customer, variant, order };
}

/** The card for one order inside the worklist. */
function cardFor(page, orderNumber) {
  return page.locator("li").filter({ hasText: `n°${orderNumber}` }).first();
}

/**
 * One login for the whole file, deliberately — not a beforeEach.
 *
 * actions/auth/login.js rate-limits to 10 attempts per email+IP per 5
 * minutes. A beforeEach logging the same admin in for every test burns
 * through that within a couple of runs, and the symptom is not an error but
 * the login form silently staying put: every test in the file then fails at
 * the sign-in step, which reads like a broken app rather than a suite that
 * signed in too often.
 */
test.describe("expired on-site pickups are resolved by a human, not a guess", () => {
  test.describe.configure({ mode: "serial" });

  let page;

  test.beforeAll(async ({ browser }) => {
    // Its own admin — see T1c in E2E_FINDINGS.md.
    const admin = await seedAdmin({ label: "pickups" });
    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("an expired pickup is listed, and its reservation is still standing", async () => {
    const { variant, order } = await seedExpiredPickup({ label: "listed", quantity: 2 });

    // The state the cron leaves behind: expired, but nothing given back.
    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 2 });

    await page.goto(ORDERS_PAGE);
    await expect(page.getByRole("heading", { name: /retraits à vérifier/i })).toBeVisible();

    const card = cardFor(page, order.orderNumber);
    await expect(card).toBeVisible();
    // The line items matter: staff have to know what to go and look for.
    await expect(card).toContainText(`2 × ${order.items[0].productName}`);
  });

  test("an order whose stock is already back on sale is not listed", async () => {
    // The backfill invariant. Every EXPIRED order predating stockReleasedAt
    // was marked released by the migration, precisely so this worklist opens
    // empty instead of asking staff to re-adjudicate months of history.
    const { order } = await seedExpiredPickup({ label: "already-released", stockReleasedAt: new Date() });

    await page.goto(ORDERS_PAGE);
    await expect(cardFor(page, order.orderNumber)).toHaveCount(0);
  });

  test("confirming she never came puts the articles back on sale, once", async () => {
    const { variant, order } = await seedExpiredPickup({ label: "not-collected", quantity: 3 });
    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 3 });

    await page.goto(ORDERS_PAGE);
    const card = cardFor(page, order.orderNumber);
    await card.getByRole("button", { name: /jamais retir/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /jamais retir/i }).click();

    // The toast, not the card. Both outcomes close the dialog and re-render
    // the list, so "the card went away" is equally true when the server
    // refused — and the failure then reads as a stock assertion rather than
    // as the refusal it is.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
    const releaseToast = await page.locator("[data-sonner-toast]").first().innerText();
    expect(releaseToast, `releasing the stock was refused: ${releaseToast}`).toMatch(/remis en vente/i);
    await expect(cardFor(page, order.orderNumber)).toHaveCount(0);

    // The reservation is released; the shelf count never moved, because
    // nothing was ever sold.
    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 0 });

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, stockReleasedAt: true, stockReleasedByUserId: true },
    });
    expect(after.status).toBe("EXPIRED");
    expect(after.stockReleasedAt).not.toBeNull();
    // Who decided is the point of the whole feature — an anonymous restock
    // is exactly the automatic guess this replaced.
    expect(after.stockReleasedByUserId).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "Order", entityId: order.id, action: "order.expired_pickup_stock_released" },
    });
    expect(audit, "no audit entry recorded for the stock release").not.toBeNull();
  });

  test("confirming she did come sells the goods rather than restocking them", async () => {
    const { variant, order } = await seedExpiredPickup({ label: "collected", quantity: 2 });

    await page.goto(ORDERS_PAGE);
    const card = cardFor(page, order.orderNumber);
    await card.getByRole("button", { name: /finaliser le retrait/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Unpaid on-site pickup: the counter has to take the money now.
    await expect(dialog).toContainText(/paiement|payer/i);
    await dialog.getByRole("button", { name: /^confirmer/i }).click();

    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
    const pickupToast = await page.locator("[data-sonner-toast]").first().innerText();
    expect(pickupToast, `completing the pickup was refused: ${pickupToast}`).toMatch(/remise au client/i);
    await expect(cardFor(page, order.orderNumber)).toHaveCount(0);

    // A sale, not a restock: both numbers come down together.
    expect(await readStock(variant.id)).toEqual({ stock: 8, reserved: 0 });

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, pickedUpAt: true, stockReleasedAt: true },
    });
    expect(after.status).toBe("COMPLETED");
    expect(after.pickedUpAt).not.toBeNull();
    // Nothing went back on sale, so this must stay null — it is what stops
    // the order reappearing in the worklist.
    expect(after.stockReleasedAt).toBeNull();

    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id },
      select: { status: true, paidAmount: true },
    });
    expect(payment, "completing an unpaid pickup recorded no payment").not.toBeNull();
    expect(payment.status).toBe("PAID");
  });
});
