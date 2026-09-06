import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe, readChargeFromStripe } from "./fixtures/marie.mjs";
import { seedCustomer, seedConnectAppointment, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * Rendez-vous: paid in full online, cancelled, refunded by hand.
 *
 * Every other scenario in this suite is an atelier or a formation, and those
 * are charged on the *platform* account. A rendez-vous is not: it is a Stripe
 * Connect **direct charge** on the staff member's own connected account. That
 * makes almost every step a different code path:
 *
 *   - the Checkout Session is created with `{ stripeAccount }`
 *   - `checkout.session.completed` arrives carrying `event.account`
 *   - the refund has to be issued *on that account*, not the platform
 *   - `charge.refunded` also arrives with `event.account`, and settlement has
 *     to resolve it back to the right staff member to find the leg
 *
 * None of that was covered. The atelier specs would keep passing with the
 * Connect routing entirely broken, because they never produce an event that
 * carries an account at all.
 *
 * The assertions are the same ones that matter everywhere in this suite: the
 * application never refunds anything itself, and the books balance before and
 * after Marie moves the money by hand.
 */

test.describe("rendez-vous — Connect direct charge, cancelled and refunded by hand", () => {
  let customer;
  let booking;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "rendezvous" });
    booking = await seedConnectAppointment({ customer });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the appointment is charged on the connected account and settles back to it", async ({ page }) => {
    const { appointment, staff, price } = booking;
    const connectedAccountId = staff.stripeAccountId;

    // ── 1. The customer confirms and pays in full ─────────────────────────
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/appointment/${appointment.id}/payment`);

    await expect(page.getByRole("heading", { name: /confirmez votre réservation/i })).toBeVisible();
    await page.getByRole("button", { name: /payer le total avec stripe/i }).click();
    await page.getByRole("button", { name: /confirmer ma réservation/i }).click();

    await payAndReturn(page, /\/reservation\/success/);

    // Both conditions in one gate. Prisma resolves `include` as separate
    // queries, so polling on the transactions alone can return a row read
    // before the fulfilment commit with relations read after it — a state
    // that never existed. (That exact skew failed this suite once.)
    const fulfilled = await waitFor(
      async () => {
        const row = await prisma.appointment.findUnique({
          where: { id: appointment.id },
          include: { payment: { include: { transactions: true } } },
        });
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: `appointment ${appointment.id} to be fulfilled by checkout.session.completed on ${connectedAccountId}` },
    );

    const paymentId = fulfilled.payment.id;
    expect(fulfilled.payment.status).toBe("PAID");

    const summary = await assertLedgerSound(paymentId, { expectHeld: price });
    expect(summary.collected).toBeCloseTo(price, 2);
    expect(summary.collectedByMethod.ONLINE).toBeCloseTo(price, 2);
    // Paid in full: one settlement, not an acompte and a balance.
    const types = fulfilled.payment.transactions.map((t) => t.transactionType);
    expect(types).toContain("FINAL_PAYMENT");
    expect(types).not.toContain("DEPOSIT");

    // ── 2. The admin cancels and queues the refund ────────────────────────
    await loginAsAdmin(page);
    // Rendez-vous have no tab of their own; they sit in the unified
    // transactions view as kind "Rendez-vous".
    await page.goto("/dashboard/operations?tab=transactions&page=1");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();

    const drawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: /annuler et rembourser/i }).click();

    const cancelDialog = page.getByRole("dialog", { name: /annuler et rembourser/i });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.locator("#refund-reason").fill(taggedReason("Rendez-vous annulé — test e2e Connect"));
    const confirmButton = cancelDialog.getByRole("button", { name: /confirmer l'opération/i });
    await expect(confirmButton).toBeEnabled({ timeout: 10_000 });
    await confirmButton.click();
    await expect(cancelDialog).not.toBeVisible();

    // ── 3. A debt is recorded. No money has moved. ────────────────────────
    const operation = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findFirst({
          where: { paymentId },
          include: { legs: true },
        });
        return found?.legs?.length ? found : null;
      },
      { what: "a RefundOperation to be opened for the cancelled rendez-vous" },
    );

    expect(Number(operation.totalAmount)).toBeCloseTo(price, 2);
    expect(operation.status).toBe("PENDING");
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("ONLINE");
    expect(operation.legs[0].status).toBe("PENDING");

    // The assertion this suite exists for, on the Connect path this time: the
    // application must not have refunded anything itself. Read on the
    // connected account — asking the platform about this payment intent
    // would 404, which would pass a `catch` and prove nothing.
    const beforeRefund = await readChargeFromStripe(operation.legs[0].stripePaymentIntentId, connectedAccountId);
    expect(beforeRefund.amountRefunded).toBe(0);
    await assertLedgerSound(paymentId, { expectHeld: price });

    // ── 4. Marie refunds by hand, on the staff member's account ───────────
    await refundInStripe({
      paymentIntentId: operation.legs[0].stripePaymentIntentId,
      amount: price,
      connectedAccountId,
    });

    // ── 5. charge.refunded settles it, routed by event.account ────────────
    const settled = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findUnique({
          where: { id: operation.id },
          include: { legs: true },
        });
        return found?.legs?.every((leg) => leg.status === "SUCCEEDED") ? found : null;
      },
      {
        what:
          "charge.refunded to settle the leg. This is the Connect-specific half: the event carries " +
          "event.account, and settlement has to resolve that back to the staff member who owns the charge",
        timeout: 90_000,
      },
    );

    // Null, not the amount: a leg that settled for exactly what was planned
    // records no separate settled figure — `settledAmount` exists to carry a
    // *shortfall*. lib/refunds/operation-status.js and the ledger helper both
    // read null as "settled in full", and the atelier specs assert the same.
    expect(settled.legs[0].settledAmount).toBeNull();
    expect(settled.legs[0].stripeRefundId).toBeTruthy();
    expect(settled.status).toBe("COMPLETED");

    // The euros themselves live on the REFUND transaction the settlement
    // wrote, which is what the books actually add up.
    const refundTransaction = await prisma.transaction.findFirst({
      where: { paymentId, transactionType: "REFUND", isDeleted: false },
      select: { amount: true, method: true, pieceNumber: true },
    });
    expect(refundTransaction, "the leg settled but no REFUND transaction was written").not.toBeNull();
    expect(Number(refundTransaction.amount)).toBeCloseTo(price, 2);
    expect(refundTransaction.method).toBe("ONLINE");
    // Online money never enters the drawer.
    expect(refundTransaction.pieceNumber).toBeNull();

    const finalSummary = await assertLedgerSound(paymentId, { expectHeld: 0 });
    expect(finalSummary.refunded).toBeCloseTo(price, 2);
    expect(finalSummary.refundedByMethod.ONLINE).toBeCloseTo(price, 2);
    expect(finalSummary.status).toBe("REFUNDED");

    const stripeState = await readChargeFromStripe(operation.legs[0].stripePaymentIntentId, connectedAccountId);
    expect(stripeState.amountRefunded).toBeCloseTo(price, 2);

    const after = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { status: true, cancelledAt: true },
    });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledAt).not.toBeNull();

    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);
  });
});
