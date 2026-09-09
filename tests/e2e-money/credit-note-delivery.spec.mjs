import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound, assertNumberingContiguous } from "./fixtures/ledger.mjs";
import { taggedReason } from "./fixtures/run-id.mjs";
import { loginAs, loginAsAdmin } from "./fixtures/auth.mjs";
import { payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { refundInStripe } from "./fixtures/marie.mjs";
import { requireMailpit, waitForEmail } from "./fixtures/mailpit.mjs";
import { seedCustomer, seedWorkshopSession, customerCredentials } from "./fixtures/seed-money.mjs";

/**
 * A credit note is a legal document, and issuing it is only half the job.
 *
 * Everything about credit notes was covered up to the moment they exist:
 * three scenarios issue them, and `assertNumberingContiguous` guards the
 * gapless series. Nothing checked that one ever reaches the customer — and a
 * credit note that stays in the database corrects the salon's books while
 * leaving the buyer's untouched, which for a B2B customer is the half that
 * matters. They cannot reclaim the VAT on a document they were never sent.
 *
 * It has to be a B2B booking. A credit note reverses an invoice, an invoice
 * is only issued to a buyer with a validated VAT number
 * (`hasInvoiceableVatIdentity`), and a particulier therefore has neither.
 * That asymmetry is also the root of B6 — see E2E_FINDINGS.md — and it is
 * why the three existing refund scenarios, all B2C, could assert numbering
 * contiguity as a no-op and never notice.
 *
 * The delivery assertion reads Mailpit rather than the `emailSentAt` column.
 * The column records what the application *believed*; `sendEmail` resolves
 * `{ success: false }` on a provider failure instead of throwing, so the two
 * can disagree, and it is the mailbox that decides whether the customer was
 * actually served.
 */

const ACTIVITY_PRICE = 70;
// Real mod-97 checksum. VAT_SKIP_VIES_VERIFICATION=true accepts a well-formed
// number without a registry round trip, but the checksum is computed locally
// and a made-up number is rejected before that ever matters.
const TEST_VAT_NUMBER = "BE0123456749";

test.describe("a credit note reaches the customer, not just the database", () => {
  let customer;
  let workshop;

  test.beforeAll(async () => {
    await requireMailpit();
    customer = await seedCustomer({ label: "creditnote", withAddress: false });
    workshop = await seedWorkshopSession({ price: ACTIVITY_PRICE });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("cancelling a B2B booking issues a credit note and sends it with its PDF", async ({ page }) => {
    // ── 1. A B2B customer books and pays in full ──────────────────────────
    await loginAs(page, customerCredentials(customer));
    await page.goto(`/reservation-atelier?activity=${workshop.activity.id}&session=${workshop.session.id}`);

    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

    await page.getByRole("button", { name: /payer le montant total/i }).click();
    await page.locator("#workshop-phone").fill(`04${String(Date.now()).slice(-8)}`);

    await page.getByPlaceholder(/BE0123456789/i).fill(TEST_VAT_NUMBER);
    await page.getByRole("button", { name: /vérifier/i }).click();
    await expect(page.getByText(/vérifiée/i)).toBeVisible();

    // Required only now that this is a B2B sale — an invoice cannot be issued
    // without a legal address (assertBuyerLegalDataComplete).
    await page.getByPlaceholder("Rue et numéro *").fill("Avenue de la Note 7");
    await page.getByPlaceholder("Code postal *").fill("4000");
    await page.getByPlaceholder("Ville *").fill("Liège");

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
          include: { payment: { include: { transactions: true, invoice: true } } },
        });
        // Status and relations in one gate — see T6d.
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: "the B2B atelier reservation to be fulfilled with an invoice" },
    );

    const paymentId = reservation.payment.id;
    const invoice = reservation.payment.invoice;
    expect(invoice, "a VAT-verified full payment must issue an invoice").not.toBeNull();

    await assertLedgerSound(paymentId, { expectHeld: ACTIVITY_PRICE });

    // ── 2. The admin cancels and refunds ──────────────────────────────────
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
    await cancelDialog.locator("#refund-reason").fill(taggedReason("Atelier annulé — test e2e note de crédit"));
    const confirmButton = cancelDialog.getByRole("button", { name: /confirmer l'opération/i });
    await expect(confirmButton).toBeEnabled({ timeout: 10_000 });
    await confirmButton.click();
    await expect(cancelDialog).not.toBeVisible();

    // ── 3. The credit note exists, and belongs to the invoice ─────────────
    const operation = await waitFor(
      async () => {
        const found = await prisma.refundOperation.findFirst({
          where: { paymentId },
          include: { legs: true, creditNote: true },
        });
        return found?.creditNote ? found : null;
      },
      { what: "a credit note to be issued for the cancelled B2B booking" },
    );

    const creditNote = operation.creditNote;
    expect(creditNote.number).toMatch(new RegExp(`^NC${new Date().getFullYear()}-`));
    expect(Number(creditNote.totalInclVat)).toBeCloseTo(ACTIVITY_PRICE, 2);
    expect(creditNote.invoiceId).toBe(invoice.id);
    // Issued, not yet delivered. Sending is a deliberate admin action, not a
    // side effect of cancelling — the same separation the refund itself has.
    expect(creditNote.emailSentAt, "the credit note was sent without anybody choosing to").toBeNull();

    // ── 4. Marie refunds by hand and it settles ───────────────────────────
    await refundInStripe({
      paymentIntentId: operation.legs[0].stripePaymentIntentId,
      amount: ACTIVITY_PRICE,
    });

    await waitFor(
      async () => {
        const found = await prisma.refundOperation.findUnique({
          where: { id: operation.id },
          include: { legs: true },
        });
        return found?.status === "COMPLETED" && found.legs.every((leg) => leg.status === "SUCCEEDED") ? found : null;
      },
      { what: "charge.refunded to settle the leg" },
    );

    const summary = await assertLedgerSound(paymentId, { expectHeld: 0 });
    expect(summary.status).toBe("REFUNDED");

    // ── 5. The admin sends the credit note ────────────────────────────────
    await page.goto("/dashboard/operations?tab=workshops&page=1");
    const settledRow = page
      .getByRole("row")
      .filter({ hasText: workshop.activity.title })
      .filter({ hasText: customer.email });
    await expect(settledRow).toHaveCount(1, { timeout: 15_000 });

    // Deliberately NOT the invoice cell's "Gérer l'envoi" button. That one
    // opens the same dialog with `kind: "INVOICE"` and sends the *invoice* —
    // the first version of this test clicked it and then failed looking for
    // a credit note e-mail, having cheerfully re-sent F-2026-000076 instead.
    //
    // A credit note is offered in two places, both keyed to the refund
    // rather than the sale: this drawer, and the row's documents dialog.
    await settledRow.getByRole("button", { name: /voir\s*\/\s*gérer/i }).click();
    const settledDrawer = page.getByRole("dialog", { name: /détail de la transaction/i });
    await expect(settledDrawer).toBeVisible();

    await settledDrawer.getByRole("button", { name: /envoyer la note de crédit/i }).click();

    // By accessible name ("Envoyer la note de crédit NC2026-…"), not by text
    // content: the drawer behind it is also role="dialog" and also mentions
    // the credit note, so a hasText filter matches both and fails as a strict
    // mode violation rather than as anything to do with delivery.
    const deliveryDialog = page.getByRole("dialog", { name: /envoyer la note de crédit/i });
    await expect(deliveryDialog).toBeVisible({ timeout: 10_000 });

    // The card is now a channel checklist: tick "Envoyer par e-mail" (the
    // client's own copy is on by default), then the shared "Envoyer" button,
    // then confirm. Nothing leaves until that confirmation.
    await deliveryDialog.getByRole("checkbox", { name: /envoyer par e-mail/i }).check();
    await deliveryDialog.getByRole("button", { name: "Envoyer", exact: true }).click();
    await deliveryDialog.getByRole("button", { name: "Envoyer", exact: true }).click();

    // ── 6. The mailbox, not the column ────────────────────────────────────
    //
    // emailSentAt records what the application believed. sendEmail resolves
    // { success: false } on a provider failure rather than throwing, so the
    // column and the mailbox can disagree — and the customer's VAT reclaim
    // depends on the mailbox.
    const email = await waitForEmail({
      to: customer.email,
      subject: new RegExp(creditNote.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      timeout: 45_000,
    });

    const attachments = email.Attachments ?? [];
    expect(attachments.length, "the credit note e-mail carried no attachment").toBeGreaterThan(0);
    const pdf = attachments.find((file) => /\.pdf$/i.test(file.FileName ?? ""));
    expect(pdf, `no PDF among: ${attachments.map((file) => file.FileName).join(", ")}`).toBeTruthy();
    expect(pdf.FileName).toContain(creditNote.number);
    // A zero-byte attachment satisfies "has a PDF" and is useless to a
    // customer, so the size is part of the claim.
    expect(pdf.Size, "the attached credit note PDF is empty").toBeGreaterThan(1_000);

    // Only now may the column be believed.
    await waitFor(
      async () => {
        const found = await prisma.creditNote.findUnique({ where: { id: creditNote.id } });
        return found?.emailSentAt ? found : null;
      },
      { what: "the credit note to be recorded as sent once it actually was" },
    );

    // Issuing a real document into the real counters must leave no hole.
    await assertNumberingContiguous("creditNote", `NC${new Date().getFullYear()}-`);
  });
});
