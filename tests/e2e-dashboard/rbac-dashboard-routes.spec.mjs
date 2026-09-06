import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStaff } from "./fixtures/seed-dashboard.mjs";

/**
 * The permission matrix, exercised over HTTP.
 *
 * tests/critical/ already asserts that every one of these pages *calls*
 * requireDashboardPermission — by grepping the source. That proves the line
 * was written. It cannot prove the route refuses: not that the session
 * carries the permissions it should, not that getDashboardPermissions reads
 * the right column, not that the refusal happens before the page renders its
 * data. Those are runtime facts, and each has a plausible way to break
 * without changing a character of the source a grep would look at.
 *
 * So this walks the routes with a real cookie and reads what the server
 * actually does.
 */

// requireDashboardPermission -> redirect("/dashboard")
const PERMISSION_ROUTES = [
  ["/dashboard/allAppointments", "APPOINTMENTS"],
  ["/dashboard/appointments", "APPOINTMENTS"],
  ["/dashboard/boutique/caisse", "CASH_REGISTER"],
  ["/dashboard/boutique/caisse/depots", "CASH_REGISTER"],
  ["/dashboard/boutique/orders", "ORDERS"],
  ["/dashboard/boutique/point-of-sale", "POINT_OF_SALE"],
  ["/dashboard/boutique/products", "BOUTIQUE_STOCK"],
  ["/dashboard/boutique/returns", "RETURNS"],
  ["/dashboard/boutique/scan", "POINT_OF_SALE"],
  ["/dashboard/boutique/stock", "BOUTIQUE_STOCK"],
  ["/dashboard/customers", "CUSTOMERS"],
  ["/dashboard/formations", "FORMATIONS"],
  ["/dashboard/formations/reservations", "FORMATION_RESERVATIONS"],
  ["/dashboard/newsletter", "NEWSLETTER"],
  ["/dashboard/services", "SERVICES"],
  ["/dashboard/workshops/activities", "WORKSHOPS"],
  ["/dashboard/workshops/animators", "WORKSHOPS"],
  ["/dashboard/workshops/reservations", "WORKSHOP_RESERVATIONS"],
  ["/dashboard/workshops/waiting-list", "WORKSHOP_RESERVATIONS"],
];

/**
 * Admin-only, refused two different ways depending on which of the two
 * independent layers catches the request first:
 *
 *   auth.config.js#ADMIN_ONLY_ROUTES, applied through proxy.js, redirects a
 *   handful of path prefixes to /dashboard before the page ever runs;
 *
 *   requireAdmin() inside the page calls notFound(), rendering the 404 UI.
 *
 * Both are refusals, and which one fires is incidental — the prefix list
 * holds 6 entries and misses most of this list. So this asserts *refusal*,
 * not which layer produced it, and deliberately not the HTTP status: a page
 * with a loading.jsx has already flushed its shell (and therefore its 200) by
 * the time notFound() throws, so /dashboard/boutique/products/new answers 200
 * while rendering "Cette page n'existe pas". Asserting 404 there fails a page
 * that is refusing perfectly well.
 */
const ADMIN_ONLY_ROUTES = [
  "/dashboard/appointments/exceptions",
  "/dashboard/audit-logs",
  "/dashboard/boutique/categories",
  "/dashboard/boutique/products/import",
  "/dashboard/boutique/products/new",
  "/dashboard/operations",
  "/dashboard/payments/disputes",
  // Folded into Opérations this cycle. A staff member following the old
  // bookmark must land on /dashboard, not inside the anomalies list.
  "/dashboard/payments/reconciliation",
  "/dashboard/promo-codes",
  "/dashboard/rental-requests",
  "/dashboard/reports",
  "/dashboard/reservations/exceptions",
  "/dashboard/reviews",
  "/dashboard/settings",
  "/dashboard/staff/auto-entrepreneur",
  "/dashboard/staff/performance",
];

/** The shared not-found body. */
const NOT_FOUND_MARKER = /cette page n.existe pas/i;

/**
 * How long to give a refusal to arrive before calling the page reached.
 *
 * This has to be a wait, not a snapshot, and every cheaper signal was tried
 * and is wrong here:
 *
 *   `load` fires while the dashboard shell is on screen and the page itself
 *   is still a Suspense placeholder, so reading then sees neither outcome.
 *
 *   `networkidle` never arrives at all against `next dev` — the page is never
 *   idle, and each navigation simply burns the whole test timeout.
 *
 *   "wait until the text stops changing" latches onto the shell, which is
 *   perfectly still: on /dashboard/boutique/products/new the sidebar and the
 *   "Préparation du nouveau produit…" placeholder sit unchanged for ~3.5s
 *   before notFound() replaces the whole document. A stability heuristic
 *   scores that as a page that rendered — i.e. as a security failure.
 *
 * So this polls for the refusal itself and gives it 10s, comfortably past the
 * 3.5s observed. The cost is paid by routes that really are reachable, since
 * those wait out the window; that is the right way round, because a false
 * "reached" is a false alarm about a permission hole and a false "refused" is
 * a hole this suite would miss.
 */
const REFUSAL_WINDOW_MS = 10_000;

