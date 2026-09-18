import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { readChargeFromStripe } from "./fixtures/marie.mjs";
import {
  seedCustomer,
  seedFormationSession,
  seedConnectFormationSession,
  seedUnreadyIndependentFormationSession,
  customerCredentials,
} from "./fixtures/seed-money.mjs";

/**
 * Formations: whose Stripe account the money lands on.
 *
 * Until now an activity was always a charge on the *platform* account, and
 * every atelier/formation spec here asserts that world. A seat animated by an
 * independent is now a Connect **direct charge on her own account**, which
 * changes the same set of code paths a rendez-vous already exercises (see
 * rendez-vous-connect-refund.spec.mjs) — plus several that only activities
 * have: the seat hold, the shared checkout builder, and "Relancer le
 * paiement".
 *
 * Nothing here can be proved by the existing specs. They book salon-animated
 * activities, so they would keep passing with the routing entirely broken: no
 * event they produce ever carries a connected account at all.
 *
 * The payee is decided once, from the session's animator, and frozen into the
 * Checkout Session's metadata — never re-derived later from whoever happens to
 * be animating or clicking. Each test below pins one consequence of that.
 */

const PRICE = 120;
const DEPOSIT_PERCENTAGE = 50;
const DEPOSIT = (PRICE * DEPOSIT_PERCENTAGE) / 100;

/** The public booking flow, up to and including payment. */
async function bookAndPayDeposit(page, { formation, session }) {
  await page.goto(`/reservation-formation?formation=${formation.id}&session=${session.id}`);

  const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
  if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

  await page.locator("#formation-phone").fill(`04${String(Date.now()).slice(-8)}`);
  await page
    .locator("label", { hasText: /j'ai lu et j'accepte/i })
    .locator('input[type="checkbox"]')
    .check();
  await page.getByRole("button", { name: /payer l'acompte de/i }).click();
}

/** The one reservation for this session, once the webhook has confirmed it. */
function confirmedReservation(sessionId) {
  return waitFor(
    async () => {
      const row = await prisma.formationReservation.findFirst({
        where: { sessionId, status: "CONFIRMED" },
        include: { payment: { include: { transactions: true } } },
      });
      return row?.payment?.transactions?.length ? row : null;
    },
    { what: `the formation reservation on session ${sessionId} to be confirmed` },
  );
}

test.describe("formation — charged to the animator's own Stripe account", () => {
  let customer;
  let hers;
  let salons;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "connect-formation" });
    hers = await seedConnectFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
    salons = await seedFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("her seat is charged on her account, and the salon issues nothing for it", async ({ page }) => {
    await loginAs(page, customerCredentials(customer));
    await bookAndPayDeposit(page, hers);
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await confirmedReservation(hers.session.id);
    const payment = reservation.payment;

    // ── The money is hers, and the app recorded where it actually landed ──
    expect(payment.payeeStaffId).toBe(hers.staff.id);
    expect(payment.stripeAccountId).toBe(hers.staff.stripeAccountId);

    // The charge exists on HER account. Reading it from the platform would
    // throw "No such payment_intent", which is exactly the failure mode that
    // makes routing bugs invisible to every other spec here.
    const intentId = payment.transactions[0].stripePaymentIntentId;
    const charge = await readChargeFromStripe(intentId, hers.staff.stripeAccountId);
    // readChargeFromStripe answers in euros, not cents.
    expect(charge.amount).toBeCloseTo(DEPOSIT, 2);
    // No application fee: she receives 100%, the salon's cut is settled off
    // Stripe through her contract — the same rule appointments already follow.
    expect(charge.applicationFee).toBeNull();

    // ── The platform issues no document for a sale that is not its own ────
    expect(payment.ticketNumber).toBeNull();
    expect(payment.ticketKind).toBeNull();
    const invoice = await prisma.invoice.findFirst({ where: { paymentId: payment.id } });
    expect(invoice).toBeNull();
  });

  test("a seat animated by the salon still lands on the platform account, unchanged", async ({ page }) => {
    // The regression guard. Everything above must not leak into the ordinary
    // case, which is still every upcoming session in production.
    await loginAs(page, customerCredentials(customer));
    await bookAndPayDeposit(page, salons);
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await confirmedReservation(salons.session.id);
    const payment = reservation.payment;

    expect(payment.payeeStaffId).toBeNull();
    const intentId = payment.transactions[0].stripePaymentIntentId;
    // Null account = the platform. This resolves only because the charge is
    // there.
    const charge = await readChargeFromStripe(intentId, null);
    expect(charge.amount).toBeCloseTo(DEPOSIT, 2);

    // The salon's own sale keeps the salon's paperwork.
    expect(payment.ticketNumber).not.toBeNull();
    expect(payment.ticketKind).toBe("FORMATION");
  });
});

