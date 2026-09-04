import { defineConfig, devices } from "@playwright/test";

/**
 * The money suite. Separate from playwright.config.mjs on purpose: that one
 * is fast, database-free and safe to run anywhere, while this one creates
 * real Stripe charges, real refunds and real accounting documents in the dev
 * database. Keeping them apart means `npm run test:e2e` never surprises
 * anyone by moving money.
 *
 * Read tests/e2e-money/README.md before running.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e-money",
  globalSetup: "./tests/e2e-money/fixtures/global-setup.mjs",

  // Serial, and never retried.
  //
  // Parallel workers would collide on three genuinely global resources: the
  // gapless Invoice/CreditNote numbering counters, the single open
  // CashSession the POS and settlement paths require, and the shared Stripe
  // account. And a retry would not re-run a "test" — it would charge a card
  // and issue a credit note a second time, leaving the first attempt's money
  // stranded. A flake here has to be read, not retried.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  // Generous: a scenario redirects to Stripe's hosted Checkout (observed
  // taking anywhere from ~15s to 120s to confirm payment on this test
  // account — see the comment on payAndReturn in
  // fixtures/stripe-checkout.mjs), comes back, drives an admin action, then
  // waits on a second asynchronous webhook round trip through the Stripe CLI
  // for the refund to settle. Those waits can stack.
  timeout: 300_000,
  expect: { timeout: 15_000 },

  reporter: [["list"], ["html", { outputFolder: "playwright-report-money", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
  },

  projects: [
    {
      // The dashboard is a desktop application — the existing suite's Pixel 5
      // viewport collapses the operations tables this one has to read.
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    // Not `next dev`: the Stripe CLI listener is what delivers
    // checkout.session.completed and charge.refunded to localhost, and
    // without it every settlement assertion times out.
    command: "npm run dev:stripe",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
