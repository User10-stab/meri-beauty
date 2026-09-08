import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedCustomer, seedWorkshopSession } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin } from "./fixtures/seed-dashboard.mjs";

const PRICE = 25;
const DEPOSIT = 12.5;

// Real mod-97 checksum (same number already used by
// tests/e2e-money/credit-note-delivery.spec.mjs and atelier-b2b-guest-address.spec.mjs)
// — vatValidatedAt is set directly below rather than driven through the VIES
// verification UI, so nothing here needs a live registry round trip. User.vatNumber
// carries no unique constraint, so reusing it across runs/tests is safe.
const B2B_VAT_NUMBER = "BE0123456749";

/**
 * Seeds a CONFIRMED workshop reservation that already carries a real invoice
 * — the one case changeReservationSession must supersede rather than block:
 * a B2B customer who paid the full price upfront at booking (the only path
 * that invoices a still-CONFIRMED reservation — see
 * fulfill-workshop-reservation-payment.js's `isFullPayment` branch). The
 * Payment/Transaction/Invoice rows are hand-built via Prisma, the same way
 * seedAppointmentInvoice (fixtures/seed-dashboard.mjs) hand-builds its
 * invoice instead of driving Stripe — this suite's config has no Stripe
 * listener (see playwright.dashboard.config.mjs's own doc comment). The seed
 * invoice's number is deliberately outside the legal series ("E2E-…", not
 * "F-2026-…") for the same reason seedAppointmentInvoice's is: it never
 * really left the salon's books, so it must not consume a real gapless
 * number. The credit note and replacement invoice the transfer itself
 * issues, further down, are real — that's the app under test actually
 * running, not scaffolding.
 */
async function seedInvoicedB2BReservation({ session, price, runId, label }) {
  const customer = await seedCustomer({ label: `company${label}`, withAddress: true });
  const companyLegalName = `Société Test ${label} ${runId} SRL`;
  await prisma.user.update({
    where: { id: customer.id },
    data: {
      isCompany: true,
      vatNumber: B2B_VAT_NUMBER,
      vatValidatedAt: new Date(),
      vatValidationName: `Nom VIES ${label} ${runId}`,
      vatValidationAddress: "Avenue de la Note 7, 4000 Liège",
    },
  });
  await prisma.billingProfile.create({
    data: { userId: customer.id, companyLegalName, companyRegistrationNo: B2B_VAT_NUMBER },
  });

  const reservation = await prisma.workshopReservation.create({
    data: {
      sessionId: session.id,
      customerId: customer.id,
      seatsCount: 1,
      status: "CONFIRMED",
      depositAmount: 0,
      totalPrice: price,
      balanceDue: 0,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      workshopReservationId: reservation.id,
      depositAmount: 0,
      totalAmount: price,
      paidAmount: price,
      remainingAmount: 0,
      paymentType: "ONLINE",
      status: "PAID",
      paidAt: new Date(),
      transactionReference: `admin-transfer-invoiced-${label}-${runId}`,
    },
  });
  await prisma.transaction.create({
    data: {
      paymentId: payment.id,
      amount: price,
      method: "ONLINE",
      transactionType: "FINAL_PAYMENT",
      paidAt: new Date(),
      stripeCheckoutSessionId: `cs_test_transfer_invoiced_${label}_${runId}`,
      stripePaymentIntentId: `pi_test_transfer_invoiced_${label}_${runId}`,
    },
  });

  // Clean VAT round numbers (121 TTC = 100 HT + 21 TVA) so nothing here is
  // fighting rounding — the point of this seed is the transfer logic, not
  // re-proving calculateVatTotals.
  const invoice = await prisma.invoice.create({
    data: {
      number: `E2E-${runId}-${payment.id.slice(-8)}`,
      source: "WORKSHOP",
      paymentId: payment.id,
      sellerName: "Meri Beauty (e2e)",
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerVatNumber: B2B_VAT_NUMBER,
      customerType: "B2B",
      customerLegalName: companyLegalName,
      subtotalExclVat: (price / 1.21).toFixed(2),
      vatRate: 21,
      vatAmount: (price - price / 1.21).toFixed(2),
      totalInclVat: price,
    },
  });

  return { customer, reservation, payment, invoice, companyLegalName };
}

