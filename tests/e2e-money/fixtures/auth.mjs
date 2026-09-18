import { expect } from "@playwright/test";

/**
 * Logging in the way a person does — once per account, then reused.
 *
 * Deliberately not a forged session cookie. Authorisation is part of what
 * this suite is testing — `authorizeRefund` refuses anything that is not
 * OWNER/ADMIN, and a fabricated session would quietly bypass the very check
 * that stops a staff member issuing refunds. So the cookie handed to a test
 * is always one the login form actually minted, from real credentials, at
 * least once in this process.
 *
 * What is NOT repeated is the form-driving. `loginAs` used to type into
 * /login on every call, and the suite calls it ~20 times. Two consequences,
 * both bad:
 *
 *   `actions/auth/login.js` rate-limits 10 attempts per 5 minutes, keyed on
 *   `email:ip`. Every spec logs in as the same admin from the same
 *   localhost, so one clean run of the money suite spends 9 of those 10 —
 *   and a re-run inside the window, or debugging one spec twice, silently
 *   trips it. The limiter's refusal looks exactly like a failed login.
 *
 *   Each login also costs a redirect to "/", the heaviest page in the app.
 *
 * Caching the cookies collapses the admin's 9 logins to 1, and every repeat
 * login to a cookie swap — which is precisely what a browser does when you
 * open a second tab.
 */

const LOGIN_PATH = "/login";

/**
 * email -> cookies, for the lifetime of this worker process.
 *
 * playwright.money.config.mjs runs `workers: 1`, so this is one cache for
 * the whole run. A worker that Playwright recycles after a failure starts
 * with an empty map and simply logs in again, which is correct rather than
 * merely tolerable.
 */
const sessionCookies = new Map();

export function adminCredentials() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not set — prisma/seed.mjs uses it to hash the admin account's password.");
  }
  return { email: "admin@meribeauty.com", password };
}

/**
 * Drives the real login form in a throwaway context and returns its cookies.
 *
 * Separate context on purpose: it must not disturb whatever the calling test
 * already has open, and its cookies are the artefact we want rather than its
 * page.
 */
async function mintSessionCookies(browser, { email, password }) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(LOGIN_PATH);

    // Ids come from components/auth-form.js, which renders `id={field.name}`
    // for every field the page declares.
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /se connecter/i }).click();

    // login-form.js navigates with window.location.href, so waiting for the
    // URL to stop being /login is the honest signal — a toast can appear
    // before the redirect has actually happened.
    //
    // The budget is large because the redirect target is "/", and the URL
    // assertion does not settle until that navigation commits.
    //
    // 30s was enough against a healthy dev server and nowhere near enough
    // against a stale one. A `next dev` process left up for hours degrades
    // badly — measured 18/09/2026 at 77 minutes uptime and 1.5 GB RSS: the
    // home page took 13.5s, /login 20s, and even /api/health (a no-op route
    // over a 3 ms query) took 5.5s. Restarting it brought those to 0.45s,
    // 0.11s and 0.012s. Nothing was wrong with the app.
    //
    // The failure mode is what makes this worth a large budget rather than a
    // tight one: it surfaces as "stuck on /login", which reads like a broken
    // login and sent a whole 5-case run chasing the wrong thing. If the suite
    // is crawling, restart the dev server before believing anything it says.
    await expect(page).not.toHaveURL(new RegExp(`${LOGIN_PATH}(\\?|$)`), { timeout: 120_000 });

    const { cookies } = await context.storageState();
    return cookies;
  } finally {
    await context.close();
  }
}

/**
 * Puts `page` in this account's session.
 *
 * Leaves the page wherever it was: every call site in this suite navigates
 * immediately afterwards (a booking URL, a dashboard route), so landing on
 * "/" first was only ever paying for a page nobody read.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ email: string, password: string }} credentials
 */
export async function loginAs(page, { email, password }) {
  let cookies = sessionCookies.get(email);
  if (!cookies) {
    cookies = await mintSessionCookies(page.context().browser(), { email, password });
    sessionCookies.set(email, cookies);
  }

  // Cleared first: these tests switch roles mid-test (customer books, admin
  // then cancels), and leaving the previous account's cookie alongside the
  // new one is how you get a session that is neither.
  await page.context().clearCookies();
  await page.context().addCookies(cookies);
}

export async function loginAsAdmin(page) {
  await loginAs(page, adminCredentials());
  // Doubles as the proof that the injected session is really an admin one —
  // this page is behind the dashboard's authorisation, so a cookie that did
  // not take fails here rather than somewhere subtler later.
  await page.goto("/dashboard/operations");
  await expect(page.getByRole("heading", { name: /opérations/i })).toBeVisible();
}

export async function logout(page) {
  await page.context().clearCookies();
}
