import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe, readChargeFromStripe, resendChargeRefundedEvent } from "./fixtures/marie.mjs";
import { seedCustomer, seedWorkshopSession, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * The same `charge.refunded` delivered twice must settle once.
 *
 * Stripe guarantees *at-least-once* delivery. A duplicate is not an exotic
 * failure to design against — it is ordinary operation, produced by a slow
 * response, a deploy mid-delivery, or Stripe simply retrying. Every other
 * scenario in this suite delivers each event exactly once, so all of them
 * would keep passing with the guard against this completely removed.
 *
 * What a missing guard costs is the worst shape of bug this codebase has:
 * a second `Transaction{REFUND}` for money that only moved once. The ledger
 * would then say more was refunded than was ever collected, `Payment.status`
 * would follow that arithmetic, the credit-note total would stop matching its
 * operation — and the customer would be told a second time that they had been
 * refunded. None of it visible on any screen until the books are reconciled.
 *
 * The guard is arithmetic rather than an event-id ledger
 * (app/api/webhooks/stripe/route.js): settlement computes what Stripe says
 * has been refunded in total, subtracts what our transactions already record,
 * and writes only the difference. On a redelivery that difference is zero.
 * That design is *better* than de-duplicating by event id — it also absorbs a
 * refund made by hand that we never saw an event for — but it is only correct
 * if the subtraction is right, and nothing exercised it.
 *
 * `resendChargeRefundedEvent` has existed in the fixtures since this suite was
 * written, called by nothing. This is the test it was written for.
 */

const ACTIVITY_PRICE = 45;

test.describe("a redelivered charge.refunded settles once, not twice", () => {
  let customer;
  let workshop;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "redelivery" });
    workshop = await seedWorkshopSession({ price: ACTIVITY_PRICE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the second delivery of the same event changes nothing at all", async ({ page }) => {
    // ── 1. Book, pay in full, cancel, and let Marie refund by hand ─────────
    // Deliberately the plainest possible path to a settled refund. This test
    // is not about how the refund was reached, so it takes the shortest route
    // to one and spends its assertions on what happens afterwards.
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/reservation-atelier?activity=${workshop.activity.id}&session=${workshop.session.id}`);

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    await page.getByRole("button", { name: /payer le montant total/i }).click();
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
        // Status as well as transactions: Prisma resolves `include` as
        // separate queries, so polling on one and asserting the other can
        // observe a state that never existed (see T6d in E2E_FINDINGS.md).
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: `the atelier reservation for session ${workshop.session.id} to be fulfilled` },
    );

    const paymentId = reservation.payment.id;

    await loginAsAdmin(page);
    await page.goto("/dashboard/operations?tab=workshops&page=1");

    const row = page
      .getByRole("row")
      .filter({ hasText: workshop.activity.title })
      .filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();

    const drawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: /annuler et rembourser/i }).click();

    const cancelDialog = page.getByRole("dialog", { name: /annuler et rembourser/i });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.locator("#refund-reason").fill(taggedReason("Atelier annulé — test e2e redelivery"));
    const confirmButton = cancelDialog.getByRole("button", { name: /confirmer l'opération/i });
    await expect(confirmButton).toBeEnabled({ timeout: 10_000 });
    await confirmButton.click();
    await expect(cancelDialog).not.toBeVisible();

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

    const paymentIntentId = operation.legs[0].stripePaymentIntentId;
    await refundInStripe({ paymentIntentId, amount: ACTIVITY_PRICE });

    // ── 2. The first delivery settles it ──────────────────────────────────
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
      { what: "the first charge.refunded delivery to settle the leg" },
    );

    // ── 3. Photograph everything the redelivery could damage ──────────────
    const before = {
      summary: await assertLedgerSound(paymentId, { expectHeld: 0 }),
      refundTransactions: await prisma.transaction.findMany({
        where: { paymentId, transactionType: "REFUND", isDeleted: false },
        select: { id: true, amount: true, method: true, pieceNumber: true },
        orderBy: { id: "asc" },
      }),
      legs: settled.legs.map((leg) => ({
        id: leg.id,
        status: leg.status,
        settledAmount: leg.settledAmount,
        stripeRefundId: leg.stripeRefundId,
      })),
      // CreditNote has no back-reference to its operation — the link is
      // RefundOperation.creditNoteId — so both halves are captured: the one
      // this operation points at, and the size of the whole series, which
      // catches a second note issued and left orphaned.
      creditNoteId: settled.creditNoteId,
      creditNotesInSeries: await prisma.creditNote.count({
        where: { number: { startsWith: `NC${new Date().getFullYear()}-` } },
      }),
      // Whether the customer has been told. A duplicate settlement that also
      // re-sent this would tell somebody twice that they had been refunded —
      // the most visible symptom of the bug, and the one that reaches a real
      // person rather than a reconciliation months later.
      customerNotifiedAt: settled.customerNotifiedAt,
    };

    expect(before.refundTransactions, "the first delivery should write exactly one REFUND").toHaveLength(1);
    expect(Number(before.refundTransactions[0].amount)).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(before.summary.refunded).toBeCloseTo(ACTIVITY_PRICE, 2);

    const { chargeId } = await readChargeFromStripe(paymentIntentId);
    expect(chargeId, "no charge on the payment intent — nothing to redeliver").toBeTruthy();

    // ── 4. Deliver the very same event again ──────────────────────────────
    const resentEventId = await resendChargeRefundedEvent({ chargeId });
    expect(resentEventId).toMatch(/^evt_/);

    // ── 5. Nothing may have changed ───────────────────────────────────────
    // Polled rather than checked once. The redelivery is asynchronous, so a
    // single read straight afterwards would pass simply by being early — the
    // exact way this assertion could look green while the bug is present.
    // Holding the invariant across a window means a duplicate appearing at
    // any point inside it fails the test.
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const refunds = await prisma.transaction.count({
        where: { paymentId, transactionType: "REFUND", isDeleted: false },
      });
      expect(
        refunds,
        "a redelivered charge.refunded wrote a second REFUND transaction — the ledger now says more was " +
          "refunded than was ever collected",
      ).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const after = {
      summary: await assertLedgerSound(paymentId, { expectHeld: 0 }),
      refundTransactions: await prisma.transaction.findMany({
        where: { paymentId, transactionType: "REFUND", isDeleted: false },
        select: { id: true, amount: true, method: true, pieceNumber: true },
        orderBy: { id: "asc" },
      }),
      creditNoteId: (await prisma.refundOperation.findUnique({
        where: { id: operation.id },
        select: { creditNoteId: true },
      })).creditNoteId,
      creditNotesInSeries: await prisma.creditNote.count({
        where: { number: { startsWith: `NC${new Date().getFullYear()}-` } },
      }),
    };

    // Identical rows, not merely an identical count: a settlement that
    // rewrote the existing transaction with a doubled amount would keep the
    // count at one and still be catastrophic.
    expect(after.refundTransactions).toEqual(before.refundTransactions);
    expect(after.summary.refunded).toBeCloseTo(before.summary.refunded, 2);
    expect(after.summary.refundedByMethod.ONLINE).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(after.summary.status).toBe("REFUNDED");
    expect(after.creditNoteId).toBe(before.creditNoteId);
    expect(
      after.creditNotesInSeries,
      "the redelivery issued a second credit note into a legally gapless series",
    ).toBe(before.creditNotesInSeries);

    const reread = await prisma.refundOperation.findUnique({
      where: { id: operation.id },
      include: { legs: true },
    });
    expect(reread.status).toBe("COMPLETED");
    expect(
      reread.legs.map((leg) => ({
        id: leg.id,
        status: leg.status,
        settledAmount: leg.settledAmount,
        stripeRefundId: leg.stripeRefundId,
      })),
    ).toEqual(before.legs);
    expect(
      reread.customerNotifiedAt,
      "the redelivery re-notified the customer — they have now been told twice about one refund",
    ).toEqual(before.customerNotifiedAt);

    // Stripe's own view is unchanged too, which is what makes the above mean
    // "we ignored a duplicate" rather than "we refunded twice and the books
    // happen to agree with themselves".
    const stripeState = await readChargeFromStripe(paymentIntentId);
    expect(stripeState.amountRefunded).toBeCloseTo(ACTIVITY_PRICE, 2);

    // A second credit note would punch a duplicate into a legally gapless
    // series, which is the one consequence here that cannot be quietly fixed
    // with an UPDATE.
    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);
  });
});