test.describe("formation — an animator whose Stripe account is not ready", () => {
  let customer;
  let unready;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "connect-unready" });
    unready = await seedUnreadyIndependentFormationSession();
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the booking is refused instead of quietly charging the salon", async ({ page }) => {
    // The decision (18/09/2026) is to refuse, exactly as an appointment with
    // an un-onboarded practitioner already does. The dangerous alternative is
    // a silent fallback: the client pays, the salon banks money that is not
    // its own, and nobody finds out until the books are reconciled.
    await loginAs(page, customerCredentials(customer));
    await bookAndPayDeposit(page, unready);

    await expect(page.getByText(/paiement en ligne n'est pas disponible/i)).toBeVisible({ timeout: 15_000 });
    // Never reached Stripe.
    await expect(page).not.toHaveURL(/checkout\.stripe\.com/);

    // And left no seat held behind: an unpayable hold would block the place
    // until the sweep expires it.
    const held = await prisma.formationReservation.count({
      where: { sessionId: unready.session.id, status: "PENDING_DEPOSIT" },
    });
    expect(held).toBe(0);
  });
});

test.describe("formation — relancer le paiement stays on the animator's account", () => {
  let customer;
  let hers;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "connect-relance" });
    hers = await seedConnectFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("the old link is closed and the new one created on her account", async ({ page }) => {
    // The bug this pins: the two booking actions used to build their Stripe
    // params inline, so only they knew about the payee. The relance went
    // through the shared builder and hit the PLATFORM — where none of her
    // sessions are visible. It found no earlier link, closed nothing, and
    // handed the client a SECOND payable link on the wrong account.
    await loginAs(page, customerCredentials(customer));
    await bookAndPayDeposit(page, hers);
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

    const hold = await waitFor(
      async () =>
        prisma.formationReservation.findFirst({
          where: { sessionId: hers.session.id, status: "PENDING_DEPOSIT" },
        }),
      { what: `an unpaid hold on session ${hers.session.id}` },
    );

    // Abandon the checkout, then relance from the dashboard.
    await page.goto("/dashboard/formations?tab=reservations");
    await loginAsAdmin(page);
    await page.goto("/dashboard/formations?tab=reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole("button", { name: /relancer le paiement/i }).click();

    await expect(page.getByText(/lien de paiement renvoyé/i)).toBeVisible({ timeout: 20_000 });

    // The seat is back on hold for the new link's lifetime...
    const relaunched = await waitFor(
      async () => {
        const row = await prisma.formationReservation.findUnique({ where: { id: hold.id } });
        return row?.status === "PENDING_DEPOSIT" && row.holdExpiresAt > hold.holdExpiresAt ? row : null;
      },
      { what: `reservation ${hold.id} to be put back on hold by the relance` },
    );
    expect(relaunched.holdExpiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 60 * 60 * 1000);

    // ...and every link for it lives on HER account, with exactly one payable.
    const stripe = (await import("stripe")).default;
    const client = new stripe(process.env.STRIPE_SECRET_KEY);
    const sessions = await client.checkout.sessions.list(
      { limit: 100 },
      { stripeAccount: hers.staff.stripeAccountId },
    );
    const mine = sessions.data.filter((s) => s.metadata?.reservationId === hold.id);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.filter((s) => s.status === "open")).toHaveLength(1);
    for (const s of mine) expect(s.metadata.payeeStaffId).toBe(hers.staff.id);
  });
});

test.describe("formation — money never follows a seat to another account", () => {
  let customer;
  let hers;
  let salons;

  test.beforeAll(async () => {
    customer = await seedCustomer({ label: "connect-transfer" });
    hers = await seedConnectFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
    salons = await seedFormationSession({ price: PRICE, depositPercentage: DEPOSIT_PERCENTAGE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("a paid seat cannot be transferred to a session with a different payee", async ({ page }) => {
    // Transferring would leave a Payment owned by one party while the seat it
    // pays for is delivered by another, and the money sitting in a third
    // place. There is no correct way to settle that, so it is refused.
    await loginAs(page, customerCredentials(customer));
    await bookAndPayDeposit(page, hers);
    await payAndReturn(page, /\/reservation-formation\/succes/);
    await confirmedReservation(hers.session.id);

    await loginAsAdmin(page);
    await page.goto("/dashboard/formations?tab=reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await row.getByRole("button", { name: /transférer/i }).click();

    const dialog = page.getByRole("dialog", { name: /transférer/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").selectOption({ label: new RegExp(salons.formation.title, "i") });
    await dialog.getByRole("button", { name: /confirmer/i }).click();

    await expect(dialog.getByText(/bénéficiaire|propriétaire|impossible/i)).toBeVisible({ timeout: 15_000 });

    // Still on her session, still hers.
    const after = await prisma.formationReservation.findFirst({
      where: { sessionId: hers.session.id, status: "CONFIRMED" },
      include: { payment: true },
    });
    expect(after).not.toBeNull();
    expect(after.payment.payeeStaffId).toBe(hers.staff.id);
  });
});
