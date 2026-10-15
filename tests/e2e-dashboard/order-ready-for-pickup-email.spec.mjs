import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStockedVariant, seedOrder } from "./fixtures/seed-dashboard.mjs";

/**
 * « Marquer prête pour retrait » on the order page e-mails the customer
 * « Votre commande n°X est prête » with the pickup code and QR attached —
 * and only once: the button is gone after the first click, so the status
 * claim in markOrderReadyForPickup is what a second click would hit.
 */

const SUBJECT = /Votre commande n°\d+ est prête/;

test.describe("order ready for pickup e-mail", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let customer;
  let order;
  const pickupCode = `E2E${Date.now().toString(36).toUpperCase().slice(-5)}`;

  test.beforeAll(async ({ browser }) => {
    await requireMailpit();
    const admin = await seedAdmin({ label: "readypickup" });
    customer = await seedCustomer({ label: "readypickup" });
    const { variant } = await seedStockedVariant({ label: "readypickup", stockQuantity: 10, price: 20 });
    order = await seedOrder({ variant, customer, status: "PAID", fulfilmentMode: "PICKUP_PREPAID", quantity: 1, payment: "paid" });
    await prisma.order.update({ where: { id: order.id }, data: { pickupCode } });

    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("clicking « Marquer prête pour retrait » e-mails the customer with the pickup code and QR", async () => {
    await page.goto(`/dashboard/boutique/orders/${order.id}`);
    await expect(page.getByText("Le client sera prévenu par e-mail.")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /marquer prête pour retrait/i }).click();
    await expect(page.getByText(/le client a été prévenu par e-mail/i)).toBeVisible({ timeout: 20_000 });

    const updated = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true, readyForPickupAt: true } });
    expect(updated.status).toBe("READY_FOR_PICKUP");
    expect(updated.readyForPickupAt).not.toBeNull();

    const email = await waitForEmail({ to: customer.email, subject: SUBJECT });
    expect(email.Subject).toBe(`Votre commande n°${order.orderNumber} est prête – Meri Beauty`);
    expect(email.Text).toContain(`Code de retrait : ${pickupCode}`);
    expect(email.Text).not.toContain("régler sur place");
    expect(email.Attachments.map((a) => a.FileName)).toContain(`retrait-${order.orderNumber}.png`);
    await expect(page.getByRole("button", { name: /marquer prête pour retrait/i })).toHaveCount(0);
  });

  test("the e-mail is sent once, not again on reload", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: /marquer prête pour retrait/i })).toHaveCount(0);
    const results = await fetch(
      `${process.env.MAILPIT_API_URL || "http://localhost:8025"}/api/v1/search?query=${encodeURIComponent(`to:"${customer.email}"`)}`,
    ).then((r) => r.json());
    expect((results.messages ?? []).filter((m) => SUBJECT.test(m.Subject ?? ""))).toHaveLength(1);
  });
});
