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

/**
 * The public booking flow, up to and including payment.
 *
 * `full: true` picks "Payer le montant total" instead of the default
 * acompte. That choice decides whether any salon paperwork exists at all:
 * fulfil-formation-reservation-payment.js issues the ticket and the invoice
 * only `if (isFullPayment && !independentSale)`, because a deposit leaves a
 * balance to settle in-salon. A deposit-paying test therefore sees a null
 * ticket whoever the payee is, and cannot tell the two apart.
 */
async function bookAndPay(page, { formation, session }, { full = false } = {}) {
  await page.goto(`/reservation-formation?formation=${formation.id}&session=${session.id}`);

  const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
  if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

  // This page renders a spinner until two server actions have answered
  // (getPublicFormationById + checkFormationSessionAvailability), and the
  // first navigation to the route on a dev server compiles it first. That is
  // routinely longer than the 20s `actionTimeout`, so a bare fill() aborts
  // with nothing to go on but "waiting for locator('#formation-phone')".
  //
  // The page's other settled states are no easier to read from that: an
  // unknown formation or session renders "Session non disponible", which has
  // no phone field either and never will, so waiting longer cannot help. Wait
  // deliberately, then report what the page actually settled on.
  const phone = page.locator("#formation-phone");
  try {
    await phone.waitFor({ state: "visible", timeout: 90_000 });
  } catch (cause) {
    const seen = await page
      .locator("body")
      .innerText()
      .catch(() => "(could not read the page)");
    throw new Error(
      `The formation booking form never appeared for session ${session.id}.
` +
        `URL: ${page.url()}
--- page text ---
${seen.slice(0, 600)}`,
      { cause },
    );
  }

  await phone.fill(`04${String(Date.now()).slice(-8)}`);
  await page
    .locator("label", { hasText: /j'ai lu et j'accepte/i })
    .locator('input[type="checkbox"]')
    .check();
  // Two different controls share almost the same words, and neither can be
  // matched by an obvious name regex:
  //   the mode selector is a button of two spans, so its accessible name is
  //   "Payer le montant total 120,00 €" — an anchored /^…total$/ never matches;
  //   the submit button reads "Payer le montant total de 120,00 €", which any
  //   unanchored /payer le montant total/ would ALSO match, picking the wrong
  //   one and submitting before the mode was ever chosen.
  // So the selector is structural: only the mode button has a child whose text
  // is exactly the label.
  if (full) {
    await page
      .getByRole("button")
      .filter({ has: page.getByText("Payer le montant total", { exact: true }) })
      .click();
  }
  await page
    .getByRole("button", { name: full ? /payer le montant total de/i : /payer l'acompte de/i })
    .click();
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
    await bookAndPay(page, hers, { full: true });
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
    expect(charge.amount).toBeCloseTo(PRICE, 2);
    // No application fee: she receives 100%, the salon's cut is settled off
    // Stripe through her contract — the same rule appointments already follow.
    expect(charge.applicationFee).toBeNull();

    // ── The platform issues no document for a sale that is not its own ────
    // Paid in full, which is what makes this assertion mean anything: the
    // salon's own full payment DOES take a ticket (the case below proves it),
    // so a null one here is the payee gate working, not the deposit rule.
    expect(payment.ticketNumber).toBeNull();
    expect(payment.ticketKind).toBeNull();
    const invoice = await prisma.invoice.findFirst({ where: { paymentId: payment.id } });
    expect(invoice).toBeNull();
  });

  test("a seat animated by the salon still lands on the platform account, unchanged", async ({ page }) => {
    // The regression guard. Everything above must not leak into the ordinary
    // case, which is still every upcoming session in production.
    await loginAs(page, customerCredentials(customer));
    await bookAndPay(page, salons, { full: true });
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await confirmedReservation(salons.session.id);
    const payment = reservation.payment;

    expect(payment.payeeStaffId).toBeNull();
    const intentId = payment.transactions[0].stripePaymentIntentId;
    // Null account = the platform. This resolves only because the charge is
    // there.
    const charge = await readChargeFromStripe(intentId, null);
    expect(charge.amount).toBeCloseTo(PRICE, 2);

    // The salon's own sale keeps the salon's paperwork — the control for the
    // null ticket asserted on her seat above. Both book the same formation at
    // the same price and pay the same way; the only difference is the payee.
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
    await bookAndPay(page, unready);

    // PAYEE_ONLINE_UNAVAILABLE_MESSAGE (lib/payments/resolve-payee.js). Matched
    // on "encore", which is the half that distinguishes it: the salon's own
    // "Le paiement en ligne n'est pas disponible pour le moment" means the
    // SALON's legal identity is incomplete — a different refusal, for a
    // different payee, that this test would otherwise happily accept.
    await expect(page.getByText(/pas encore disponible pour cette animatrice/i)).toBeVisible({ timeout: 20_000 });
    // Never reached Stripe.
    await expect(page).not.toHaveURL(/checkout\.stripe\.com/);

    // And left no seat held behind. This is not a detail: the refusal used to
    // happen only in createFormationReservationCheckoutSession, which runs
    // AFTER the hold has been written, so every visitor who tried ate a place
    // for 24 h and nobody could ever pay for it. A session animated by an
    // independent who has not finished onboarding would silently fill up.
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
    await bookAndPay(page, hers);
    // Same budget as expectOnStripeCheckout: what happens before this is a
    // server action that calls Stripe to create the Checkout Session, and
    // that has been measured at 46s from this machine.
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 90_000 });

    const hold = await waitFor(
      async () =>
        prisma.formationReservation.findFirst({
          where: { sessionId: hers.session.id, status: "PENDING_DEPOSIT" },
        }),
      { what: `an unpaid hold on session ${hers.session.id}` },
    );

    // Abandon the checkout, then relance from the dashboard. (The reservations
    // list is its own route — /dashboard/formations is the catalogue, and a
    // `?tab=` it does not read just renders that instead, with no rows and no
    // relance button on it at all.)
    await loginAsAdmin(page);
    await page.goto("/dashboard/formations/reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole("button", { name: /relancer le paiement/i }).click();

    // "Lien de paiement renvoyé au client par e-mail. La place est réservée 24 h."
    await expect(page.getByText(/lien de paiement renvoyé/i)).toBeVisible({ timeout: 30_000 });

    // The seat is back on hold for the new link's lifetime...
    const relaunched = await waitFor(
      async () => {
        const row = await prisma.formationReservation.findUnique({ where: { id: hold.id } });
        return row?.status === "PENDING_DEPOSIT" && row.holdExpiresAt > hold.holdExpiresAt ? row : null;
      },
      { what: `reservation ${hold.id} to be put back on hold by the relance` },
    );
    // The booking's own hold is 15 minutes; a relance re-holds for 24 h
    // (RELANCE_HOLD_TTL_MS), so the new link outlives the expiry sweep.
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
    await bookAndPay(page, hers);
    await payAndReturn(page, /\/reservation-formation\/succes/);
    await confirmedReservation(hers.session.id);

    await loginAsAdmin(page);
    await page.goto("/dashboard/formations/reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });

    // The transfer is behind the row's overflow menu and is labelled
    // "Modifier" — there is no "Transférer" control anywhere. Same shape as
    // the cancellation in formation-non-refundable.spec.mjs: role=menuitem,
    // not button, because RowActions sets it explicitly.
    await row.getByRole("button", { name: /row actions/i }).click();
    await page.getByRole("menuitem", { name: /^modifier$/i }).click();

    // ChangeSessionModal is a plain overlay, not role="dialog", so it is
    // located by its own ids rather than by role.
    const target = page.locator("#formation-transfer-session");
    await expect(target).toBeVisible({ timeout: 20_000 });

    // Selected by session id, not by option text: the label Playwright would
    // have to match is built from the title, date, seats and price, and
    // `selectOption({ label })` is an exact string match — a RegExp there
    // silently matches nothing.
    //
    // The options span every future published formation session, not just
    // this formation's, so the salon's seeded session is a legitimate choice
    // here. That is precisely why the payee check has to exist.
    await target.selectOption(salons.session.id);
    await page.locator("#formation-transfer-reason").fill("Test e2e : transfert vers une séance d'un autre bénéficiaire.");
    await page.getByRole("button", { name: /confirmer le transfert sans frais/i }).click();

    // TRANSFER_PAYEE_MISMATCH, surfaced as a toast rather than inside the modal.
    await expect(page.getByText(/animée par une autre personne/i)).toBeVisible({ timeout: 20_000 });

    // Still on her session, still hers.
    const after = await prisma.formationReservation.findFirst({
      where: { sessionId: hers.session.id, status: "CONFIRMED" },
      include: { payment: true },
    });
    expect(after).not.toBeNull();
    expect(after.payment.payeeStaffId).toBe(hers.staff.id);
  });
});
