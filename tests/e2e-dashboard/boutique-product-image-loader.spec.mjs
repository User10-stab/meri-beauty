import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin } from "./fixtures/seed-dashboard.mjs";

/**
 * The custom next/image loader (image-loader.js + next.config.mjs
 * `loader: "custom"`) — the change that pulls the built-in /_next/image
 * optimizer out of production because sharp OOM-kills the OVH box under load
 * and blanks whole pages when the 4h optimized-image cache expires.
 *
 * The loader has exactly two branches and this suite drives both against a
 * real browser and the real storefront:
 *
 *   1. A bare static.wixstatic.com/media/<id> URL is rewritten to Wix's own
 *      CDN fill-transform (/v1/fill/w_,h_,q_,enc_auto/) so the resize runs on
 *      Wix, not on our server. Checked against whatever Wix-backed product
 *      the dev catalogue already holds.
 *
 *   2. Everything else — here a /uploads/products/* file that a person
 *      actually uploaded through the product editor — is handed back
 *      untouched: no /_next/image, no transform, the raw path.
 *
 * The uploaded product is left in the catalogue on purpose (ACTIVE, real
 * image on disk). Like the rest of this suite it seeds forward and does not
 * tidy up — a product you can open in the boutique afterwards is the point,
 * not litter.
 */

const PRODUCT_PHOTO = fileURLToPath(new URL("./fixtures/product-photo.jpg", import.meta.url));

