import { PrismaClient } from "@prisma/client";

/**
 * Direct database access for the money suite.
 *
 * The browser can only show what a page chose to render; the question this
 * suite exists to answer — "is the ledger still arithmetically sound?" — can
 * only be asked of the database. So every scenario drives the UI like a
 * human and then verifies the books like an accountant.
 *
 * A plain client rather than @/lib/prisma: Playwright does not resolve the
 * "@" alias, and the singleton's dev-mode global caching is pointless in a
 * short-lived worker.
 */
export const prisma = new PrismaClient();

export async function disconnect() {
  await prisma.$disconnect();
}

/** Money comparison. Same tolerance the application uses (REFUND_EPSILON). */
export const EPSILON = 0.01;

export function money(value) {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

export function moneyEquals(a, b) {
  return Math.abs(Number(a) - Number(b)) <= EPSILON;
}

/**
 * Polls until `check` returns something truthy, then returns it.
 *
 * Never `waitForTimeout`. Everything asynchronous here is a webhook — Stripe
 * delivers checkout.session.completed and charge.refunded whenever it gets
 * round to it, and a fixed sleep is either flaky or slow. Polling the
 * database is the only honest way to wait for "the app has finished
 * reacting".
 *
 * @param {() => Promise<unknown>} check
 * @param {{ what: string, timeout?: number, interval?: number }} options
 */
export async function waitFor(check, { what, timeout = 60_000, interval = 500 }) {
  const deadline = Date.now() + timeout;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      // A transient read during a webhook's own transaction is expected.
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(
    `Timed out after ${Math.round(timeout / 1000)}s waiting for: ${what}\n\n` +
      "If this is the first failure of the run, the most likely cause is that the app is running under " +
      "`npm run dev` instead of `npm run dev:stripe`. Only the latter starts the Stripe CLI listener, and " +
      "without it no webhook is ever delivered, so nothing is fulfilled and no refund is ever settled.\n" +
      "Note that playwright.money.config.mjs sets reuseExistingServer, so an already-running plain dev " +
      "server is adopted silently." +
      (lastError ? `\n\nLast error while polling: ${lastError.message}` : ""),
  );
}

/**
 * The payment behind a booking/order, with everything the ledger assertions
 * need. One place so the shape can't drift between scenarios.
 */
export async function loadPaymentLedger(paymentId) {
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      transactions: { where: { isDeleted: false }, orderBy: { paidAt: "asc" } },
      invoice: true,
      refundOperations: {
        include: {
          legs: { orderBy: { createdAt: "asc" } },
          creditNote: true,
        },
      },
    },
  });
}
