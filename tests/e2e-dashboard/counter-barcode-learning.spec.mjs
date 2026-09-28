import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStockedVariant } from "./fixtures/seed-dashboard.mjs";
import { isValidGtin } from "../../lib/counter/product-search.js";

/**
 * Barcode learning at the till.
 *
 * Most boxes carry a supplier EAN the catalogue has never been told about.
 * Scanning one used to be a dead end ("Aucun produit actif ne correspond").
 * Now the till offers to link it: search the product by name, « Associer »,
 * confirm — and the very next scan of that code rings the product up
 * directly. Nothing is printed or stuck on the box.
 *
 * Driven end to end because the value is the round trip: an unknown scan,
 * the forgiving name search finding the product, the link persisted and
 * audited, and the second scan resolving it.
 */

// A fresh, check-digit-valid EAN-13 in the GS1 in-store range (prefix 2),
// so it can never collide with a real supplier code in the dev catalogue.
function freshEan13() {
  const base = `2${String(Date.now()).slice(-11)}`;
  for (let digit = 0; digit <= 9; digit += 1) {
    if (isValidGtin(`${base}${digit}`)) return `${base}${digit}`;
  }
  throw new Error("no check digit found");
}

test.describe("the till learns an unknown supplier barcode", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("scan unknown → find by name → link → the next scan adds it", async ({ browser }) => {
    const admin = await seedAdmin({ label: "barcode" });
    const { product, variant } = await seedStockedVariant({ label: "barcode", stockQuantity: 5 });
    const code = freshEan13();

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/point-of-sale");

    const scanField = page.getByPlaceholder("Lecteur USB : QR ou code-barres");
    await scanField.fill(code);
    await scanField.press("Enter");
    await expect(page.getByText(`Code-barres inconnu : ${code}`)).toBeVisible({ timeout: 20_000 });

    // Words out of order and lower case — the old `contains` search needed
    // the exact spelling in the exact order.
    const runSuffix = getRunId().split("-").pop();
    await page.getByLabel("Rechercher un produit par nom").fill(`${runSuffix} produit`);
    const row = page.getByRole("listitem").filter({ hasText: product.name });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole("button", { name: /^associer$/i }).click();

    await expect(page.getByRole("heading", { name: "Associer ce code-barres ?" })).toBeVisible();
    await page.getByRole("button", { name: "Associer et ajouter" }).click();

    await expect
      .poll(() => prisma.productVariant.findUnique({ where: { id: variant.id }, select: { barcode: true } }).then((v) => v.barcode), {
        message: "the scanned code was not saved on the variant",
        timeout: 15_000,
      })
      .toBe(code);
    await expect(page.getByText(`Code-barres inconnu : ${code}`)).toHaveCount(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "product_variant.barcode_linked_at_counter", entityId: variant.id },
      select: { actorId: true, after: true },
    });
    expect(audit?.actorId, "the link was not attributed").toBe(admin.user.id);
    expect(audit?.after).toEqual({ barcode: code });

    // The whole point: the second scan needs no search at all.
    await scanField.fill(code);
    await scanField.press("Enter");
    const cart = page.locator("#counter-cart");
    await expect(cart.getByText(product.name).first()).toBeVisible();
    await expect(cart.getByText(/^2$/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`Code-barres inconnu : ${code}`)).toHaveCount(0);

    await context.close();
  });
});
