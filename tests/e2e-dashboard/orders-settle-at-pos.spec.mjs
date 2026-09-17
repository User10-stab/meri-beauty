import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStockedVariant, seedOrder } from "./fixtures/seed-dashboard.mjs";

/**
 * « Encaisser » on the orders list: an unpaid pay-at-pickup order is opened
 * at the till pre-filled with its lines and client, staff add to it, and the
 * sale closes the original order in the same transaction — its reservation
 * released, so the units are decremented exactly once.
 *
 * Same till-session approach as pos-invoice-and-email-opt-out.spec.mjs: one
 * plain CashSession row of our own (or the one already open, reused), and
 * EXTERNAL_TERMINAL only so the drawer never moves.
 */

const ORDERS_PAGE = "/dashboard/boutique/orders";
const OPENING_FLOAT = 100;

test.describe("settle an unpaid pickup order at the till", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let admin;
  let customer;
  let variant;
  let product;
  let order;
  let paidOrder;
  let openedSessionId = null;
  let saleOrderId = null;

  test.beforeAll(async ({ browser }) => {
    admin = await seedAdmin({ label: "settleatpos" });

    // Only one session may be open system-wide. The sale here is
    // EXTERNAL_TERMINAL, which never enters the drawer, so an already-open
    // session is simply reused (and left open); otherwise we open our own.
    const existing = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
    if (!existing) {
      const opened = await prisma.cashSession.create({ data: { openedById: admin.user.id, openingFloat: OPENING_FLOAT } });
      openedSessionId = opened.id;
    }

    customer = await seedCustomer({ label: "encaisserpos" });
    ({ variant, product } = await seedStockedVariant({ label: "settleatpos", stockQuantity: 10, price: 20 }));
    order = await seedOrder({ variant, customer, status: "PENDING_PICKUP", fulfilmentMode: "PICKUP_ON_SITE", quantity: 2 });
    paidOrder = await seedOrder({ variant, customer, status: "READY_FOR_PICKUP", fulfilmentMode: "PICKUP_PREPAID", quantity: 1, payment: "paid" });

    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    if (openedSessionId) {
      await prisma.cashSession.updateMany({
        where: { id: openedSessionId, closedAt: null },
        data: { closedAt: new Date(), countedCash: OPENING_FLOAT, expectedCash: OPENING_FLOAT, variance: 0 },
      });
    }
    await page?.close();
    await disconnect();
  });

  test("the orders list offers « Encaisser » only on the unpaid pickup order", async () => {
    await page.goto(ORDERS_PAGE);
    await page.getByPlaceholder(/rechercher client, n°, code/i).fill(customer.email);
    await page.getByPlaceholder(/rechercher client, n°, code/i).press("Enter");

    const unpaidRow = page.locator("tr").filter({ hasText: `n°${order.orderNumber}` });
    const paidRow = page.locator("tr").filter({ hasText: `n°${paidOrder.orderNumber}` });
    await expect(unpaidRow).toBeVisible({ timeout: 20_000 });
    await expect(paidRow).toBeVisible();
    await expect(paidRow.getByRole("button", { name: /encaisser/i })).toHaveCount(0);

    await unpaidRow.getByRole("button", { name: /encaisser/i }).click();
    await page.waitForURL(new RegExp(`/dashboard/boutique/point-of-sale\\?order=${order.id}`));
  });

  test("the till opens pre-filled, then adds a unit and settles by terminal", async () => {
    test.setTimeout(120_000);
    const till = page.locator("#counter-cart");

    await expect(till.getByText(`Commande n°${order.orderNumber} reprise à la caisse`)).toBeVisible({ timeout: 20_000 });
    const line = till.locator("div.flex.items-center.gap-3.p-3").filter({ hasText: product.name });
    await expect(line).toBeVisible();
    await expect(line).toContainText("2");
    await expect(till.getByRole("button", { name: /carte qr/i })).toBeDisabled();
    await expect(till.getByPlaceholder("Nom complet", { exact: true })).toHaveValue(customer.fullName);

    // One more unit than the order had.
    await line.getByRole("button").nth(1).click();
    await expect(till.getByText("60.00 €").first()).toBeVisible();

    await till.getByRole("button", { name: /terminal externe/i }).click();
    await till.getByRole("button", { name: /encaisser et envoyer le ticket/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel(/je confirme.*terminal.*approuvé/i).check();
    await dialog.getByPlaceholder(/référence.*ticket terminal/i).fill(`E2E-SETTLE-${order.orderNumber}`);
    await dialog.getByRole("button", { name: /encaisser et envoyer le reçu/i }).click();

    await page.waitForURL(/\/dashboard\/boutique\/orders\/[^/?#]+$/, { timeout: 30_000 });
    saleOrderId = /\/orders\/([^/?#]+)$/.exec(page.url())[1];
    expect(saleOrderId).not.toBe(order.id);
  });

  test("the original order is closed and the stock moved exactly once", async () => {
    const sale = await prisma.order.findUnique({ where: { id: saleOrderId }, include: { items: true, payment: true } });
    expect(sale.status).toBe("COMPLETED");
    expect(sale.source).toBe("POS");
    expect(sale.userId).toBe(customer.id);
    expect(sale.items).toHaveLength(1);
    expect(sale.items[0].quantity).toBe(3);
    expect(sale.payment?.status).toBe("PAID");

    const original = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true } });
    expect(original.status).toBe("CANCELLED");
    expect(original.payment).toBeNull();
    expect(original.cancelReason).toContain(`vente n°${sale.orderNumber}`);

    const after = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    // Seeded 10 on hand; the paid order still holds 1, the taken-over order's
    // 2 were released, and the sale took 3 off the shelf.
    expect(after.stockQuantity).toBe(7);
    expect(after.reservedQuantity).toBe(1);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: order.id, action: "order.settled_at_point_of_sale" } });
    expect(audit).not.toBeNull();
  });

  test("the closed order no longer offers « Encaisser », and the till refuses it", async () => {
    await page.goto(`/dashboard/boutique/point-of-sale?order=${order.id}`);
    await expect(page.getByText(/n'est plus à encaisser/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#counter-cart").getByText(/reprise à la caisse/)).toHaveCount(0);
  });
});
