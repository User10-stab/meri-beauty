import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound } from "./fixtures/ledger.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { readChargeFromStripe } from "./fixtures/marie.mjs";
import { seedCustomer, seedFormationSession, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * Formations: the money policy that is the opposite of every other one here.
 *
 * The whole formations module had no e2e coverage. It is not an atelier with
 * a different label — `PROJECT_REQUIREMENTS.md` §2 records that **the deposit
 * and the balance are both non-refundable regardless of attendance**, and
 * `cancelFormationReservation` implements precisely that: cancelling refunds
 * nothing unless an admin passes `refundPayment` together with a written
 * reason justifying the exception.
 *
 * Every other refund scenario in this suite proves money comes *back*. This
 * one proves it does not, which is a harder thing to be confident about by
 * reading: "no refund" is the absence of behaviour, and absence is exactly
 * what a passing test can accidentally assert for the wrong reason. So the
 * assertions are positive wherever they can be — the payment stays PAID, the
 * collected total is unchanged, Stripe still shows nothing refunded — rather
 * than only "no RefundOperation exists".
 *
 * §4 flags this policy for legal re-check. That is a reason to pin it, not to
 * leave it unpinned: if it changes, somebody should have to change an
 * assertion here and notice what they are changing.
 */

const PRICE = 120;
const DEPOSIT_PERCENTAGE = 50;
const DEPOSIT = (PRICE * DEPOSIT_PERCENTAGE) / 100;

test.describe("formation — cancelled, and the money stays with the salon", () => {
  let customer;
  let formation;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "formation" });
    formation = await seedFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the deposit is not returned when an admin cancels without the exception", async ({ page }) => {
    // ── 1. The customer books and pays the deposit ────────────────────────
    await loginAs(page, customerCredentials(customer));
    await page.goto(
      `/reservation-formation?formation=${formation.formation.id}&session=${formation.session.id}`,
    );

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    // The page states the policy to the customer before they pay. Asserting it
    // here is not decoration: this is the disclosure that makes keeping the
    // money defensible, and it sits on the same screen as the pay button.
    await expect(
      page.getByText(/ne sont remboursables en aucun cas/i),
      "the non-refundable policy was not disclosed before payment",
    ).toBeVisible();

    await page.locator("#formation-phone").fill(`04${String(Date.now()).slice(-8)}`);

    await page
      .locator("label", { hasText: /j'ai lu et j'accepte/i })
      .locator('input[type="checkbox"]')
      .check();

    // "Payer un acompte" is the default mode, so the deposit is what gets
    // charged — the half the policy is most often argued about.
    await page.getByRole("button", { name: /payer l'acompte de/i }).click();
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await waitFor(
      async () => {
        const row = await prisma.formationReservation.findFirst({
          where: { sessionId: formation.session.id, customerId: customer.id },
          include: { payment: { include: { transactions: true, invoice: true } } },
        });
        // Status and relations in one gate (T6d).
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: `the formation reservation for session ${formation.session.id} to be fulfilled` },
    );

    const paymentId = reservation.payment.id;
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(Number(reservation.balanceDue)).toBeCloseTo(PRICE - DEPOSIT, 2);

    const types = reservation.payment.transactions.map((t) => t.transactionType);
    expect(types).toContain("DEPOSIT");

    let summary = await assertLedgerSound(paymentId, { expectHeld: DEPOSIT });
    expect(summary.collected).toBeCloseTo(DEPOSIT, 2);

    const paymentIntentId = reservation.payment.transactions[0]?.stripePaymentIntentId ?? null;

    // ── 2. The admin cancels — without the refund exception ───────────────
    await loginAsAdmin(page);
    await page.goto("/dashboard/formations/reservations");

    const reservationRow = page.getByRole("row").filter({ hasText: customer.email });
    await expect(reservationRow).toHaveCount(1, { timeout: 20_000 });

    // Cancellation lives behind the row's overflow menu, not a visible
    // button: it is an admin-only internal tool (duplicate bookings, a
    // customer who telephoned), never a customer-facing feature, and the
    // component labels the entry "Supprimer" even though it cancels.
    await reservationRow.getByRole("button", { name: /row actions/i }).click();
    // menuitem, not button: RowActions sets an explicit role="menuitem" on
    // each entry, which overrides the implicit button role — so a
    // getByRole("button") never finds it, and the failure reads as "the menu
    // did not open" when it had opened fine.
    await page.getByRole("menuitem", { name: /^supprimer$/i }).click();

    const cancelDialog = page.getByRole("dialog").filter({ hasText: /annuler la réservation/i });
    await expect(cancelDialog).toBeVisible({ timeout: 10_000 });

    // The checkbox is left untouched on purpose. Ticking "Rembourser à titre
    // exceptionnel" is `refundPayment: true` — the admin-discretion exception
    // — and taking it here would test the exception while claiming to test
    // the rule. What is under test is what an ordinary cancellation does.
    await expect(
      cancelDialog.getByText(/ne sera pas remboursé/i),
      "the dialog did not state that the money is kept",
    ).toBeVisible();

    await cancelDialog.getByRole("button", { name: /confirmer l'annulation/i }).click();

    // ── 3. Cancelled, and nothing given back ──────────────────────────────
    const cancelled = await waitFor(
      async () => {
        const row = await prisma.formationReservation.findUnique({
          where: { id: reservation.id },
          include: { payment: { include: { transactions: true } } },
        });
        return row?.status === "CANCELLED" ? row : null;
      },
      { what: "the formation reservation to be cancelled" },
    );

    // Positive assertions first — "no refund" as a set of things that are
    // still true, not merely as a row that does not exist.
    expect(cancelled.payment.status, "a cancelled formation stopped counting as paid").toBe("PAID");
    expect(Number(cancelled.payment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(
      cancelled.payment.transactions.filter((t) => t.transactionType === "REFUND"),
      "a REFUND transaction was written for a non-refundable formation",
    ).toHaveLength(0);

    summary = await assertLedgerSound(paymentId, { expectHeld: DEPOSIT });
    expect(summary.collected).toBeCloseTo(DEPOSIT, 2);
    expect(summary.refunded).toBeCloseTo(0, 2);

    // And only then the absence.
    expect(
      await prisma.refundOperation.count({ where: { paymentId } }),
      "cancelling a formation queued a refund it is not supposed to owe",
    ).toBe(0);

    // Stripe's own view, so this means "nothing was refunded" rather than
    // "our books and our books agree".
    if (paymentIntentId) {
      const stripeState = await readChargeFromStripe(paymentIntentId);
      expect(stripeState.amountRefunded, "Stripe shows a refund the ledger does not").toBe(0);
    }

    // The seat comes back even though the money does not — availability is
    // computed from non-cancelled reservations, which is what lets the
    // waiting list fill the place.
    const stillHeld = await prisma.formationReservation.count({
      where: { sessionId: formation.session.id, status: { in: ["PENDING_DEPOSIT", "CONFIRMED"] } },
    });
    expect(stillHeld, "the cancelled reservation is still holding its seat").toBe(0);
  });
});
