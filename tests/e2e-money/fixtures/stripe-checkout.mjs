import { expect } from "@playwright/test";

/**
 * Paying, on Stripe's own hosted Checkout page.
 *
 * Every payment in this app goes through a redirect to `session.url`
 * (`stripe.checkout.sessions.create`, e.g. actions/boutique/orders.js:1033),
 * not embedded Elements. That is a considerable convenience here: the hosted
 * page is a normal top-level document, so its fields are ordinary selectors
 * rather than something buried in a cross-origin iframe.
 *
 * Test cards: https://docs.stripe.com/testing
 */

export const TEST_CARDS = Object.freeze({
  /** Succeeds immediately, no authentication step. */
  SUCCESS: "4242424242424242",
  /** Always declined — for asserting we record nothing on a failed payment. */
  DECLINE: "4000000000000002",
});

const CHECKOUT_URL = /checkout\.stripe\.com/;

/**
 * Resolves once the browser has actually landed on Stripe.
 *
 * The budget is large because what happens before this is a server action
 * that calls Stripe to create the Checkout Session, and that call has been
 * observed taking 46s from this machine — the redirect cannot happen until
 * it returns.
 */
export async function expectOnStripeCheckout(page) {
  await expect(page).toHaveURL(CHECKOUT_URL, { timeout: 90_000 });
}

/**
 * Fills and submits the hosted Checkout form.
 *
 * The page navigates to checkout.stripe.com before its own JS has hydrated
 * the payment form — the URL changes first, and `#cardNumber` et al. attach
 * a beat later, behind Link/Express-Checkout/hCaptcha sub-frames that load
 * alongside it. A one-shot `count() > 0` check run right after the URL
 * assertion resolves therefore reads "not there yet" as "not present, skip
 * it" and submits the form empty — silently, since nothing throws. Stripe's
 * own client-side validation then marks every field `[invalid]`/`Required`
 * and the page never leaves checkout.stripe.com, which is indistinguishable
 * from "Stripe is slow today" until something actually reads the DOM.
 * (That is exactly what happened wiring this file — see git history.)
 *
 * So the required fields `waitFor({ state: "visible" })` before typing,
 * rather than only checking whether they already exist. The optional ones
 * (an email Stripe may have pre-filled, a postal code only some countries
 * show) keep the soft check, since their absence is a legitimate outcome.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ card?: string, name?: string }} [options]
 */
export async function payOnStripeCheckout(page, { card = TEST_CARDS.SUCCESS, name = "E2E Money Test" } = {}) {
  await expectOnStripeCheckout(page);

  // pressSequentially, not fill(): a value set in one instantaneous DOM
  // write does not always drive this page's own input handlers the way real
  // keystrokes do, and the fields are masked (the expiry reformats to
  // "12 / 29" as it is typed).
  const fillWhenVisible = async (selector, value, { timeout = 30_000 } = {}) => {
    const field = page.locator(selector).first();
    await field.waitFor({ state: "visible", timeout });
    await field.pressSequentially(value, { delay: 30 });
  };

  const fillIfPresent = async (selector, value) => {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0 && (await field.isVisible().catch(() => false))) {
      await field.pressSequentially(value, { delay: 30 });
    }
  };

  await fillIfPresent("#email", "e2e@meribeauty.test");
  // Card number first and with the full timeout budget: it is the field
  // whose readiness gates the rest of the form, so waiting on it here is
  // what the later fields' shorter, default waits are implicitly relying on.
  await fillWhenVisible("#cardNumber", card);
  // Any future date and any 3 digits are accepted for test cards.
  await fillWhenVisible("#cardExpiry", "12" + String(new Date().getFullYear() + 3).slice(-2));
  await fillWhenVisible("#cardCvc", "123");
  await fillWhenVisible("#billingName", name);
  await fillIfPresent("#billingPostalCode", "1000");

  await page.locator('[data-testid="hosted-payment-submit-button"], button[type="submit"]').first().click();
}

/**
 * Pays and waits to be returned to the application.
 *
 * `returnUrlPattern` must match ONLY the application's own success page —
 * never anything under checkout.stripe.com. `expectOnStripeCheckout` already
 * put the browser on that host before this runs, so a pattern permissive
 * enough to still match it (an earlier version of this helper tried to allow
 * for an intermediate Stripe redirect step this app's flows never actually
 * have) is satisfied by the URL the browser is *already* sitting on. The
 * assertion then passes instantly, before the click has done anything, and
 * every caller ends up "returning" from a payment that was never submitted.
 *
 * Landing back on the success page only means Stripe redirected — it says
 * nothing about `checkout.session.completed` having been delivered and
 * processed. Every caller must still wait on the database for that; see
 * `waitFor` in db.mjs.
 *
 * @param {import("@playwright/test").Page} page
 * @param {RegExp} returnUrlPattern
 */
export async function payAndReturn(page, returnUrlPattern, options = {}) {
  if (returnUrlPattern.test("https://checkout.stripe.com/c/pay/cs_test_x")) {
    throw new Error("payAndReturn: returnUrlPattern must not match checkout.stripe.com — see this function's doc comment.");
  }
  await payOnStripeCheckout(page, options);
  // Reaching Stripe from this machine is slow and erratic: the same flow has
  // completed in ~15s and has also sat with no network activity at all until
  // it timed out, and the server action that creates the Checkout Session
  // has been measured at 46s. The generous budget is for that latency, not
  // for a bug — a genuinely broken flow (wrong test card, a validation
  // error) fails within a few seconds rather than hanging.
  await expect(page).toHaveURL(returnUrlPattern, { timeout: 120_000 });
}
