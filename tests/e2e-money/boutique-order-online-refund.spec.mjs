import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe, readChargeFromStripe } from "./fixtures/marie.mjs";
import {
  seedCustomer,
  seedShopProduct,
  readVariantStock,
  customerCredentials,
} from "./fixtures/seed-money.mjs";

/**
 * The shop, end to end: browse, buy, get refunded.
 *
 * Until now this suite covered three ateliers and one rendez-vous. The
 * boutique — the flow with the most customers passing through it — had no
 * money test at all, and it is not a variation on the others. It is the only
 * paid path with **stock**, and stock is the part that cannot be corrected
 * later by an accountant:
 *
 *   at checkout   `reservedQuantity` goes up   (createOrderFromCart)
 *   at fulfilment `stockQuantity` goes down and `reservedQuantity` back
 *                                             (fulfillOrderPayment)
 *   at refund     `stockQuantity` goes back up (open-refund-operation)
 *
 * Three separate places, each in a different module, each inside a different
 * transaction, and the middle one driven by a webhook. An atelier exercises
 * none of them — it moves seats, which are a count on one row.
 *
 * The scenario is PICKUP_PREPAID rather than shipping: the third mode depends
 * on Mondial Relay rate tiers that are still a placeholder
 * (PROJECT_REQUIREMENTS.md §2), so a shipping test would be asserting against
 * a price nobody has agreed to yet.
 *
 * Everything else is the standing contract of this suite: the application
 * never refunds anything itself, Marie moves the money by hand, and the books
 * balance at every step.
 */

const PRICE = 32;
const STOCK = 12;
const QUANTITY = 1;

