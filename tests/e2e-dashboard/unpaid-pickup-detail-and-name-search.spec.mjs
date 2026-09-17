import { randomBytes } from "node:crypto";
import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStockedVariant, seedOrder } from "./fixtures/seed-dashboard.mjs";

/**
 * A "réserver en ligne, payer au retrait" order before the customer shows up:
 * it has no Payment and no Transaction at all.
 *
 *  - Opérations used to offer no way into such a row. It now opens the detail
 *    drawer on the order itself — details and pickup QR code — while the
 *    receipt stays unavailable until the order is actually paid, both in the
 *    drawer and at the receipt route.
 *  - The counter could only reach it by scanning the pickup QR code. A client
 *    who lost it can now be found by name in the same omnibar.
 */

const OPERATIONS_PAGE = "/dashboard/operations?tab=orders";
const COUNTER_PAGE = "/dashboard/boutique/point-of-sale";

test.describe("unpaid pickup orders: Opérations detail and counter name search", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let customer;
  let order;
  let pickupCode;

  test.beforeAll(async ({ browser }) => {
    const admin = await seedAdmin({ label: "unpaidpickup" });
    customer = await seedCustomer({ label: "retraitnonpaye" });
    const { variant } = await seedStockedVariant({ label: "unpaidpickup", stockQuantity: 10 });
    ({ order } = { order: await seedOrder({ variant, customer, status: "PENDING_PICKUP", fulfilmentMode: "PICKUP_ON_SITE", quantity: 2 }) });
    pickupCode = randomBytes(4).toString("hex").toUpperCase();
    order = await prisma.order.update({
      where: { id: order.id },
      data: { pickupCode, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
      include: { items: true },
    });

    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("Opérations opens the unpaid order's detail with its QR code, and no receipt", async () => {
    await page.goto(OPERATIONS_PAGE);
    const row = page.locator("tr").filter({ hasText: customer.email }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /voir le détail/i }).click();

    const dialog = page.getByRole("dialog", { name: /détail de la commande/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Commande n°${order.orderNumber}`);
    await expect(dialog).toContainText(/non payée/i);
    await expect(dialog).toContainText(/pas encore encaissée/i);
    await expect(dialog).toContainText(`2 × ${order.items[0].productName}`);
    await expect(dialog).toContainText(customer.fullName);

    // The QR code the customer received, regenerated from the stored code.
    await expect(dialog).toContainText(/qr code de retrait/i);
    await expect(dialog).toContainText(pickupCode);
    const qr = dialog.getByRole("img", { name: /qr code envoyé au client/i });
    await expect(qr).toBeVisible();
    expect(await qr.getAttribute("src")).toMatch(/^data:image\/png;base64,/);

    // No receipt before payment.
    await expect(dialog).toContainText(/pas encore de reçu/i);
    await expect(dialog.getByRole("link", { name: /ouvrir le reçu/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /annuler et rembourser/i })).toHaveCount(0);

    await dialog.getByRole("button", { name: /fermer/i }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the receipt route refuses an unpaid order", async () => {
    const response = await page.request.get(`/api/orders/${order.id}/ticket`);
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toMatch(/pas encore payée/i);
  });

  test("a paid order's receipt still opens", async () => {
    const { variant } = await seedStockedVariant({ label: "paidpickup", stockQuantity: 10 });
    const paid = await seedOrder({ variant, customer, status: "READY_FOR_PICKUP", fulfilmentMode: "PICKUP_PREPAID", quantity: 1, payment: "paid" });
    const response = await page.request.get(`/api/orders/${paid.id}/ticket`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
  });

  test("the order page does not offer the receipt either", async () => {
    await page.goto(`/dashboard/boutique/orders/${order.id}`);
    await expect(page.getByText(/pas encore de reçu/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /reçu \/ ticket de caisse/i })).toHaveCount(0);
  });

  test("the counter finds the pickup by the client's name and opens its fiche", async () => {
    await page.goto(COUNTER_PAGE);
    const omnibar = page.getByPlaceholder(/nom prénom ou nom du service/i);
    await expect(omnibar).toBeVisible();

    // Words out of order and in the wrong case — still one person.
    await omnibar.fill("RETRAITNONPAYE automatise");
    await omnibar.press("Enter");

    // Earlier runs seed a customer with the same name, so pick this run's order
    // by number rather than relying on the single-result auto-open.
    const fiche = page.getByRole("heading", { name: `Commande ${order.orderNumber}` });
    const resultRow = page.getByRole("button").filter({ hasText: `Commande n°${order.orderNumber}` });
    await expect(resultRow.or(fiche).first()).toBeVisible({ timeout: 20_000 });
    if (await resultRow.count()) {
      await expect(page.getByText("Commandes à retirer", { exact: true })).toBeVisible();
      await resultRow.first().click();
    }

    await expect(fiche).toBeVisible();
    await expect(page.getByText(/retrait boutique/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /encaisser et remettre/i })).toBeVisible();
  });

  test("the counter also finds it by order number", async () => {
    await page.goto(COUNTER_PAGE);
    const omnibar = page.getByPlaceholder(/nom prénom ou nom du service/i);
    await omnibar.fill(`n°${order.orderNumber}`);
    await omnibar.press("Enter");

    const fiche = page.getByRole("heading", { name: `Commande ${order.orderNumber}` });
    const resultRow = page.getByRole("button").filter({ hasText: `Commande n°${order.orderNumber}` });
    await expect(resultRow.or(fiche).first()).toBeVisible({ timeout: 20_000 });
    if (await resultRow.count()) await resultRow.first().click();
    await expect(fiche).toBeVisible();
  });
});
