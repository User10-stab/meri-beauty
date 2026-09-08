import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const mocks = vi.hoisted(() => ({
  prisma: {
    order: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    salon: { findUnique: vi.fn() },
    productVariant: { update: vi.fn() },
    promoCode: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  sendEmail: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } } } }));
vi.mock("@/lib/email", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/orders/fulfill-order-payment", () => ({ fulfillOrderPayment: vi.fn() }));

import { expireStaleOrders } from "@/lib/orders/expire-stale-orders";

function pickupOrder(overrides = {}) {
  return {
    id: "order_pickup",
    orderNumber: 512,
    status: "READY_FOR_PICKUP",
    fulfilmentMode: "PICKUP_ON_SITE",
    promoCodeId: "promo_1",
    stripeCheckoutSessionId: null,
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
      order: { updateMany: mocks.prisma.order.updateMany, update: mocks.prisma.order.update },
      productVariant: { update: mocks.prisma.productVariant.update },
      promoCode: { updateMany: mocks.prisma.promoCode.updateMany },
    }),
  );
  mocks.prisma.order.updateMany.mockResolvedValue({ count: 1 });
});

/**
 * An expired on-site pickup is two completely different situations wearing one
 * status: the goods are on a shelf, or staff handed them to the customer at
 * the counter and never ran completeOrderPickup. The cron cannot tell, and it
 * used to guess — restocking, which put an item that had already left the
 * salon back on sale where it could be sold a second time.
 */
describe("an expired on-site pickup does not restock itself", () => {
  test("the reservation is held: no stock and no promo usage is given back", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([pickupOrder()]);

    const result = await expireStaleOrders();

    expect(result.expiredCount).toBe(1);
    // The order is still expired — it just does not release anything.
    expect(mocks.prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "EXPIRED" }) }),
    );
    expect(mocks.prisma.productVariant.update).not.toHaveBeenCalled();
    expect(mocks.prisma.promoCode.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.order.update).not.toHaveBeenCalled();
  });

  test("both the salon and the customer are told, because only one of them knows the answer", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([pickupOrder()]);

    await expireStaleOrders();

    const recipients = mocks.sendEmail.mock.calls.map((call) => call[0].to);
    expect(recipients).toContain("salon@example.com");
    // The customer used to be left in silence here, on the theory that
    // telling somebody their order expired while they are holding it is
    // worse than telling them later. That protected the wrong party: the
    // salon cannot tell "never came" from "came and nobody recorded it", and
    // the customer can. They are now asked.
    expect(recipients).toContain("cliente@example.com");
  });

  test("the customer is asked, not told the stock is back on sale — because it is not", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([pickupOrder()]);

    await expireStaleOrders();

    const toCustomer = mocks.sendEmail.mock.calls.find((call) => call[0].to === "cliente@example.com")[0];
    // Saying the articles are back on sale to somebody who is about to walk
    // in and collect them is the one genuinely damaging thing this e-mail
    // could do. The only permitted mention of a release is the future,
    // conditional one.
    expect(toCustomer.text).not.toContain("ont été remis en vente");
    expect(toCustomer.text).not.toContain("sont de nouveau disponibles");
    expect(toCustomer.text).toContain("seront automatiquement remis en vente");
    expect(toCustomer.text).toContain("déjà récupérés");
    expect(toCustomer.text).toContain("de côté");
  });

  test("the staff alert no longer claims the stock went back on sale", () => {
    const expiry = source("lib/orders/expire-stale-orders.js");
    expect(expiry).not.toContain("le stock réservé a été automatiquement remis en vente");
    expect(expiry).toContain("Le stock reste réservé");
  });
});

/**
 * The never-paid branch is the opposite case and must keep its old behaviour:
 * nobody ever walked out with an abandoned checkout.
 */
describe("an abandoned checkout still restocks immediately", () => {
  test("stock, promo usage and the customer email all still happen", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      pickupOrder({ id: "order_unpaid", status: "PENDING_PAYMENT", stripeCheckoutSessionId: null }),
    ]);

    await expireStaleOrders();

    expect(mocks.prisma.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reservedQuantity: { decrement: 2 } } }),
    );
    expect(mocks.prisma.promoCode.updateMany).toHaveBeenCalled();
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stockReleasedAt: expect.any(Date) }) }),
    );
    expect(mocks.sendEmail.mock.calls.map((call) => call[0].to)).toContain("cliente@example.com");
  });
});

describe("both outcomes stay reachable afterwards", () => {
  const orders = source("actions/boutique/orders.js");

  test("an expired pickup can still be completed while its stock is held", () => {
    // "She did come after all" — the reservation is intact and converts to a
    // sale exactly as it would have on day one.
    expect(orders).toContain('["PAID", "READY_FOR_PICKUP", "PENDING_PICKUP", "EXPIRED"]');
  });

  test("but not once the stock has been given back to somebody else", () => {
    expect(orders).toContain('if (order.status === "EXPIRED" && order.stockReleasedAt)');
  });

  test("releasing the stock is a human decision, guarded against running twice", () => {
    expect(orders).toContain("export async function confirmExpiredPickupNotCollected");
    expect(orders).toContain('where: { id: orderId, status: "EXPIRED", stockReleasedAt: null }');
    expect(orders).toContain("order.expired_pickup_stock_released");
  });

  test("two counters cannot both convert one handover into a sale", () => {
    expect(orders).toContain("PICKUP_ALREADY_CLAIMED");
  });

  test("the worklist only lists undecided cases", () => {
    expect(orders).toContain("export async function listPickupsToVerify");
    expect(orders).toContain('{ fulfilmentMode: "PICKUP_ON_SITE", status: "EXPIRED", stockReleasedAt: null }');
  });

  test("staff can reach both outcomes from the orders page", () => {
    const page = source("app/dashboard/boutique/orders/page.jsx");
    expect(page).toContain("listPickupsToVerify");
    expect(page).toContain("<PickupsToVerify");
    const panel = source("components/dashboard/boutique/PickupsToVerify.jsx");
    expect(panel).toContain("confirmExpiredPickupNotCollected");
    expect(panel).toContain("PickupConfirmDialog");
  });

  // Found by tests/e2e-dashboard/boutique-pickup-verification.spec.mjs, which
  // clicked the button this file had already declared present.
  //
  // PickupsToVerify builds its own payload for the dialog rather than passing
  // the order through, and it left out totalAmount. An on-site pickup is
  // unpaid by definition, so the dialog always takes its needs-payment
  // branch, where a bare `order.totalAmount.toFixed(2)` threw and took the
  // whole orders page down to the error boundary. The "she did come" outcome
  // was unreachable: the handover could not be recorded at all.
  //
  // Every assertion above still passed throughout — the functions existed,
  // the guards existed, the component was wired in. Nothing a grep can see
  // was wrong.
  test("the pickup dialog is handed the amount it has to display", () => {
    const panel = source("components/dashboard/boutique/PickupsToVerify.jsx");
    expect(panel).toContain("totalAmount: order.totalAmount");

    // And the dialog does not take a page down if some future caller forgets
    // again.
    //
    // Asserted positively. The obvious version of this check —
    // `not.toContain("order.totalAmount.toFixed")` — fails against a fixed
    // file, because the comment explaining the bug necessarily quotes it.
    // A negative grep over source cannot tell code from prose about code.
    const dialog = source("components/dashboard/boutique/PickupConfirmDialog.jsx");
    expect(dialog).toContain("const hasAmount = Number.isFinite(amountToCollect)");
    expect(dialog).toContain("{hasAmount && (");
  });
});
