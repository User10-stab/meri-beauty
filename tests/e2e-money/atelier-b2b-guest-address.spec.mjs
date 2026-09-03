import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { loginAs } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { seedWorkshopSession, seedCustomer, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * F1 regression: a customer with no billing address on file, paying in full
 * while supplying a VAT number, used to have no way to supply one —
 * create-workshop-reservation.js never asked for it. Two ways an account
 * ends up in that state: a brand-new guest checkout (registration has
 * required an address for a while — lib/validations/register.js — but guest
 * checkout bypasses registration entirely), or an older account that
 * predates the mandatory-address field (see the User.addressLine1 field
 * comment in schema.prisma). This test exercises the second, seeding the
 * account directly rather than driving a brand-new guest through its own
 * email-verification detour — the server-side gate it triggers
 * (`if (vatNumberToSave && !user.addressLine1)` in create-workshop
 * -reservation.js) is identical either way.
 *
 * Why it mattered: a full-price payment invoices immediately
 * (lib/workshops/fulfill-workshop-reservation-payment.js), and only when the
 * customer is VAT-invoiceable (hasInvoiceableVatIdentity) — a B2C customer
 * never hits this at all. issueInvoice's assertBuyerLegalDataComplete
 * (lib/invoicing.js) throws BUYER_LEGAL_DATA_INCOMPLETE without an address,
 * and that throw sat inside the same $transaction as the Payment/Transaction
 * writes — so the whole fulfilment rolled back. Stripe had already captured
 * the card; the app recorded nothing at all, and the checkout.session.completed
 * webhook retried into the exact same wall every time.
 *
 * The fix collects the address on the booking form itself, gated on the
 * customer verifying a VAT number (mirroring the invoicing gate exactly), and
 * persists it before the reservation is created.
 *
 * This test proves the whole pipe survives: real VIES bypass (VAT_SKIP_VIES_
 * VERIFICATION=true locally), real Stripe Checkout, real webhook fulfilment —
 * and that a Payment + Invoice actually exist afterward, rather than the
 * silent void the bug used to leave behind.
 */

const ACTIVITY_PRICE = 120;
// Belgian VAT numbers carry a real mod-97 checksum (lib/vat-validation.js —
// isValidVatFormat/isValidBelgianChecksum): base "01234567" mod 97 = 48, so
// the check digits must be 97-48 = 49. Well-formed but not a real registered
// company — exactly what VAT_SKIP_VIES_VERIFICATION=true (set in .env for
// local dev) exists to let through without a live VIES registry call.
const TEST_VAT_NUMBER = "BE0123456749";

test.describe("atelier — B2B booking with no address on file", () => {
  let workshop;
  let customer;

  test.beforeAll(async () => {
    // depositPercentage is irrelevant here — the FULL payment button is used,
    // not the acompte one — but 0% keeps the on-screen numbers unambiguous.
    workshop = await seedWorkshopSession({ price: ACTIVITY_PRICE, depositPercentage: 0 });
    // No digits in the label: it flows straight into fullName
    // ("Client Test Automatise <label>"), and fullNameSchema
    // (lib/validations/customer-identity.js) rejects any digit outright —
    // "b2b" itself would have tripped it here.
    customer = await seedCustomer({ label: "business-no-address", withAddress: false });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("a VAT number triggers the address prompt, and the reservation is fulfilled with an invoice", async ({ page }) => {
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/reservation-atelier?activity=${workshop.activity.id}&session=${workshop.session.id}`);

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    // Full payment, not the acompte — this is what invoices immediately and
    // is where the bug lived.
    await page.getByRole("button", { name: /payer le montant total/i }).click();

    await page.locator("#workshop-phone").fill(`04${String(Date.now()).slice(-8)}`);

    // Before verifying VAT: the address block must not be here yet — a
    // signed-in customer with no VAT number is a B2C-shaped sale.
    await expect(page.getByPlaceholder("Rue et numéro *")).toHaveCount(0);

    await page.getByPlaceholder(/BE0123456789/i).fill(TEST_VAT_NUMBER);
    await page.getByRole("button", { name: /vérifier/i }).click();

    // VAT_SKIP_VIES_VERIFICATION=true locally (see lib/vat-validation.js —
    // isViesBypassEnabled) accepts any well-formed number without a real
    // registry round trip, so this resolves fast — but it is still a server
    // action, hence the generous expect timeout from playwright.money.config.
    //
    // A signed-in customer's freshly-verified VAT number flips hasSavedVatProof
    // true on the same render, replacing the "Actif — ..." message paragraph
    // with the persisted "TVA ... vérifiée" badge (app/(public)/reservation
    // -atelier/page.js) — a guest (no account to persist onto) would still be
    // showing the message instead.
    await expect(page.getByText(/vérifiée/i)).toBeVisible();

    // Now that this books as a B2B sale, the address block must appear and
    // be required.
    const addressLine1 = page.getByPlaceholder("Rue et numéro *");
    await expect(addressLine1).toBeVisible();
    await addressLine1.fill("Avenue de la Facture 42");
    await page.getByPlaceholder("Code postal *").fill("4000");
    await page.getByPlaceholder("Ville *").fill("Liège");

    await page
      .locator("label", { hasText: /j'ai lu et j'accepte/i })
      .locator('input[type="checkbox"]')
      .check();

    await page.getByRole("button", { name: /payer le montant total de/i }).click();
    await payAndReturn(page, /\/reservation-atelier\/succes/);

    // The regression this guards against: without the fix, nothing below
    // this line would ever exist — the fulfilment transaction rolled back on
    // BUYER_LEGAL_DATA_INCOMPLETE and Stripe held a payment the app never
    // recorded.
    const reservation = await waitFor(
      async () => {
        const row = await prisma.workshopReservation.findFirst({
          where: { sessionId: workshop.session.id, customerId: customer.id },
          include: { payment: { include: { transactions: true, invoice: true } }, customer: true },
        });
        return row?.payment?.transactions?.length ? row : null;
      },
      { what: `the B2B atelier reservation for session ${workshop.session.id} to be fulfilled` },
    );

    expect(reservation.status).toBe("CONFIRMED");
    expect(reservation.payment.status).toBe("PAID");
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(ACTIVITY_PRICE, 2);

    // The actual point of the fix: full payment + VAT number issues an
    // invoice, which requires the address that was just collected.
    expect(reservation.payment.invoice).not.toBeNull();
    expect(Number(reservation.payment.invoice.totalInclVat)).toBeCloseTo(ACTIVITY_PRICE, 2);

    // The address was persisted onto the account, not just used once and
    // discarded — so it never hits this gate again on a later booking,
    // cancellation-with-forfeit, or in-salon settlement.
    expect(reservation.customer.addressLine1).toBe("Avenue de la Facture 42");
    expect(reservation.customer.addressCity).toBe("Liège");
    expect(reservation.customer.addressPostalCode).toBe("4000");
    expect(reservation.customer.isCompany).toBe(true);
    expect(reservation.customer.vatNumber).toBe(TEST_VAT_NUMBER);
  });
});
