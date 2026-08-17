import { expect, test } from "@playwright/test";

test.describe("public homepage responsive layout", () => {
  test("keeps the mobile header controls on the right and avoids page overflow", async ({ page }) => {
    await page.goto("/");

    const menuButton = page.getByRole("button", { name: /ouvrir le menu/i });
    await expect(menuButton).toBeVisible();

    const box = await menuButton.boundingBox();
    expect(box).not.toBeNull();

    const viewportWidth = page.viewportSize().width;
    expect(viewportWidth - (box.x + box.width)).toBeLessThanOrEqual(24);

    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.viewport + 1);

    await menuButton.click();
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: "Accueil", exact: true })).toBeVisible();
    await expect(header.getByRole("link", { name: "Contact", exact: true })).toBeVisible();
  });
});