test.describe("admin transfer between workshop/event sessions", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("moves a deposit reservation from Yule to Mabon for free", async ({ page }) => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const admin = await seedAdmin({ label: "transfer" });
    const customer = await seedCustomer({ label: "transfer" });
    const current = await seedWorkshopSession({ price: PRICE, daysAhead: 45 });
    const target = await seedWorkshopSession({ price: PRICE, daysAhead: 46 });

    await Promise.all([
      prisma.activity.update({
        where: { id: current.activity.id },
        data: { title: `E2E Yule ${runId}` },
      }),
      prisma.activity.update({
        where: { id: target.activity.id },
        data: { title: `E2E Mabon ${runId}`, type: "EVENT" },
      }),
    ]);

    const reservation = await prisma.workshopReservation.create({
      data: {
        sessionId: current.session.id,
        customerId: customer.id,
        seatsCount: 1,
        status: "CONFIRMED",
        depositAmount: DEPOSIT,
        totalPrice: PRICE,
        balanceDue: PRICE - DEPOSIT,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        workshopReservationId: reservation.id,
        depositAmount: DEPOSIT,
        totalAmount: PRICE,
        paidAmount: DEPOSIT,
        remainingAmount: PRICE - DEPOSIT,
        paymentType: "DEPOSIT",
        status: "PARTIALLY_PAID",
        paidAt: new Date(),
        transactionReference: `admin-transfer-${runId}`,
      },
    });
    await prisma.transaction.create({
      data: {
        paymentId: payment.id,
        amount: DEPOSIT,
        method: "ONLINE",
        transactionType: "DEPOSIT",
        paidAt: new Date(),
        stripeCheckoutSessionId: `cs_test_transfer_${runId}`,
        stripePaymentIntentId: `pi_test_transfer_${runId}`,
      },
    });

    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/workshops/reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row, "the seeded reservation is missing from the dashboard").toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();

    await expect(page.getByRole("heading", { name: /modifier la réservation/i })).toBeVisible();
    await expect(page.getByText(/transfert administratif sans frais/i)).toBeVisible();

    const sessionSelect = page.getByLabel(/nouvelle séance/i);
    const targetOption = sessionSelect.locator("option").filter({ hasText: `E2E Mabon ${runId}` });
    const targetSessionId = await targetOption.getAttribute("value");
    expect(targetSessionId).toBe(target.session.id);
    await sessionSelect.selectOption(targetSessionId);

    await expect(page.getByText(/total actuel/i)).toContainText(/25,00/);
    await expect(page.getByText(/total cible/i)).toContainText(/25,00/);
    await expect(page.getByText(/nouveau solde à payer/i)).toContainText(/12,50/);

    const reason = `Cliente inscrite à Yule au lieu de Mabon — ${runId}`;
    await page.getByLabel(/motif obligatoire/i).fill(reason);
    await page.getByRole("button", { name: /confirmer le transfert sans frais/i }).click();
    await expect(page.getByText(/réservation transférée sans frais et e-mail de confirmation envoyé/i)).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        async () => {
          const row = await prisma.workshopReservation.findUnique({
            where: { id: reservation.id },
            select: { sessionId: true, previousSessionId: true },
          });
          return `${row?.sessionId}|${row?.previousSessionId}`;
        },
        { timeout: 30_000 }
      )
      .toBe(`${target.session.id}|${current.session.id}`);

    const [afterReservation, afterPayment, transactions, audit, refundOperations] = await Promise.all([
      prisma.workshopReservation.findUnique({ where: { id: reservation.id } }),
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.transaction.findMany({ where: { paymentId: payment.id, isDeleted: false } }),
      prisma.auditLog.findFirst({
        where: { action: "reservation.session_transferred", entityId: reservation.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.refundOperation.count({ where: { paymentId: payment.id } }),
    ]);

    expect(Number(afterReservation.totalPrice)).toBeCloseTo(PRICE, 2);
    expect(Number(afterReservation.depositAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(Number(afterReservation.balanceDue)).toBeCloseTo(PRICE - DEPOSIT, 2);
    expect(Number(afterReservation.changeFeeAmount)).toBeCloseTo(0, 2);
    expect(Number(afterPayment.totalAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(afterPayment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(Number(afterPayment.remainingAmount)).toBeCloseTo(PRICE - DEPOSIT, 2);
    expect(afterPayment.status).toBe("PARTIALLY_PAID");
    expect(transactions).toHaveLength(1);
    expect(transactions[0].transactionType).toBe("DEPOSIT");
    expect(refundOperations).toBe(0);
    expect(audit).not.toBeNull();
    expect(audit.actorId).toBe(admin.user.id);
    expect(audit.metadata.reason).toBe(reason);
    expect(audit.metadata.modificationFee).toBe(0);
    expect(audit.metadata.automaticRefund).toBe(false);

    await page.goto("/dashboard/operations?tab=transactions");
    const transferRow = page.getByRole("row").filter({ hasText: customer.email }).filter({ hasText: "Transfert de réservation" });
    await expect(transferRow).toBeVisible({ timeout: 30_000 });
    await expect(transferRow).toContainText(`E2E Yule ${runId}`);
    await expect(transferRow).toContainText(`E2E Mabon ${runId}`);
    await expect(transferRow).toContainText("Aucun mouvement financier");
    await expect(transferRow).toContainText(reason);
    await transferRow.getByRole("button", { name: "Voir le détail" }).click();
    const transferDialog = page.getByRole("dialog", { name: "Détail du transfert" });
    await expect(transferDialog).toBeVisible();
    await expect(transferDialog).toContainText("Frais de transfert");
    await expect(transferDialog).toContainText("0,00");
    await expect(transferDialog).toContainText("Aucun encaissement ni remboursement");
  });

  test("supersedes an existing invoice when transferring a fully-paid B2B reservation to a same-priced session", async ({ page }) => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const admin = await seedAdmin({ label: "transfersup" });
    const invoicedPrice = 121;
    const current = await seedWorkshopSession({ price: invoicedPrice, daysAhead: 50 });
    const target = await seedWorkshopSession({ price: invoicedPrice, daysAhead: 51 });

    await Promise.all([
      prisma.activity.update({ where: { id: current.activity.id }, data: { title: `E2E InvCurrent ${runId}` } }),
      prisma.activity.update({ where: { id: target.activity.id }, data: { title: `E2E InvTarget ${runId}` } }),
    ]);

    const { customer, payment, invoice, companyLegalName } = await seedInvoicedB2BReservation({
      session: current.session,
      price: invoicedPrice,
      runId,
      label: "sup",
    });

    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/workshops/reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row, "the seeded invoiced reservation is missing from the dashboard").toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();

    await expect(page.getByRole("heading", { name: /modifier la réservation/i })).toBeVisible();
    // Non-blocking note, not the red "blocked" banner — a fresh invoice no
    // longer refuses the transfer outright, see getWorkshopTransferOptions.
    await expect(page.getByText(new RegExp(`facture existe déjà.*${invoice.number}`, "i"))).toBeVisible();

    const sessionSelect = page.getByLabel(/nouvelle séance/i);
    const targetOption = sessionSelect.locator("option").filter({ hasText: `E2E InvTarget ${runId}` });
    const targetSessionId = await targetOption.getAttribute("value");
    expect(targetSessionId).toBe(target.session.id);
    await sessionSelect.selectOption(targetSessionId);

    const reason = `Transfert d'une réservation déjà facturée — ${runId}`;
    await page.getByLabel(/motif obligatoire/i).fill(reason);
    await page.getByRole("button", { name: /confirmer le transfert sans frais/i }).click();
    await expect(page.getByText(/note de crédit n°/i)).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const row = await prisma.invoice.findUnique({ where: { id: invoice.id }, select: { supersededAt: true } });
          return row?.supersededAt ? "superseded" : "pending";
        },
        { timeout: 30_000 }
      )
      .toBe("superseded");

    const [oldInvoiceAfter, newInvoice, creditNote, afterPayment] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.invoice.findUnique({ where: { paymentId: payment.id } }),
      prisma.creditNote.findFirst({ where: { invoiceId: invoice.id }, orderBy: { issuedAt: "desc" } }),
      prisma.payment.findUnique({ where: { id: payment.id } }),
    ]);

    // The old document is voided, never edited or deleted — Belgian VAT law
    // (Code de la TVA art. 53 §2). It stays reachable through its own id and
    // through the credit note that credited it.
    expect(oldInvoiceAfter.paymentId).toBeNull();
    expect(oldInvoiceAfter.supersededAt).not.toBeNull();
    expect(oldInvoiceAfter.number).toBe(invoice.number);

    expect(creditNote).not.toBeNull();
    expect(Number(creditNote.totalInclVat)).toBeCloseTo(invoicedPrice, 2);

    // Same price, fully paid before the transfer too — the replacement is
    // issued immediately in the same transaction, not deferred to settlement.
    expect(newInvoice).not.toBeNull();
    expect(newInvoice.id).not.toBe(invoice.id);
    expect(newInvoice.number).not.toBe(invoice.number);
    expect(newInvoice.supersedesInvoiceId).toBe(invoice.id);
    expect(Number(newInvoice.totalInclVat)).toBeCloseTo(invoicedPrice, 2);
    // Regression guard for the billingProfile include fix: without it this
    // would silently fall back to vatValidationName instead.
    expect(newInvoice.customerLegalName).toBe(companyLegalName);

    expect(afterPayment.status).toBe("PAID");
    expect(Number(afterPayment.remainingAmount)).toBeCloseTo(0, 2);

    await page.goto("/dashboard/operations?tab=transactions");
    const transferRow = page.getByRole("row").filter({ hasText: customer.email }).filter({ hasText: "Transfert de réservation" });
    await expect(transferRow).toBeVisible({ timeout: 30_000 });
    await transferRow.getByRole("button", { name: "Voir le détail" }).click();
    const transferDialog = page.getByRole("dialog", { name: "Détail du transfert" });
    await expect(transferDialog).toBeVisible();
    await expect(transferDialog).toContainText(invoice.number);
    await expect(transferDialog).toContainText(creditNote.number);
    await expect(transferDialog).toContainText(newInvoice.number);
  });

  test("defers the replacement invoice to settlement when the transfer leaves a balance due", async ({ page }) => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const admin = await seedAdmin({ label: "transferdefer" });
    const invoicedPrice = 121;
    const higherPrice = 181;
    const current = await seedWorkshopSession({ price: invoicedPrice, daysAhead: 52 });
    const target = await seedWorkshopSession({ price: higherPrice, daysAhead: 53 });

    await Promise.all([
      prisma.activity.update({ where: { id: current.activity.id }, data: { title: `E2E DeferCurrent ${runId}` } }),
      prisma.activity.update({ where: { id: target.activity.id }, data: { title: `E2E DeferTarget ${runId}` } }),
    ]);

    const { customer, payment, invoice } = await seedInvoicedB2BReservation({
      session: current.session,
      price: invoicedPrice,
      runId,
      label: "defer",
    });

    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/workshops/reservations");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Row actions" }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();

    const sessionSelect = page.getByLabel(/nouvelle séance/i);
    const targetOption = sessionSelect.locator("option").filter({ hasText: `E2E DeferTarget ${runId}` });
    const targetSessionId = await targetOption.getAttribute("value");
    await sessionSelect.selectOption(targetSessionId);

    // The target costs more — a price decision is required before the reason
    // field even matters. "Ajouter ... au solde restant" = APPLY_TARGET_PRICE.
    await page.locator('input[name="priceDecision"][value="APPLY_TARGET_PRICE"]').check();

    const reason = `Transfert vers une séance plus chère — ${runId}`;
    await page.getByLabel(/motif obligatoire/i).fill(reason);
    await page.getByRole("button", { name: /confirmer le transfert sans frais/i }).click();
    await expect(page.getByText(/note de crédit n°/i)).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const row = await prisma.invoice.findUnique({ where: { id: invoice.id }, select: { supersededAt: true } });
          return row?.supersededAt ? "superseded" : "pending";
        },
        { timeout: 30_000 }
      )
      .toBe("superseded");

    const [oldInvoiceAfter, newInvoice, creditNote, afterPayment] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: invoice.id } }),
      prisma.invoice.findUnique({ where: { paymentId: payment.id } }),
      prisma.creditNote.findFirst({ where: { invoiceId: invoice.id }, orderBy: { issuedAt: "desc" } }),
      prisma.payment.findUnique({ where: { id: payment.id } }),
    ]);

    // The correction is documented immediately either way — only the
    // *replacement* is deferred, never the credit note.
    expect(oldInvoiceAfter.paymentId).toBeNull();
    expect(creditNote).not.toBeNull();
    expect(Number(creditNote.totalInclVat)).toBeCloseTo(invoicedPrice, 2);

    // No replacement yet: the new total isn't fully covered by what's already
    // paid, so this reproduces the ordinary "not yet invoiced" state
    // settleReservation already handles — it issues one later, once the
    // balance is actually collected.
    expect(newInvoice).toBeNull();
    expect(afterPayment.status).toBe("PARTIALLY_PAID");
    expect(Number(afterPayment.remainingAmount)).toBeCloseTo(higherPrice - invoicedPrice, 2);
  });
});
