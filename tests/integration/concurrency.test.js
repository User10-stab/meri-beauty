import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { cookieJarStorage, makeCookieJar, testTag, withCookieJar } from "./helpers.js";

// These are the SAME modules production code imports — nothing about the
// business logic under test is mocked. Only the Next.js request plumbing
// (cookies) and true third parties (Stripe, Resend) are faked, exactly the
// way CRITICAL_TESTING.md already treats them for the unit-level suite.
vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = cookieJarStorage.getStore();
    if (!jar) throw new Error("cookies() called outside withCookieJar() in this test");
    return jar;
  },
}));

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ id: "cs_test_fake", url: "https://stripe.test/fake" }),
        retrieve: vi.fn().mockResolvedValue({ payment_status: "unpaid" }),
      },
    },
    refunds: { create: vi.fn() },
  },
}));

const { prisma } = await import("@/lib/prisma");
const { createOrderFromCart } = await import("@/actions/boutique/orders");
const { createWorkshopReservation } = await import("@/actions/workshops/create-workshop-reservation");

const tag = testTag();

// customer-identity's phoneSchema is digits-only (plus separators) — no
// letters allowed — so the uniqueness suffix has to be numeric too.
let phoneCounter = 0;
function uniquePhone() {
  phoneCounter += 1;
  return `+32${Date.now()}${phoneCounter}`;
}

describe("real concurrency: two requests racing the same last unit of stock", () => {
  let product, variant, user1, user2, cart1, cart2;

  beforeAll(async () => {
    product = await prisma.product.create({
      data: { name: `${tag}-product`, slug: `${tag}-product`, status: "ACTIVE" },
    });
    variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: "Standard",
        sku: `${tag}-sku`,
        price: 20,
        costPrice: 5,
        stockQuantity: 1, // exactly one unit — only one of the two racing checkouts can win
        reservedQuantity: 0,
        weightGrams: 100,
      },
    });

    // Pre-verified so createOrderFromCart's resolveOrCreateCustomer finds an
    // existing, already-confirmed user instead of creating a new one and
    // sending a real verification email — keeps this test to exactly the
    // stock-locking logic under test.
    user1 = await prisma.user.create({
      data: { fullName: "Race Customer One", email: `${tag}-1@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
    user2 = await prisma.user.create({
      data: { fullName: "Race Customer Two", email: `${tag}-2@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });

    // Two independent guest carts (no userId) — each represents a different
    // browser/customer arriving with their own cart cookie, both holding the
    // same single-stock variant at the moment they check out.
    cart1 = await prisma.cart.create({ data: { token: `${tag}-cart-1`, status: "ACTIVE" } });
    cart2 = await prisma.cart.create({ data: { token: `${tag}-cart-2`, status: "ACTIVE" } });
    await prisma.cartItem.create({ data: { cartId: cart1.id, variantId: variant.id, quantity: 1 } });
    await prisma.cartItem.create({ data: { cartId: cart2.id, variantId: variant.id, quantity: 1 } });
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany({ where: { variantId: variant.id } });
    await prisma.order.deleteMany({ where: { cartId: { in: [cart1.id, cart2.id] } } });
    await prisma.cartItem.deleteMany({ where: { cartId: { in: [cart1.id, cart2.id] } } });
    await prisma.cart.deleteMany({ where: { id: { in: [cart1.id, cart2.id] } } });
    await prisma.productVariant.delete({ where: { id: variant.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
  });

  test("exactly one of two simultaneous checkouts on the last unit succeeds, the other is told to retry", async () => {
    const checkoutInput = (customer) => ({
      fulfilmentMode: "SHIPPING_PREPAID",
      customerInfo: { fullName: customer.fullName, email: customer.email, phone: customer.phone },
      pickupPoint: { id: null, name: "Point Test", address: "Rue Test 1", postalCode: "1000", city: "Bruxelles" },
    });

    const [result1, result2] = await Promise.all([
      withCookieJar(makeCookieJar({ boutique_cart_token: cart1.token }), () => createOrderFromCart(checkoutInput(user1))),
      withCookieJar(makeCookieJar({ boutique_cart_token: cart2.token }), () => createOrderFromCart(checkoutInput(user2))),
    ]);

    const results = [result1, result2];
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/stock a changé/i);

    // The DB, not just the return value, must agree: only one unit existed
    // and only one reservation should have landed on it.
    const finalVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(finalVariant.reservedQuantity).toBe(1);

    const orders = await prisma.order.findMany({ where: { cartId: { in: [cart1.id, cart2.id] } } });
    expect(orders).toHaveLength(1);
  });
});

describe("real concurrency: two customers racing the last seat of a workshop session", () => {
  let activity, session, user1, user2;

  beforeAll(async () => {
    activity = await prisma.activity.create({
      data: { type: "WORKSHOP", title: `${tag}-workshop`, price: 50, duration: 60, capacity: 1, status: "PUBLISHED" },
    });
    session = await prisma.workshopSession.create({
      data: { workshopId: activity.id, startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), capacity: 1, status: "SCHEDULED" },
    });
    user1 = await prisma.user.create({
      data: { fullName: "Seat Racer One", email: `${tag}-seat-1@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
    user2 = await prisma.user.create({
      data: { fullName: "Seat Racer Two", email: `${tag}-seat-2@example.test`, phone: uniquePhone(), password: "x", role: "CUSTOMER", emailVerified: true },
    });
  });

  afterAll(async () => {
    await prisma.workshopReservation.deleteMany({ where: { sessionId: session.id } });
    await prisma.workshopSession.delete({ where: { id: session.id } });
    await prisma.activity.delete({ where: { id: activity.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id] } } });
  });

  test("exactly one of two simultaneous bookings on the last seat succeeds", async () => {
    const bookingInput = (customer) => ({
      sessionId: session.id,
      activityId: activity.id,
      seatsCount: 1,
      paymentMethod: "FULL",
      customerInfo: { fullName: customer.fullName, email: customer.email, phone: customer.phone },
    });

    const [result1, result2] = await Promise.all([
      createWorkshopReservation(bookingInput(user1)),
      createWorkshopReservation(bookingInput(user2)),
    ]);

    const results = [result1, result2];
    const successes = results.filter((r) => r.success && r.url);
    const failures = results.filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toMatch(/place.*disponible|SOLD_OUT/i);

    const reservations = await prisma.workshopReservation.findMany({ where: { sessionId: session.id } });
    expect(reservations).toHaveLength(1);
    expect(reservations[0].seatsCount).toBe(1);
  });
});
