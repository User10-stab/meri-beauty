import { expect } from "@playwright/test";

/**
 * Logging in the way a person does.
 *
 * Deliberately not a forged session cookie. Authorisation is part of what
 * this suite is testing — `authorizeRefund` refuses anything that is not
 * OWNER/ADMIN, and a fabricated session would quietly bypass the very check
 * that stops a staff member issuing refunds.
 */

const LOGIN_PATH = "/login";

export function adminCredentials() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not set — prisma/seed.mjs uses it to hash the admin account's password.");
  }
  return { email: "admin@meribeauty.com", password };
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ email: string, password: string }} credentials
 */
export async function loginAs(page, { email, password }) {
  await page.goto(LOGIN_PATH);

  // Ids come from components/auth-form.js, which renders `id={field.name}`
  // for every field the page declares.
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /se connecter/i }).click();

  // login-form.js navigates with window.location.href, so waiting for the
  // URL to stop being /login is the honest signal — a toast can appear
  // before the redirect has actually happened.
  await expect(page).not.toHaveURL(new RegExp(`${LOGIN_PATH}(\\?|$)`), { timeout: 30_000 });
}

export async function loginAsAdmin(page) {
  await loginAs(page, adminCredentials());
  await page.goto("/dashboard/operations");
  await expect(page.getByRole("heading", { name: /opérations/i })).toBeVisible();
}

export async function logout(page) {
  await page.context().clearCookies();
}
