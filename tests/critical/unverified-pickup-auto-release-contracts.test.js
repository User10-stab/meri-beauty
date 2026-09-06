import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findMany: vi.fn(), updateMany: vi.fn() },
    salon: { findUnique: vi.fn() },
    productVariant: { update: vi.fn() },
    promoCode: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } } } }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/orders/fulfill-order-payment", () => ({ fulfillOrderPayment: vi.fn() }));

import { releaseUnverifiedPickups, PICKUP_VERIFICATION_GRACE_DAYS } from "@/lib/orders/expire-stale-orders";

function unverifiedPickup(overrides = {}) {
  return {
    id: "order_stale_pickup",
    orderNumber: 733,
    status: "EXPIRED",
    fulfilmentMode: "PICKUP_ON_SITE",
    promoCodeId: "promo_1",
    stockReleasedAt: null,
    cancelledAt: new Date("2026-08-01T10:00:00Z"),
    items: [{ id: "item_1", variantId: "variant_1", quantity: 2, productName: "Sérum", variantName: "30ml" }],
    user: { fullName: "Cliente", email: "cliente@example.com" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.salon.findUnique.mockResolvedValue({ email: "salon@example.com" });
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.prisma.$transaction.mockImplementation(async (callback) =>
    callback({
      order: { updateMany: mocks.prisma.order.updateMany },
      productVariant: { update: mocks.prisma.productVariant.update },
      promoCode: { updateMany: mocks.prisma.promoCode.updateMany },
      auditLog: { create: mocks.prisma.auditLog.create },
    }),
  );
  mocks.prisma.order.updateMany.mockResolvedValue({ count: 1 });
});

/**
 * expireStaleOrders deliberately refuses to guess about an expired on-site
 * pickup and holds its stock until a human rules on it. That is right — the
 * failure it avoids (selling goods already in a customer's bag) cannot be
 * undone, while the one it accepts (not selling goods that are on the shelf)
 * is one click away at any time.
 *
 * But "one click away at any time" is only worth anything if somebody
 * eventually clicks, and nobody opens a worklist unprompted forever. This is
 * the ceiling on that hold, and the whole point of it is that it must behave
 * exactly like the human decision it stands in for — same release, same
 * idempotency, same promo handling — while staying *distinguishable* from
 * one in the audit trail.
 */
describe("the hold on an unverified pickup has a ceiling", () => {
  test("stock and promo usage go back, exactly as a staff verdict would release them", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([unverifiedPickup()]);

    const result = await releaseUnverifiedPickups();

    expect(result.releasedCount).toBe(1);
    expect(mocks.prisma.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reservedQuantity: { decrement: 2 } } }),
    );
    expect(mocks.prisma.promoCode.updateMany).toHaveBeenCalled();
  });

  test("nothing is released before the grace period is up", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([]);

    await releaseUnverifiedPickups();

    const [{ where }] = mocks.prisma.order.findMany.mock.calls[0];
    expect(where).toMatchObject({
      fulfilmentMode: "PICKUP_ON_SITE",
      status: "EXPIRED",
      stockReleasedAt: null,
    });

    // Measured from the expiry, not from the order: an order that sat in
    // PENDING_PICKUP for a month before expiring still gets its full
    // verification window.
    const cutoff = where.cancelledAt.lt;
    const expectedDaysAgo = PICKUP_VERIFICATION_GRACE_DAYS * 24 * 60 * 60 * 1000;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(expectedDaysAgo - 5_000);
    expect(Date.now() - cutoff.getTime()).toBeLessThanOrEqual(expectedDaysAgo + 5_000);
  });

  test("the claim is gated on stockReleasedAt, so a staff click at the same moment cannot double-release", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([unverifiedPickup()]);
    // The row was claimed by confirmExpiredPickupNotCollected a moment ago.
    mocks.prisma.order.updateMany.mockResolvedValue({ count: 0 });

    const result = await releaseUnverifiedPickups();

    expect(mocks.prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order_stale_pickup", status: "EXPIRED", stockReleasedAt: null },
      }),
    );
    // This decrements reservedQuantity. Losing the claim must stop everything
    // downstream of it, not just skip the update.
    expect(mocks.prisma.productVariant.update).not.toHaveBeenCalled();
    expect(mocks.prisma.promoCode.updateMany).not.toHaveBeenCalled();
    expect(result.releasedCount).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  test("an automatic release is distinguishable from a human one", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([unverifiedPickup()]);

    await releaseUnverifiedPickups();

    // stockReleasedByUserId is left null — that absence IS the record that
    // nobody decided this. Setting it to some system user would erase the
    // distinction that makes this reviewable.
    const [{ data }] = mocks.prisma.order.updateMany.mock.calls[0];
    expect(data).toEqual({ stockReleasedAt: expect.any(Date) });
    expect(data).not.toHaveProperty("stockReleasedByUserId");

    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: null,
          action: "order.expired_pickup_stock_released_automatically",
          entityType: "Order",
          entityId: "order_stale_pickup",
        }),
      }),
    );
    // A different action string from the human one, so an audit query can
    // separate "staff checked the shelf" from "the clock ran out".
    const [{ data: logged }] = mocks.prisma.auditLog.create.mock.calls[0];
    expect(logged.action).not.toBe("order.expired_pickup_stock_released");
  });

  test("the customer is told, and asked to flag it if they had actually collected", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([unverifiedPickup()]);

    await releaseUnverifiedPickups();

    const toCustomer = mocks.sendEmail.mock.calls.find((call) => call[0].to === "cliente@example.com")?.[0];
    expect(toCustomer, "the customer was not told their order was released").toBeTruthy();
    // Now it IS true that the articles are back on sale, unlike the day-7
    // notice, so this one may say so.
    expect(toCustomer.text).toContain("remis en vente");
    expect(toCustomer.text).toContain("corriger notre stock");
  });

  test("the salon gets one digest, not one e-mail per order", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      unverifiedPickup(),
      unverifiedPickup({ id: "order_two", orderNumber: 734 }),
      unverifiedPickup({ id: "order_three", orderNumber: 735 }),
    ]);

    await releaseUnverifiedPickups();

    const toSalon = mocks.sendEmail.mock.calls.filter((call) => call[0].to === "salon@example.com");
    expect(toSalon).toHaveLength(1);
    // If any of these had really been collected, this is the moment the stock
    // figure silently became wrong. The digest has to say so.
    expect(toSalon[0][0].text).toContain("surévalué");
    expect(toSalon[0][0].text).toContain("n°733");
    expect(toSalon[0][0].text).toContain("n°735");
  });

  test("no releases means no digest at all", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([]);

    await releaseUnverifiedPickups();

    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  test("one failing order does not abandon the rest of the batch", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      unverifiedPickup(),
      unverifiedPickup({ id: "order_two", orderNumber: 734 }),
    ]);
    mocks.prisma.$transaction
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockImplementationOnce(async (callback) =>
        callback({
          order: { updateMany: mocks.prisma.order.updateMany },
          productVariant: { update: mocks.prisma.productVariant.update },
          promoCode: { updateMany: mocks.prisma.promoCode.updateMany },
          auditLog: { create: mocks.prisma.auditLog.create },
        }),
      );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await releaseUnverifiedPickups();

    expect(result.releasedCount).toBe(1);
  });
});

