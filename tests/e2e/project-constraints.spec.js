import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const PUBLIC_ROUTES = [
  "/",
  "/reservation",
  "/boutique",
  "/contact",
  "/login",
  "/forgot-password",
];

async function expectNoPageOverflow(page) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));

  expect(overflow.html).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

async function expectNoNextErrorShell(page) {
  await expect(page.getByText(/PrismaClientInitializationError|Application error|Internal Server Error/i)).toHaveCount(0);
}

test.describe("Meri Beauty project constraints", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`public route ${route} renders without mobile overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      await expectNoNextErrorShell(page);
      await expectNoPageOverflow(page);
    });
  }

  test("desktop product action buttons keep readable labels", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard/boutique/products");

    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('input[type="email"]')).toBeVisible();

    const source = readFileSync("components/dashboard/boutique/ProductsPageClient.jsx", "utf8");
    expect(source).toContain("sm:flex-row");
    expect(source).toContain("whitespace-nowrap");
    expect(source).not.toContain("sm:grid-cols-3");
  });

  test("dashboard access is protected and preserves a safe callback", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("callbackUrl") ?? "")).toContain("/dashboard");
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeVisible();
  });

  test("reservation cannot skip required steps before a service is selected", async ({ page }) => {
    await page.goto("/reservation#booking");

    await expect(page.locator("button").filter({ hasText: /^2$/ })).toBeDisabled();
    await expect(page.locator("button").filter({ hasText: /^3$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Suivant/i })).toBeDisabled();
  });

  test("contact page exposes the required form fields and validation schema", async ({ page }) => {
    await page.goto("/contact");

    await expect(page.getByPlaceholder("Votre nom")).toBeVisible();
    await expect(page.getByPlaceholder("votre@email.com")).toHaveAttribute("type", "email");
    await expect(page.getByPlaceholder("Sujet de votre message")).toBeVisible();
    await expect(page.getByPlaceholder("Votre message...")).toBeVisible();
    await expect(page.getByRole("button", { name: /envoyer le message/i })).toBeVisible();

    const schema = readFileSync("lib/validations/contact.js", "utf8");
    expect(schema).toContain(".min(2");
    expect(schema).toContain(".email(");
    expect(schema).toContain(".min(3");
    expect(schema).toContain(".min(10");
  });

  test("login form keeps email and password validation wired", async ({ page }) => {
    await page.goto("/login");

    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /se connecter/i })).toBeVisible();

    const pageSource = readFileSync("app/(auth)/login/page.js", "utf8");
    const schema = readFileSync("lib/validations/login.js", "utf8");
    expect(pageSource).toContain("LoginForm");
    expect(schema).toContain(".email(");
    expect(schema).toContain(".min(1");
  });
});
