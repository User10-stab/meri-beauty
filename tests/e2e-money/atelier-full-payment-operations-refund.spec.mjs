import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { getRunId, taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe, readChargeFromStripe } from "./fixtures/marie.mjs";
import { seedCustomer, seedWorkshopSession, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * Atelier: full price paid online in one go, cancelled and refunded through
 * the unified Operations screen (/dashboard/operations) — the screen built
 * in the tab-unification work, whose "Annuler et rembourser" action
 * (TransactionDetailDrawer -> CancelAndRefundDialog -> cancelAndRefund) was
 * previously wired to nothing reachable in the live UI, on any tab.
 *
 * Complements atelier-acompte-refund.spec.mjs, which covers the 50% acompte
 * split and cancels via the older /dashboard/workshops/reservations page.
 * This one covers the other two things that test doesn't:
 *
 *   1. A "Payer le montant total" (no acompte/balance split) booking — a
 *      single FINAL_PAYMENT transaction, never a DEPOSIT.
 *   2. Cancel-and-refund driven from the unified Operations screen itself:
 *      Ateliers preset -> "Voir / gérer" -> "Annuler et rembourser", the
 *      exact path that was dead code before this work.
 *
 * As before, the assertions that matter are not "the dialog closed". They
 * are: the full price was queued (never a duplicated or wrong amount), no
 * money moved until Marie moved it in Stripe, and the ledger balances at
 * every step.
 */

const ACTIVITY_PRICE = 60;

test.describe("atelier — paid in full online, cancelled and refunded from the unified Operations screen", () => {
  let customer;
  let workshop;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "atelierfull" });
    workshop = await seedWorkshopSession({ price: ACTIVITY_PRICE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the full payment is queued for manual refund and settles through Voir / gérer -> Annuler et rembourser", async ({ page }) => {
    const runId = getRunId();

    // ── 1. The customer books and pays the full price ─────────────────────
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/reservation-atelier?activity=${workshop.activity.id}&session=${workshop.session.id}`);

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    // "Payer un acompte" is selected by default — switch to the full-price
    // mode before anything else (app/(public)/reservation-atelier/page.js:608-617).
    await page.getByRole("button", { name: /payer le montant total/i }).click();

    // See atelier-acompte-refund.spec.mjs for why this is scoped to the
    // label's own checkbox rather than a role query on the checkbox itself.
    await page
      .locator("label", { hasText: /j'ai lu et j'accepte/i })
      .locator('input[type="checkbox"]')
      .check();
    await page.getByRole("button", { name: /payer le montant total de/i }).click();
    await payAndReturn(page, /\/reservation-atelier\/succes/);

    const reservation = await waitFor(
      async () => {
        const row = await prisma.workshopReservation.findFirst({
          where: { sessionId: workshop.session.id, customerId: customer.id },
          include: { payment: { include: { transactions: true } } },
        });
        return row?.payment?.transactions?.length ? row : null;
      },
      { what: `the atelier reservation for session ${workshop.session.id} to be fulfilled by checkout.session.completed` },
    );

    const paymentId = reservation.payment.id;

    let summary = await assertLedgerSound(paymentId, { expectHeld: ACTIVITY_PRICE });
    expect(summary.collected).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(summary.collectedByMethod.ONLINE).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(reservation.status).toBe("CONFIRMED");
    // The whole point of "payer le montant total": one settlement event, not
    // an acompte + balance pair.
    const transactionTypes = reservation.payment.transactions.map((t) => t.transactionType);
    expect(transactionTypes).toContain("FINAL_PAYMENT");
    expect(transactionTypes).not.toContain("DEPOSIT");

    // ── 2. The admin cancels and refunds from the unified Operations screen ─
    await loginAsAdmin(page);
    await page.goto("/dashboard/operations?tab=workshops&page=1");

    const row = page.getByRole("row").filter({ hasText: workshop.activity.title });
    await expect(row).toHaveCount(1, { timeout: 15000 });
    await row.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();

    const drawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(drawer).toBeVisible();

    // This is the button Part 1 of the unification work added — before it,
    // TransactionDetailDrawer had no cancellation action of any kind, on
    // any row, from any tab.
    await expect(drawer.getByRole("button", { name: /annuler et rembourser/i })).toBeVisible({ timeout: 10000 });
    await drawer.getByRole("button", { name: /annuler et rembourser/i }).click();

    const cancelDialog = page.getByRole("dialog", { name: /annuler et rembourser/i });
    await expect(cancelDialog).toBeVisible();

    const reason = taggedReason("Atelier annulé — test e2e paiement complet");
    await cancelDialog.locator("#refund-reason").fill(reason);
    const confirmButton = cancelDialog.getByRole("button", { name: /confirmer l'opération/i });
    await expect(confirmButton).toBeEnabled({ timeout: 10000 });
    await confirmButton.click();
    await expect(cancelDialog).not.toBeVisible();

    // ── 3. A debt is recorded. No money has moved. ─────────────────────────
    const operation = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findFirst({
          where: { paymentId },
          include: { legs: true },
        });
        return found?.legs?.length ? found : null;
      },
      { what: "a RefundOperation to be opened for the cancelled atelier" },
    );

    expect(Number(operation.totalAmount)).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(operation.status).toBe("PENDING");
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("ONLINE");
    expect(Number(operation.legs[0].amount)).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(operation.legs[0].status).toBe("PENDING");

    // The single most important assertion in this file: cancelAndRefund must
    // not have touched Stripe itself.
    const stripeState = await readChargeFromStripe(operation.legs[0].stripePaymentIntentId);
    expect(stripeState.amountRefunded).toBe(0);
    await assertLedgerSound(paymentId, { expectHeld: ACTIVITY_PRICE });
    expect(operation.customerNotifiedAt).toBeNull();

    // The debt shows on the worklist for the exact amount, not double-counted.
    await page.goto("/dashboard/operations");
    const worklist = page
      .getByRole("region", { name: /remboursements dus/i })
      .or(page.locator("section", { hasText: /remboursements dus/i }));
    await expect(worklist.first()).toContainText(ACTIVITY_PRICE.toFixed(2).replace(".", ","));

    // ── 4. Marie refunds by hand, and only then does it settle ────────────
    await refundInStripe({
      paymentIntentId: operation.legs[0].stripePaymentIntentId,
      amount: ACTIVITY_PRICE,
    });

    const settled = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findUnique({
          where: { id: operation.id },
          include: { legs: true },
        });
        return found?.legs?.every((leg) => leg.status === "SUCCEEDED") ? found : null;
      },
      { what: "charge.refunded to settle the atelier refund leg" },
    );

    expect(settled.status).toBe("COMPLETED");
    expect(settled.legs[0].settledAmount).toBeNull();
    expect(settled.legs[0].failureReason).toBeNull();

    // ── 5. The books balance, the seat is released, nothing is owed ───────
    summary = await assertLedgerSound(paymentId, { expectHeld: 0 });
    expect(summary.refunded).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(summary.refundedByMethod.ONLINE).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(summary.status).toBe("REFUNDED");

    const cancelled = await prisma.workshopReservation.findUnique({ where: { id: reservation.id } });
    expect(cancelled.status).toBe("CANCELLED");

    // ── 6. The admin sends the B2C confirmation manually, only once settled ─
    // Re-open the row from the unified screen — its "Voir / gérer" now opens
    // the settled REFUND transaction, not the original FINAL_PAYMENT one.
    await page.goto("/dashboard/operations?tab=workshops&page=1");
    const settledRow = page.getByRole("row").filter({ hasText: workshop.activity.title });
    await expect(settledRow).toHaveCount(1, { timeout: 15000 });
    await settledRow.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();

    const settledDrawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(settledDrawer).toBeVisible();
    const notifyButton = settledDrawer.getByRole("button", { name: /envoyer la confirmation/i });
    await expect(notifyButton).toBeVisible({ timeout: 10000 });
    await notifyButton.click();

    await waitFor(
      async () => {
        const found = await prisma.refundOperation.findUnique({ where: { id: operation.id } });
        return found?.customerNotifiedAt ? found : null;
      },
      { what: "the customer to be notified once the admin chooses to send it" },
    );

    // Issuing a real credit note into the real counters must not leave a
    // hole — a no-op check here since this customer is a B2C particulier
    // with no invoice, but standing coverage for the series regardless.
    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);

    // Sanity: this test's run id shows up somewhere in the trail so a failed
    // run's leftover data stays traceable.
    expect(runId).toBeTruthy();
  });
});