test.describe("boutique — bought online, cancelled and refunded by hand", () => {
  let customer;
  let shop;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "boutique" });
    shop = await seedShopProduct({ label: "boutique", price: PRICE, stockQuantity: STOCK });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("stock moves exactly three times and the ledger balances at every step", async ({ page }) => {
    // ── 1. The customer buys it through the real funnel ───────────────────
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/boutique/${shop.slug}`);

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    const addToCart = page.getByRole("button", { name: /ajouter au panier/i }).first();
    await expect(addToCart).toBeVisible({ timeout: 20_000 });
    await addToCart.click();

    // Wait for the toast, not just the click. addToCart is a server action,
    // and navigating straight afterwards loads /boutique/cart before the row
    // has committed — the cart renders empty and the failure looks like "the
    // product was never added" when in fact it was, a second later. (This
    // test failed exactly that way once; the CartItem was in the database by
    // the time the failure was investigated.)
    await expect(page.locator("[data-sonner-toast]")).toContainText(/ajout.* au panier/i, {
      timeout: 15_000,
    });

    await page.goto("/boutique/cart");
    await expect(
      page.getByText(shop.product.name),
      "the cart did not show the product that was just added",
    ).toBeVisible();
    await page.getByRole("link", { name: /passer la commande/i }).click();
    await expect(page).toHaveURL(/\/boutique\/checkout/);

    // "Retrait en boutique — payer en ligne" (PICKUP_PREPAID). Matched on the
    // "payer en ligne" half because the on-site mode shares the first half of
    // its title and would otherwise be an equally good match — picking that
    // one silently turns this into a completely different scenario that never
    // reaches Stripe at all.
    await page.getByRole("button", { name: /retrait en boutique\s*—\s*payer en ligne/i }).click();

    await page
      .locator("label", { hasText: /j'ai lu et j'accepte/i })
      .locator('input[type="checkbox"]')
      .check();

    // Stock is reserved by this click, before any money moves.
    await page.getByRole("button", { name: /confirmer la commande/i }).click();
    await payAndReturn(page, /\/boutique\/order\/success/);

    // ── 2. Fulfilment: paid, stock down, reservation gone ─────────────────
    const order = await waitFor(
      async () => {
        const row = await prisma.order.findFirst({
          where: { userId: customer.id, items: { some: { variantId: shop.variant.id } } },
          include: { payment: { include: { transactions: true } }, items: true },
        });
        // Status *and* transactions in one gate — Prisma resolves `include`
        // as separate queries, so polling on one while asserting the other
        // can observe a state that never existed (T6d in E2E_FINDINGS.md).
        return row?.status === "PAID" && row.payment?.transactions?.length ? row : null;
      },
      { what: `the boutique order for ${shop.product.name} to be fulfilled by checkout.session.completed` },
    );

    const paymentId = order.payment.id;
    expect(order.fulfilmentMode).toBe("PICKUP_PREPAID");
    expect(order.payment.status).toBe("PAID");

    const types = order.payment.transactions.map((t) => t.transactionType);
    expect(types).toContain("FINAL_PAYMENT");
    expect(types).not.toContain("DEPOSIT");

    // The assertion no atelier scenario can make: the goods actually left the
    // shelf, and the hold that protected them while the customer was on
    // Stripe's page was let go in the same breath. A reservation left behind
    // here would make the product unsellable for ever, silently.
    expect(await readVariantStock(shop.variant.id)).toEqual({
      stock: STOCK - QUANTITY,
      reserved: 0,
    });

    const collected = Number(order.totalAmount);
    let summary = await assertLedgerSound(paymentId, { expectHeld: collected });
    expect(summary.collected).toBeCloseTo(collected, 2);
    expect(summary.collectedByMethod.ONLINE).toBeCloseTo(collected, 2);

    // ── 3. The admin cancels and queues the refund ────────────────────────
    await loginAsAdmin(page);
    await page.goto("/dashboard/operations?tab=orders&page=1");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();

    const drawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: /annuler et rembourser/i }).click();

    const cancelDialog = page.getByRole("dialog", { name: /annuler et rembourser/i });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.locator("#refund-reason").fill(taggedReason("Commande annulée — test e2e boutique"));
    const confirmButton = cancelDialog.getByRole("button", { name: /confirmer l'opération/i });
    await expect(confirmButton).toBeEnabled({ timeout: 10_000 });
    await confirmButton.click();
    await expect(cancelDialog).not.toBeVisible();

    // ── 4. A debt is recorded, the goods come back, no money has moved ────
    const operation = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findFirst({
          where: { paymentId },
          include: { legs: true },
        });
        return found?.legs?.length ? found : null;
      },
      { what: "a RefundOperation to be opened for the cancelled order" },
    );

    expect(Number(operation.totalAmount)).toBeCloseTo(collected, 2);
    expect(operation.status).toBe("PENDING");
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("ONLINE");

    // Stock returns when the order is cancelled, not when the money lands.
    // That is deliberate and worth pinning: the item is back on the shelf and
    // sellable immediately, while the refund may sit in the worklist for days
    // waiting for Marie. A test that only checked stock at the very end would
    // pass either way and prove nothing about the ordering.
    expect(await readVariantStock(shop.variant.id)).toEqual({ stock: STOCK, reserved: 0 });

    // The assertion this whole suite exists for: cancelling must not have
    // touched Stripe.
    const beforeRefund = await readChargeFromStripe(operation.legs[0].stripePaymentIntentId);
    expect(beforeRefund.amountRefunded).toBe(0);
    await assertLedgerSound(paymentId, { expectHeld: collected });

    // ── 5. Marie refunds by hand, and only then does it settle ────────────
    await refundInStripe({
      paymentIntentId: operation.legs[0].stripePaymentIntentId,
      amount: collected,
    });

    const settled = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findUnique({
          where: { id: operation.id },
          include: { legs: true },
        });
        return found?.status === "COMPLETED" && found.legs.every((leg) => leg.status === "SUCCEEDED")
          ? found
          : null;
      },
      { what: "charge.refunded to settle the boutique refund leg" },
    );

    // Null, not the amount: settledAmount carries a *shortfall*, so a leg that
    // settled for exactly what was planned records nothing (N5).
    expect(settled.legs[0].settledAmount).toBeNull();
    expect(settled.legs[0].stripeRefundId).toBeTruthy();

    const refundTransaction = await prisma.transaction.findFirst({
      where: { paymentId, transactionType: "REFUND", isDeleted: false },
      select: { amount: true, method: true, pieceNumber: true },
    });
    expect(refundTransaction, "the leg settled but no REFUND transaction was written").not.toBeNull();
    expect(Number(refundTransaction.amount)).toBeCloseTo(collected, 2);
    expect(refundTransaction.method).toBe("ONLINE");
    // Online money never enters the drawer, so it carries no cash-book piece.
    expect(refundTransaction.pieceNumber).toBeNull();

    summary = await assertLedgerSound(paymentId, { expectHeld: 0 });
    expect(summary.refunded).toBeCloseTo(collected, 2);
    expect(summary.refundedByMethod.ONLINE).toBeCloseTo(collected, 2);
    expect(summary.status).toBe("REFUNDED");

    const cancelled = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, cancelledAt: true },
    });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();

    // Settling must not move stock a fourth time — the goods came back at
    // cancellation and are already on sale. Double-restocking here would
    // invent a unit the salon does not own.
    expect(await readVariantStock(shop.variant.id)).toEqual({ stock: STOCK, reserved: 0 });

    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);
  });
});