/** next/image renders `alt` on the <img>; role+name is the stable handle. */
async function imageState(page, accessibleName) {
  const img = page.getByRole("img", { name: accessibleName }).first();
  await expect(img).toBeVisible({ timeout: 15_000 });
  await img.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => img.evaluate((el) => el.naturalWidth), {
      message: `"${accessibleName}" never decoded (naturalWidth stayed 0) — a blank image is exactly the bug`,
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  return img.evaluate((el) => ({
    currentSrc: el.currentSrc,
    naturalWidth: el.naturalWidth,
    naturalHeight: el.naturalHeight,
  }));
}

test.describe("the custom image loader serves both Wix and local product images", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a bare Wix product image is rewritten to Wix's CDN transform, not /_next/image", async ({ browser }) => {
    const wixProduct = await prisma.product.findFirst({
      where: {
        status: "ACTIVE",
        images: { some: { path: { startsWith: "https://static.wixstatic.com/media/" } } },
      },
      select: { slug: true, name: true, images: { select: { path: true, isPrimary: true } } },
    });
    test.skip(!wixProduct, "dev catalogue holds no ACTIVE product with a bare Wix image");

    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/boutique/${wixProduct.slug}`);

    const { currentSrc } = await imageState(page, wixProduct.name);

    // Branch 1 of the loader: the resize is delegated to Wix.
    expect(currentSrc, "the loader did not rewrite the bare Wix URL").toMatch(
      /^https:\/\/static\.wixstatic\.com\/media\/[^/]+\/v1\/fill\/w_\d+,h_\d+,al_c,q_\d+,enc_auto\//,
    );
    // The optimizer must never be in the path — that is the whole change.
    expect(currentSrc).not.toContain("/_next/image");

    // And the transformed URL is really an image, not a 404 page.
    const res = await page.request.get(currentSrc);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("image/");

    await context.close();
  });

  test("a product created and photographed through the dashboard renders from /uploads unchanged", async ({ browser }) => {
    const runId = getRunId();
    const admin = await seedAdmin({ label: "image-loader" });
    const name = `E2E Image Loader ${runId}`;
    const price = "19.90";

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);

    await page.goto("/dashboard/boutique/products/new");
    await expect(page.getByRole("heading", { name: /nouveau produit/i })).toBeVisible();

    await page.getByPlaceholder("Shampooing Hydratant").fill(name);

    // Organisation: brand is required and gates a brand-scoped category list.
    // Pick whatever the dev DB already wired up rather than assuming names.
    const brand = await prisma.brand.findFirst({
      where: { isActive: true, categories: { some: {} } },
      select: { name: true, categories: { take: 1, select: { name: true } } },
    });
    expect(brand, "dev DB has no active brand with a product category").toBeTruthy();
    const categoryName = brand.categories[0].name;

    const brandSelect = page.locator("label").filter({ hasText: /^Marque/ }).locator("xpath=following-sibling::select");
    await brandSelect.selectOption({ label: brand.name });

    // Anchored — a bare "Catégorie" also matches "Sous-catégorie".
    const categorySelect = page.locator("label").filter({ hasText: /^Catégorie/ }).locator("xpath=following-sibling::select");
    await expect(categorySelect).toBeEnabled({ timeout: 10_000 });
    await categorySelect.selectOption({ label: categoryName });
    // Sous-catégorie left blank on purpose — falls back to "Général".

    // Variant: generate a collision-proof SKU, then the two required prices.
    await page.getByTitle("Générer une référence unique").click();
    const skuInput = page
      .locator("label")
      .filter({ hasText: /^Référence \(SKU\)/ })
      .locator("xpath=following-sibling::div//input[1]");
    await expect(skuInput).not.toHaveValue("", { timeout: 10_000 });

    await page
      .locator("label")
      .filter({ hasText: /^Prix de vente TTC/ })
      .locator("xpath=following-sibling::input")
      .fill(price);
    await page
      .locator("label")
      .filter({ hasText: /^Prix d'achat HT/ })
      .locator("xpath=following-sibling::input")
      .fill("6.00");

    // The upload path under test: a real file, client-optimised in the
    // browser, POSTed to /api/upload, landing in public/uploads/products.
    await page.locator('input[type="file"]').setInputFiles(PRODUCT_PHOTO);
    const editorThumb = page.locator('img[src*="/uploads/products/"]');
    await expect(editorThumb).toHaveCount(1, { timeout: 20_000 });

    // Make it publicly visible.
    await page.locator("label").filter({ hasText: /^Actif/ }).click();

    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page).toHaveURL(/\/dashboard\/boutique\/products$/, { timeout: 20_000 });

    // It really landed, ACTIVE, with a local image path.
    const created = await prisma.product.findFirst({
      where: { name },
      select: { slug: true, status: true, images: { select: { path: true, isPrimary: true } } },
    });
    expect(created, "the product was not created").toBeTruthy();
    expect(created.status).toBe("ACTIVE");
    expect(created.images).toHaveLength(1);
    expect(created.images[0].path).toMatch(/^\/uploads\/products\/[\w-]+\.(jpg|png|webp|gif)$/);
    expect(created.images[0].isPrimary).toBe(true);

    // Branch 2 of the loader, seen from the storefront: the shopper's browser
    // gets the raw /uploads path, no optimizer, and the image decodes.
    const shopper = await browser.newContext();
    const shopPage = await shopper.newPage();
    await shopPage.goto(`/boutique/${created.slug}`);

    const { currentSrc } = await imageState(shopPage, name);
    expect(currentSrc).toContain(created.images[0].path);
    expect(currentSrc).not.toContain("/_next/image");
    expect(currentSrc).not.toContain("wixstatic.com");

    // The URL the browser actually fetched is the file on disk, served whole
    // by the dev server / nginx — not a 404, not an optimizer round-trip.
    // (img.naturalWidth is density-corrected here because next/image emits a
    // w-descriptor srcset of identical URLs, so it is not a size assertion.)
    const res = await shopPage.request.get(currentSrc);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] ?? "").toContain("image/");
    expect((await res.body()).byteLength).toBeGreaterThan(1000);

    console.log(`\n  kept: ACTIVE product "${name}" -> /boutique/${created.slug}\n         image ${created.images[0].path}\n`);

    await shopper.close();
    await context.close();
  });
});