/**
 * Did the browser end up looking at the page it asked for?
 *
 * Two things make the naive check wrong. A refusal lands somewhere different
 * depending on who is asking — staff are sent to /dashboard, a customer is
 * bounced on to / because canAccessDashboard is false for them — so "did we
 * end on /dashboard" inverts between the two. And notFound() leaves the URL
 * untouched while rendering the 404 UI, so the URL alone would score that a
 * success.
 */
async function visit(page, route) {
  let status = 0;
  try {
    const response = await page.goto(route, { waitUntil: "load" });
    status = response?.status() ?? 0;
  } catch (error) {
    // A server-side redirect issued while the document is still streaming
    // aborts the navigation Playwright is waiting on. The browser follows it
    // regardless, so the URL below is still the honest answer.
    if (!/ERR_ABORTED|frame was detached/i.test(error.message)) throw error;
  }

  const deadline = Date.now() + REFUSAL_WINDOW_MS;
  while (Date.now() < deadline) {
    const url = page.url();
    if (new URL(url).pathname !== route) return { status, url, reached: false };

    const body = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    if (NOT_FOUND_MARKER.test(body)) return { status, url, reached: false };

    await page.waitForTimeout(300);
  }

  return { status, url: page.url(), reached: true };
}

/** Cold Turbopack compiles dominate: ~19 routes, first visit each. */
const MATRIX_TIMEOUT = 300_000;

test.describe("dashboard route permissions", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a staff member holding only ORDERS reaches the orders screen and nothing else", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    const { credentials } = await seedStaff({ label: "orders-only", permissions: ["ORDERS"] });
    await loginAs(page, credentials);

    const wrong = [];
    for (const [route, permission] of PERMISSION_ROUTES) {
      const { url, reached } = await visit(page, route);
      const shouldReach = permission === "ORDERS";
      if (reached !== shouldReach) {
        wrong.push(
          `${route} (needs ${permission}): ${reached ? "reached" : "refused"}, expected ` +
            `${shouldReach ? "reached" : "refused"} — landed on ${url}`,
        );
      }
    }

    expect(wrong, `\n${wrong.join("\n")}\n`).toEqual([]);
  });

  test("that same staff member cannot reach any admin-only screen", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    const { credentials } = await seedStaff({ label: "orders-only-admin-probe", permissions: ["ORDERS"] });
    await loginAs(page, credentials);

    const reached = [];
    for (const route of ADMIN_ONLY_ROUTES) {
      const { url, reached: got } = await visit(page, route);
      if (got) reached.push(`${route} — the page rendered (${url})`);
    }

    expect(reached, `\n${reached.join("\n")}\n`).toEqual([]);
  });

  test("permissions are additive and independent — a till operator gets the till, not the shop", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    const { credentials } = await seedStaff({
      label: "till",
      permissions: ["CASH_REGISTER", "POINT_OF_SALE"],
    });
    await loginAs(page, credentials);

    const allowed = ["CASH_REGISTER", "POINT_OF_SALE"];
    const wrong = [];
    for (const [route, permission] of PERMISSION_ROUTES) {
      const { url, reached } = await visit(page, route);
      const shouldReach = allowed.includes(permission);
      if (reached !== shouldReach) {
        wrong.push(`${route} (needs ${permission}): ${reached ? "reached" : "refused"} — landed on ${url}`);
      }
    }

    expect(wrong, `\n${wrong.join("\n")}\n`).toEqual([]);
  });

  test("a staff member with no permissions at all reaches no gated screen", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    // The schema default grants seven permissions, so "none" is the case most
    // likely to be got wrong by a helpful `?? DEFAULTS` somewhere.
    const { credentials } = await seedStaff({ label: "no-permissions", permissions: [] });
    await loginAs(page, credentials);

    const reached = [];
    for (const [route] of PERMISSION_ROUTES) {
      const { url, reached: got } = await visit(page, route);
      if (got) reached.push(`${route} — the page rendered (${url})`);
    }

    expect(reached, `\n${reached.join("\n")}\n`).toEqual([]);
  });

  test("an admin reaches every gated screen", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    // Every negative test above would pass just as happily against a
    // dashboard that refused everybody. This is the control that says the
    // matrix measures permissions rather than breakage.
    const admin = await seedAdmin({ label: "matrix" });
    await loginAs(page, admin.credentials);

    const refused = [];
    for (const [route] of PERMISSION_ROUTES) {
      const { url, status, reached } = await visit(page, route);
      if (!reached || status >= 400) refused.push(`${route} — ${status} at ${url}`);
    }

    expect(refused, `\n${refused.join("\n")}\n`).toEqual([]);
  });

  test("a customer is not admitted to salon screens", async ({ page }) => {
    test.setTimeout(MATRIX_TIMEOUT);
    const customer = await seedCustomer({ label: "dash-probe" });
    await loginAs(page, customerCredentials(customer));

    const admitted = [];
    for (const [route] of PERMISSION_ROUTES) {
      const { url, reached } = await visit(page, route);
      if (reached) admitted.push(`${route} — the page rendered (${url})`);
    }

    expect(admitted, `\n${admitted.join("\n")}\n`).toEqual([]);
  });
});
