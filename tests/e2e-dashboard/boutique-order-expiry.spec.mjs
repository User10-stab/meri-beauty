import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedStockedVariant, seedOrder, readStock } from "./fixtures/seed-dashboard.mjs";

/**
 * The expiry job, run the way production runs it.
 *
 * The whole point of the change this covers is that the two stale-order
 * branches treat stock *differently*, and that difference is invisible to any
 * test that mocks the database:
 *
 *   PENDING_PAYMENT was never handed to anybody, so its reservation is
 *   released automatically and the customer is told.
 *
 *   PICKUP_ON_SITE is the opposite — "not marked collected" and "never handed
 *   over" look identical from a cron job, and the likelier of the two is
 *   staff giving the goods to the customer and forgetting to run the pickup
 *   flow. Restocking on that guess put an item that had already left the
 *   salon back on sale, where it could be sold a second time. So it holds the
 *   reservation and raises a worklist instead.
 *
 * And a third case, added with the backstop: a pickup nobody ever ruled on.
 * Holding is only defensible while somebody is going to decide, and nobody
 * works a worklist unprompted forever — so after PICKUP_VERIFICATION_GRACE_DAYS
 * the hold ends without a verdict. That is the only branch here that releases
 * stock without either a payment failure or a human, so it is the one most
 * worth watching in a real database.
 *
 * Driven through GET /api/cron rather than by importing the job, because that
 * endpoint *is* the production trigger — and it also exercises the advisory
 * lock and the heartbeat on the way past.
 *
 * That endpoint runs all eight jobs, so before writing this I checked what
 * else it would touch in the dev database: zero stale orders, zero workshop
 * reminders and zero formation reminders were due, and — re-measured when the
 * release job was added — two pickups awaiting a verdict, none of them past
 * the grace period. It seeds its own orders and asserts only on those. If that
 * ever stops being true, this test starts mutating a colleague's data as a
 * side effect — so re-check rather than assume when it fails oddly.
 */

async function runCronJobs(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set — /api/cron cannot be triggered.");

  const response = await request.get("/api/cron", {
    headers: { authorization: `Bearer ${secret}` },
    timeout: 120_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/**
 * Mirrors PICKUP_VERIFICATION_GRACE_DAYS in lib/orders/expire-stale-orders.js.
 *
 * Restated rather than imported: that module reaches for "@/lib/prisma" and
 * friends, and this config resolves no "@/" alias, so importing it fails at
 * load. unverified-pickup-auto-release-contracts.test.js asserts the two
 * numbers still agree, so the copy cannot drift silently.
 */
const PICKUP_VERIFICATION_GRACE_DAYS = 14;

test.describe("stale orders expire, and only one of the two branches gives stock back", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("an abandoned checkout is cancelled and its reservation released", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "expiry-abandoned" });
    const { variant } = await seedStockedVariant({ label: "abandoned", stockQuantity: 10 });
    const order = await seedOrder({
      variant,
      customer,
      status: "PENDING_PAYMENT",
      fulfilmentMode: "PICKUP_PREPAID",
      quantity: 2,
      expiresAt: anHourAgo(),
    });

    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 2 });

    // No stripeCheckoutSessionId on purpose: with one, the job calls Stripe
    // to make sure the customer did not pay seconds before the window shut.
    // That guard has its own coverage; this test is about the stock.
    await runCronJobs(request);

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, cancelledAt: true, stockReleasedAt: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledAt).not.toBeNull();
    expect(after.stockReleasedAt).not.toBeNull();

    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 0 });
  });

  test("an uncollected on-site pickup expires but keeps its reservation", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "expiry-pickup" });
    const { variant } = await seedStockedVariant({ label: "pickup", stockQuantity: 10 });
    const order = await seedOrder({
      variant,
      customer,
      status: "PENDING_PICKUP",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 3,
      expiresAt: anHourAgo(),
    });

    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 3 });

    await runCronJobs(request);

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, cancelledAt: true, stockReleasedAt: true },
    });
    expect(after.status).toBe("EXPIRED");
    // cancelledAt is set on this branch too — it used to stay null, which
    // broke every "cancelled orders" query even though the order was just as
    // dead as a payment timeout.
    expect(after.cancelledAt).not.toBeNull();

    // The two assertions this whole test exists for.
    expect(after.stockReleasedAt, "an expired pickup released its stock automatically").toBeNull();
    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 3 });
  });

  test("a pickup nobody ever ruled on is released once the grace period runs out", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "expiry-unverified" });
    const { variant } = await seedStockedVariant({ label: "unverified", stockQuantity: 10 });
    const order = await seedOrder({
      variant,
      customer,
      status: "EXPIRED",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 4,
      // Expired a day past the grace period. The job measures from
      // cancelledAt, so this is the only way to age an order — and ageing it
      // is the entire scenario, since the interesting state takes three weeks
      // to reach in real time.
      cancelledAt: daysAgo(PICKUP_VERIFICATION_GRACE_DAYS + 1),
    });

    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 4 });

    // It should be on the worklist right up until the moment it is released:
    // the backstop is the failure of that worklist, not a replacement for it.
    const beforeRun = await prisma.order.count({
      where: { id: order.id, status: "EXPIRED", stockReleasedAt: null },
    });
    expect(beforeRun).toBe(1);

    await runCronJobs(request);

    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, stockReleasedAt: true, stockReleasedByUserId: true },
    });
    expect(after.status).toBe("EXPIRED");
    expect(after.stockReleasedAt, "the grace period lapsed but the stock was still held").not.toBeNull();
    // Null actor is the record that nobody decided this. A staff release sets
    // it, so this is what keeps "the shelf was checked" and "the clock ran
    // out" apart when somebody audits a stock discrepancy later.
    expect(after.stockReleasedByUserId).toBeNull();

    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 0 });

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Order", entityId: order.id },
      select: { action: true, actorId: true },
    });
    expect(log?.action).toBe("order.expired_pickup_stock_released_automatically");
    expect(log.actorId).toBeNull();
  });

  test("a pickup still inside the grace period is left alone", async ({ request }) => {
    test.setTimeout(180_000);

    const customer = await seedCustomer({ label: "expiry-recent" });
    const { variant } = await seedStockedVariant({ label: "recent", stockQuantity: 10 });
    const order = await seedOrder({
      variant,
      customer,
      status: "EXPIRED",
      fulfilmentMode: "PICKUP_ON_SITE",
      quantity: 2,
      cancelledAt: daysAgo(PICKUP_VERIFICATION_GRACE_DAYS - 1),
    });

    await runCronJobs(request);

    // One day short. The window is the whole safeguard — if the boundary is
    // wrong in this direction, the backstop quietly becomes the normal path
    // and the human verdict never gets its chance.
    const after = await prisma.order.findUnique({
      where: { id: order.id },
      select: { stockReleasedAt: true },
    });
    expect(after.stockReleasedAt, "released a day before the grace period was up").toBeNull();
    expect(await readStock(variant.id)).toEqual({ stock: 10, reserved: 2 });
  });
});
