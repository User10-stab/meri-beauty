import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import {
  seedAdmin,
  seedStockedVariant,
  seedOrder,
  seedPromoCode,
  readPromoUsage,
} from "./fixtures/seed-dashboard.mjs";

/**
 * A promo code that is claimed and never given back.
 *
 * `usedCount` is claimed atomically at booking — `createOrderFromCart` does a
 * conditional `updateMany` gated on `usedCount < maxUses`, which is the right
 * shape — and it has to be released again whenever the order that claimed it
 * stops existing. There are four such moments, each in a different module:
 *
 *   abandoned checkout expires   lib/orders/expire-stale-orders.js
 *   staff confirm "never came"   actions/boutique/orders.js
 *   a paid order is refunded     lib/refunds/open-refund-operation.js
 *   the 14-day grace lapses      lib/orders/expire-stale-orders.js  ← added by me
 *
 * Only the refund path had any real coverage. The one I wrote myself had none
 * beyond a mocked unit test, which is exactly the coverage that proves a
 * `prisma.promoCode.updateMany` call exists rather than that a code becomes
 * usable again.
 *
 * The codes here are **single-use** on purpose. With `maxUses: 1` a leak is
 * not an off-by-one in a column nobody reads — it is a code that can never be
 * redeemed again, which is what a customer would actually experience.
 */

const CRON_TIMEOUT = 120_000;
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

// Mirrors PICKUP_VERIFICATION_GRACE_DAYS in lib/orders/expire-stale-orders.js;
// restated because the Playwright config resolves no "@/" alias. A contract
// test asserts the two still agree.
const PICKUP_VERIFICATION_GRACE_DAYS = 14;

async function runCronJobs(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set — /api/cron cannot be triggered.");
  const response = await request.get("/api/cron", {
    headers: { authorization: `Bearer ${secret}` },
    timeout: CRON_TIMEOUT,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test.describe("a promo code is given back when the order that claimed it dies", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("an abandoned checkout releases it", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "promo-abandoned" });
    const { variant } = await seedStockedVariant({ label: "promo-abandoned", stockQuantity: 10 });
    const promo = await seedPromoCode({ label: "abandoned" });

    await seedOrder({
      variant,
      customer,
      status: "PENDING_PAYMENT",
      fulfilmentMode: "PICKUP_PREPAID",
      quantity: 1,
      expiresAt: anHourAgo(),
      promoCode: promo,
    });

    // Claimed, and therefore exhausted: this code cannot be used again by
    // anybody until it comes back.
    expect(await readPromoUsage(promo.id)).toEqual({ used: 1, maxUses: 1 });

    await runCronJobs(request);

    expect(
      (await readPromoUsage(promo.id)).used,
      "an abandoned checkout kept the promo code it never paid for",
    ).toBe(0);
  });

  test("an uncollected pickup keeps it until somebody decides", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "promo-pickup" });
    const { variant } = await seedStockedVariant({ label: "promo-pickup", stockQuantity: 10 });
    const promo = await seedPromoCode({ label: "pickup" });

    await seedOrder({
      variant,
      customer,
      status: "PENDING_PICKUP",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 1,
      expiresAt: anHourAgo(),
      promoCode: promo,
    });

    await runCronJobs(request);

    // The mirror of the stock rule. If the customer collected the goods and
    // nobody recorded it, the discount they were given is just as real as
    // the goods — handing the code back to somebody else at that point sells
    // the same promotion twice.
    expect(
      (await readPromoUsage(promo.id)).used,
      "an expired pickup released its promo code before anybody ruled on it",
    ).toBe(1);
  });

  test("the 14-day grace lapsing releases it with the stock", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "promo-grace" });
    const { variant } = await seedStockedVariant({ label: "promo-grace", stockQuantity: 10 });
    const promo = await seedPromoCode({ label: "grace" });

    const order = await seedOrder({
      variant,
      customer,
      status: "EXPIRED",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 1,
      cancelledAt: daysAgo(PICKUP_VERIFICATION_GRACE_DAYS + 1),
      promoCode: promo,
    });

    expect(await readPromoUsage(promo.id)).toEqual({ used: 1, maxUses: 1 });

    await runCronJobs(request);

    // The path with no real coverage until now. `releaseUnverifiedPickups`
    // gives the stock back; the promo code was held for the same order and
    // for the same reason, so it has to come back in the same breath — a
    // release that frees the goods but not the discount leaves a code
    // permanently spent on an order that no longer exists.
    expect(
      (await readPromoUsage(promo.id)).used,
      "the automatic release freed the stock but kept the promo code",
    ).toBe(0);

    const released = await prisma.order.findUnique({
      where: { id: order.id },
      select: { stockReleasedAt: true },
    });
    expect(released.stockReleasedAt, "the order was not released at all").not.toBeNull();
  });

  test("a staff verdict of 'never came' releases it too", async ({ browser }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "promo" });
    const customer = await seedCustomer({ label: "promo-verdict" });
    const { variant } = await seedStockedVariant({ label: "promo-verdict", stockQuantity: 10 });
    const promo = await seedPromoCode({ label: "verdict" });

    const order = await seedOrder({
      variant,
      customer,
      status: "EXPIRED",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 1,
      cancelledAt: new Date(),
      promoCode: promo,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/orders");

    // Same locator shape as boutique-pickup-verification.spec.mjs: the
    // worklist renders one <li> per order, identified by its number.
    const card = page.locator("li").filter({ hasText: `n°${order.orderNumber}` }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: /jamais retir/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /jamais retir/i }).click();

    // Read the toast before the database. Both outcomes close the dialog and
    // re-render, so the refusal reports itself in the server's own words
    // instead of surfacing as a promo-count assertion (T6).
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
    const toast = await page.locator("[data-sonner-toast]").first().innerText();
    expect(toast, `releasing the stock was refused: ${toast}`).toMatch(/remis en vente/i);

    await expect
      .poll(() => readPromoUsage(promo.id).then((p) => p.used), {
        message: "confirming the customer never came kept her promo code spent",
        timeout: 20_000,
      })
      .toBe(0);

    await context.close();
  });
});