describe("the backstop actually runs", () => {
  test("both job runners call it, so it cannot work in one deployment mode and not the other", () => {
    // The whole design depends on this firing. A backstop wired into only one
    // runner is a backstop that silently does not exist under the other, and
    // JOBS_RUNNER is chosen outside this codebase.
    for (const path of ["app/api/cron/route.js", "lib/background-jobs.js"]) {
      const runner = source(path);
      expect(runner, path).toContain("releaseUnverifiedPickups");
      expect(runner, path).toContain('["releaseUnverifiedPickups", releaseUnverifiedPickups]');
    }
  });

  test("it is not exported from a \"use server\" module", () => {
    const expiry = source("lib/orders/expire-stale-orders.js");
    // Every export from such a module is a public unauthenticated POST
    // endpoint, and this one mutates stock across every stale order.
    expect(expiry.trimStart().startsWith('"use server"')).toBe(false);
  });

  test("the grace period is a named policy, not a number buried in a query", () => {
    const expiry = source("lib/orders/expire-stale-orders.js");
    expect(expiry).toContain("export const PICKUP_VERIFICATION_GRACE_DAYS");
  });

  test("the e2e spec's copy of the grace period still matches the real one", () => {
    // The Playwright dashboard config resolves no "@/" alias, so that spec
    // cannot import this module (it reaches for @/lib/prisma on the way in)
    // and restates the number instead. A restated constant drifts the moment
    // somebody tunes the policy — which is precisely what is still open with
    // Marie — and the spec would then quietly seed orders on the wrong side
    // of a boundary it believes it is testing.
    const spec = source("tests/e2e-dashboard/boutique-order-expiry.spec.mjs");
    const match = spec.match(/const PICKUP_VERIFICATION_GRACE_DAYS = (\d+);/);
    expect(match, "the e2e spec no longer declares the grace period").not.toBeNull();
    expect(Number(match[1])).toBe(PICKUP_VERIFICATION_GRACE_DAYS);
  });
});

describe("the worklist is visible enough to be worked", () => {
  test("the orders nav item carries a badge and the layout supplies its count", () => {
    // Without this the 14-day backstop stops being a backstop and quietly
    // becomes the normal path, because nobody opens the worklist unprompted.
    expect(source("components/dashboard/Layouts/sidebar/data/index.js")).toContain('badge: "pickupsToVerify"');
    expect(source("app/dashboard/layout.jsx")).toContain("countPickupsToVerify");
  });

  test("the badge counts the same rows the worklist lists", () => {
    const counter = source("lib/orders/count-pickups-to-verify.js");
    const worklist = source("actions/boutique/orders.js");
    const predicate = 'fulfilmentMode: "PICKUP_ON_SITE", status: "EXPIRED", stockReleasedAt: null';
    // A badge that counts something other than what the screen shows is worse
    // than no badge — it sends people to an empty list, and they stop looking.
    expect(counter).toContain(predicate);
    expect(worklist).toContain(predicate);
  });

  test("staff who cannot open the orders screen get no count and no query", () => {
    const counter = source("lib/orders/count-pickups-to-verify.js");
    expect(counter).toContain("DASHBOARD_PERMISSIONS.ORDERS.includes(role)");
    expect(counter).toContain("STAFF_PERMISSIONS.ORDERS");
  });
});
