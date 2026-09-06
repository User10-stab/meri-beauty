import { defineConfig, devices } from "@playwright/test";

/**
 * The dashboard suite — the third one, and the reason it exists is that
 * neither of the other two can host these tests.
 *
 * playwright.config.mjs is deliberately database-free and runs everything at
 * a 390px Pixel 5 viewport, which is right for the public site and useless
 * for the dashboard: the operations and orders tables collapse at that width.
 *
 * playwright.money.config.mjs demands the Stripe CLI listener and creates
 * real charges, real invoices and real credit notes. Asking "does a staff
 * member without ORDERS get a 403 on this invoice?" does not need to move a
 * single euro, and paying the money suite's cost (and risk) to ask it would
 * mean the question quietly never gets asked.
 *
 * So: a real database and a real login, no money. The env guard is shared
 * with the money suite unchanged — these flows still send e-mail, and the dev
 * database holds real customer addresses.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e-dashboard",
  globalSetup: "./tests/e2e-dashboard/fixtures/global-setup.mjs",

  // Serial. Every scenario logs a browser context in as a specific person and
  // several share seeded rows; parallel workers would interleave sessions on
  // the same seeded staff member and produce failures that read as
  // authorisation bugs.
  workers: 1,
  fullyParallel: false,
  retries: 0,

  timeout: 90_000,
  expect: { timeout: 10_000 },

  reporter: [["list"], ["html", { outputFolder: "playwright-report-dashboard", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    // Plain `next dev` is correct here: nothing in this suite waits on a
    // Stripe webhook, so the CLI listener would only slow startup. An
    // already-running `npm run dev:stripe` is adopted just as happily.
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
