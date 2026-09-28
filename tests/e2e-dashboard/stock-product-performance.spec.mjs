import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin, seedStockedVariant } from "./fixtures/seed-dashboard.mjs";

/**
 * « Performance par produit » — the per-product roll-up next to the
 * Mouvements de stock ledger. A product that sold in the window must read as
 * sold (with its units), and a product with stock that never sold must be
 * flagged « À retirer ? »: that is the whole question the view answers.
 *
 * Products are backdated past the 60-day « Nouveau » grace period, since a
 * freshly seeded product is by definition too new to judge.
 */
test.describe("product performance over a period", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("sold and never-sold products get their verdicts, and the window is switchable", async ({ browser }) => {
    const admin = await seedAdmin({ label: "perf" });
    const sold = await seedStockedVariant({ label: "perf-sold", stockQuantity: 10 });
    const dormant = await seedStockedVariant({ label: "perf-dormant", stockQuantity: 6 });

    const longAgo = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await prisma.product.updateMany({
      where: { id: { in: [sold.product.id, dormant.product.id] } },
      data: { createdAt: longAgo },
    });
    await prisma.inventoryMovement.create({
      data: {
        variantId: sold.variant.id,
        type: "SALE",
        quantity: -4,
        previousStock: 14,
        newStock: 10,
        reason: "E2E performance",
        createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/stock/mouvements/performance");

    await expect(page.getByRole("link", { name: /performance par produit/i })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /6 derniers mois/i })).toHaveAttribute("aria-pressed", "true");

    const search = page.getByPlaceholder(/produit, déclinaison ou référence/i);

    await search.fill(sold.product.name);
    const soldRow = page.getByRole("row").filter({ hasText: sold.product.name });
    await expect(soldRow).toHaveCount(1, { timeout: 20_000 });
    await expect(soldRow.getByRole("cell").nth(2)).toContainText("4");
    await expect(soldRow).not.toContainText(/à retirer/i);

    await search.fill(dormant.product.name);
    const dormantRow = page.getByRole("row").filter({ hasText: dormant.product.name });
    await expect(dormantRow).toHaveCount(1);
    await expect(dormantRow).toContainText(/à retirer \?/i);
    await expect(dormantRow).toContainText("∞");

    await page.getByRole("button", { name: /12 derniers mois/i }).click();
    await expect(page).toHaveURL(/mois=12/);
    await expect(page.getByRole("button", { name: /12 derniers mois/i })).toHaveAttribute("aria-pressed", "true");

    await context.close();
  });
});
