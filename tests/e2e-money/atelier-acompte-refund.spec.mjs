import { expect, test } from "@playwright/test";
import { prisma, waitFor, money, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { getRunId, taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe, readChargeFromStripe } from "./fixtures/marie.mjs";
import { seedCustomer, seedWorkshopSession, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * Atelier: 50 % acompte online, cancelled by the salon with an exceptional
 * refund, refunded by hand in Stripe.
 *
 * This is the flow the refund rebuild was written for, end to end:
 *
 *   1. A customer books and pays a 50 % acompte through Stripe Checkout.
 *   2. checkout.session.completed fulfils the reservation.
 *   3. An admin cancels it from the dashboard, ticking "rembourser à titre
 *      exceptionnel" — which must queue a debt, NOT call Stripe.
 *   4. Marie refunds it by hand (the fixture plays her).
 *   5. charge.refunded settles the leg and closes the operation.
 *
 * The assertions that matter are not "the dialog closed". They are: exactly
 * the acompte was queued (never the full catalogue price), no money moved
 * until Marie moved it, and the ledger balances at every step.
 */

const ACOMPTE_PERCENTAGE = 50;
const ACTIVITY_PRICE = 80;
const EXPECTED_ACOMPTE = money((ACTIVITY_PRICE * ACOMPTE_PERCENTAGE) / 100); // 40,00 €

test.describe("atelier — acompte paid online, refunded by hand", () => {
  let customer;
  let workshop;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "atelier" });
    workshop = await seedWorkshopSession({
      price: ACTIVITY_PRICE,
      depositPercentage: ACOMPTE_PERCENTAGE,
    });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the acompte is queued for manual refund, never refunded by the app", async ({ page }) => {
    const runId = getRunId();

    // ── 1. The customer books and pays the acompte ────────────────────────
    await loginAs(page, customerCredentials(customer));
    // Query params are `activity`/`session` — app/(public)/reservation-atelier/page.js:60-61 —
    // not the more obvious `activityId`/`sessionId`.
    await page.goto(`/reservation-atelier?activity=${workshop.activity.id}&session=${workshop.session.id}`);

    // The cookie banner overlaps the CGV checkbox at the bottom of the form.
    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    // "Payer un acompte" is selected by default (see the screenshot taken
    // while wiring this test) — only the CGV checkbox and the submit button
    // are left to drive.
    //
    // Not getByRole("checkbox", { name }): the label wraps the checkbox
    // alongside a <span> containing two nested <a> links
    // (app/(public)/reservation-atelier/page.js:797-813), and Chromium's
    // accessible-name computation for a labelled control does not fold in
    // descendant-link text the way a naive read of the visible label would
    // suggest — the role query never matches. Scoping to the label's own
    // checkbox sidesteps the whole question.
    await page
      .locator("label", { hasText: /j'ai lu et j'accepte/i })
      .locator('input[type="checkbox"]')
      .check();
    await page.getByRole("button", { name: /payer l'acompte de/i }).click();
    // success_url is set in actions/workshops/create-workshop-reservation.js:133 —
    // our own page, never an intermediate Stripe URL (see payAndReturn's
    // doc comment for why that distinction is load-bearing here).
    await payAndReturn(page, /\/reservation-atelier\/succes/);

    // The redirect back proves only that Stripe redirected. The reservation
    // exists when the webhook says so, which is a separate event entirely.
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

    // Exactly the acompte was taken — not the full 80 €.
    let summary = await assertLedgerSound(paymentId, { expectHeld: EXPECTED_ACOMPTE });
    expect(summary.collected).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(summary.collectedByMethod.ONLINE).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(reservation.status).toBe("CONFIRMED");

    // ── 2. The admin cancels with an exceptional refund ───────────────────
    await loginAsAdmin(page);
    await page.goto("/dashboard/workshops/reservations");

    const reason = taggedReason("Atelier annulé par le salon — test e2e");

    // Narrow to this run's one row before doing anything else — with a
    // shared dev database, other reservations are always present.
    await page.getByPlaceholder(/rechercher une réservation/i).fill(runId);
    const row = page.locator("tbody tr", { hasText: workshop.activity.title });
    await expect(row).toHaveCount(1);

    // The cancel action sits inside a per-row "…" menu
    // (components/dashboard/Tables/RowActions.jsx), not a plain visible
    // button — it opens a role="menu" whose delete entry reads "Supprimer",
    // never "Annuler".
    await row.getByRole("button", { name: /row actions/i }).click();
    await page.getByRole("menuitem", { name: /supprimer/i }).click();

    // components/dashboard/workshops/CancelReservationDialog.jsx
    await page.getByRole("checkbox", { name: /rembourser/i }).check();
    await page.getByRole("textbox").fill(reason);
    await page.getByRole("button", { name: /confirmer l'annulation/i }).click();

    // ── 3. A debt is recorded. No money has moved. ────────────────────────
    const operation = await waitFor(
      async () => {
        const row = await prisma.refundOperation.findFirst({
          where: { paymentId },
          include: { legs: true, creditNote: true },
        });
        return row?.legs?.length ? row : null;
      },
      { what: "a RefundOperation to be opened for the cancelled atelier" },
    );

    expect(Number(operation.totalAmount)).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(operation.status).toBe("PENDING");
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("ONLINE");
    expect(Number(operation.legs[0].amount)).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(operation.legs[0].status).toBe("PENDING");

    // The single most important assertion in this file: the application must
    // not have refunded anything. Marie has not touched Stripe yet, so the
    // charge must still be intact and the ledger must still hold the acompte.
    const stripeState = await readChargeFromStripe(operation.legs[0].stripePaymentIntentId);
    expect(stripeState.amountRefunded).toBe(0);
    await assertLedgerSound(paymentId, { expectHeld: EXPECTED_ACOMPTE });

    // And the customer has not been told a refund arrived.
    expect(operation.customerNotifiedAt).toBeNull();

    // The debt is on the worklist, for the exact amount, not the full price.
    await page.goto("/dashboard/operations");
    const worklist = page.getByRole("region", { name: /remboursements dus/i }).or(
      page.locator("section", { hasText: /remboursements dus/i }),
    );
    await expect(worklist.first()).toContainText("40,00");

    // ── 4. Marie refunds by hand, and only then does it settle ────────────
    await refundInStripe({
      paymentIntentId: operation.legs[0].stripePaymentIntentId,
      amount: EXPECTED_ACOMPTE,
    });

    const settled = await waitFor(
      async () => {
        const row = await prisma.refundOperation.findUnique({
          where: { id: operation.id },
          include: { legs: true },
        });
        return row?.legs?.every((leg) => leg.status === "SUCCEEDED") ? row : null;
      },
      { what: "charge.refunded to settle the atelier refund leg" },
    );

    expect(settled.status).toBe("COMPLETED");
    // settledAmount stays null when the refund matched the plan exactly —
    // a non-null value means a shortfall or an over-refund.
    expect(settled.legs[0].settledAmount).toBeNull();
    expect(settled.legs[0].failureReason).toBeNull();

    // ── 5. The books balance, and nothing is owed ─────────────────────────
    summary = await assertLedgerSound(paymentId, { expectHeld: 0 });
    expect(summary.refunded).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(summary.refundedByMethod.ONLINE).toBeCloseTo(EXPECTED_ACOMPTE, 2);
    expect(summary.status).toBe("REFUNDED");

    // Now, and only now, the customer is told.
    await waitFor(
      async () => {
        const row = await prisma.refundOperation.findUnique({ where: { id: operation.id } });
        return row?.customerNotifiedAt ? row : null;
      },
      { what: "the customer to be notified once the refund actually landed" },
    );

    // The seat went back on sale — a full refund releases capacity.
    const cancelled = await prisma.workshopReservation.findUnique({ where: { id: reservation.id } });
    expect(cancelled.status).toBe("CANCELLED");

    // Issuing a real credit note into the real counters must not leave a hole.
    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);
  });
});
