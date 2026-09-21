import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { taggedEmail, getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStockedVariant, readStock, tagPhone } from "./fixtures/seed-dashboard.mjs";

/**
 * Invoice sale at la caisse, pay-later path: an admin rings up one catalogue
 * product ×2 and one free line for a new B2B client, with an invoice comment,
 * and picks « Payer plus tard ». Like every deposit on the site, NO invoice
 * exists until the sale is fully paid. It is then collected from « Ventes en
 * attente de paiement » under the cart in two goes — an acompte (still no
 * invoice), then the balance, which issues the invoice and opens the sending
 * card.
 *
 * ⚠ Unlike the rest of this suite, this spec consumes a REAL number from the
 * legal F-YYYY-NNNNNN series (one per run, at the final payment). A manual
 * invoice cannot exist without one — it goes through issueInvoice — so there
 * is no out-of-series trick like seedAppointmentInvoice's. The invoice stays,
 * exactly as the money suite's documents do, and the purge script leaves it
 * alone (it only deletes numbers containing the run id).
 *
 * Transfer / pay-later only, never cash: it works whether or not a till
 * session is open (a closed till still accepts exactly these), and nothing
 * lands in the cash book.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";
// VIES-bypassed in this environment (VAT_SKIP_VIES_VERIFICATION), same
// number the till specs rely on.
const VALID_BE_VAT = "BE1234567894";
const PRODUCT_PRICE = 30;
const FREE_LINE_PRICE = 40;
const TOTAL = PRODUCT_PRICE * 2 + FREE_LINE_PRICE; // 100 € TTC
const ACOMPTE = 30;

const tillSection = (page) => page.locator("#counter-cart");

test.describe("invoice sale at la caisse: recorded unpaid, invoiced only once the balance is paid", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let admin;
  let seeded;
  let orderNumber;
  let runId;
  let comment;

  test.beforeAll(async ({ browser }) => {
    runId = getRunId();
    comment = `Prestation E2E ${runId} — merci de mentionner le numéro de facture.`;
    admin = await seedAdmin({ label: "manualinv" });
    seeded = await seedStockedVariant({ label: "manualinv", price: PRODUCT_PRICE, stockQuantity: 10 });
    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("« Vendre avec facture » on Factures opens la caisse", async () => {
    await page.goto("/dashboard/factures");
    await page.getByRole("link", { name: /vendre avec facture/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/boutique\/point-of-sale/);
    await expect(tillSection(page).getByRole("button", { name: /ligne libre/i })).toBeVisible({ timeout: 20_000 });
  });

  test("a pay-later sale has no invoice and consumes no number — stock still leaves", async () => {
    test.setTimeout(120_000);
    await page.goto(POS_PAGE);
    const till = tillSection(page);

    // Catalogue line ×2
    await till.getByLabel("Rechercher un produit par nom").fill(seeded.product.name);
    const resultRow = till.locator("li").filter({ hasText: seeded.product.name });
    await expect(resultRow.first(), "the seeded product did not surface in the till's search").toBeVisible({ timeout: 20_000 });
    await resultRow.first().getByRole("button", { name: /^ajouter$/i }).click();
    await resultRow.first().getByRole("button", { name: /^ajouter$/i }).click();

    // Free line
    await till.getByRole("button", { name: /ligne libre/i }).click();
    await till.getByLabel("Description de la ligne libre").fill(`Forfait déplacement E2E ${runId}`);
    await till.getByLabel("Prix unitaire TTC").fill(String(FREE_LINE_PRICE));
    await expect(till.getByText(/vente avec facture/i).first()).toBeVisible();

    // New B2B client — the VAT number is mandatory on an invoice sale.
    await till.getByPlaceholder(/^nom complet$/i).fill(`Société E2E ${runId}`);
    await till.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(taggedEmail("manualinv-buyer", runId));
    await till.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:manualinv-buyer`));
    await till.getByPlaceholder(/BE0123456789/i).fill(VALID_BE_VAT);
    await expect(till.getByText(/adresse de facturation obligatoire/i)).toBeVisible({ timeout: 10_000 });
    await till.getByPlaceholder(/^rue et num[ée]ro$/i).fill("Rue de Test 99");
    await till.getByPlaceholder(/^code postal$/i).fill("1000");
    await till.getByPlaceholder(/^ville$/i).fill("Bruxelles");

    await till.getByLabel(/commentaire imprimé sur la facture/i).fill(comment);
    await till.getByRole("radio", { name: /payer plus tard/i }).click();

    const counterBefore = await prisma.numberingCounter.findMany();

    const record = till.getByRole("button", { name: /enregistrer la vente/i });
    await expect(record).toBeEnabled();
    await record.click();
    await page.getByRole("dialog").getByRole("button", { name: /^enregistrer$/i }).click();

    // No invoice → no sending card; the sale joins the pending panel.
    const pendingRow = page.getByRole("row").filter({ hasText: `Société E2E ${runId}` });
    await expect(pendingRow, "the sale is missing from « Ventes en attente de paiement »").toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    orderNumber = Number((await pendingRow.getByText(/^Vente n°\d+$/).textContent()).match(/\d+/)[0]);

    const order = await prisma.order.findUnique({
      where: { orderNumber },
      include: { payment: { include: { invoice: true, transactions: true } } },
    });
    // COMPLETED, never PENDING_PAYMENT — expire-stale-orders would cancel it.
    expect(order).toMatchObject({ source: "MANUAL", status: "COMPLETED", invoiceNotes: comment });
    expect(Number(order.totalAmount)).toBe(TOTAL);
    expect(order.payment.status).toBe("PENDING");
    expect(order.payment.invoice, "a sale with nothing paid must not be invoiced").toBeNull();
    expect(order.payment.transactions).toHaveLength(0);
    expect(await prisma.numberingCounter.findMany(), "no invoice number may be consumed before full payment").toEqual(counterBefore);

    const stock = await readStock(seeded.variant.id);
    expect(stock.stock, "the catalogue line must leave stock when the sale is recorded").toBe(8);
  });

  test("an acompte keeps it invoice-less; the payment that clears the balance issues the invoice", async () => {
    test.setTimeout(120_000);
    test.skip(!orderNumber, "the previous test did not record a sale");

    await page.goto(POS_PAGE);
    const row = page.getByRole("row").filter({ hasText: `Vente n°${orderNumber}` });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // 1. Acompte
    await row.getByRole("button", { name: /encaisser/i }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(/montant encaissé/i).fill(String(ACOMPTE));
    await dialog.getByRole("radio", { name: /virement/i }).click();
    await dialog.getByLabel(/référence du virement/i).fill(`E2E-${runId}-ACOMPTE`);
    await dialog.getByRole("button", { name: /enregistrer l'acompte/i }).click();

    await expect(row.getByText(/70,00/)).toBeVisible({ timeout: 20_000 });
    let payment = await prisma.payment.findFirst({ where: { order: { orderNumber } }, include: { invoice: true } });
    expect(payment.status).toBe("PARTIALLY_PAID");
    expect(payment.invoice, "an acompte must not issue the invoice").toBeNull();

    // 2. Balance, approved with « Virement reçu » → invoice
    await row.getByRole("button", { name: /virement reçu/i }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/montant reçu sur le compte/i), "the amount must default to the balance").toHaveValue("70.00");
    await expect(dialog.getByText(/la facture sera émise/i)).toBeVisible();
    await dialog.getByLabel(/référence du virement/i).fill(`E2E-${runId}-SOLDE`);
    await dialog.getByRole("button", { name: /^enregistrer le virement de 70,00/i }).click();

    // « Proposer l'envoi »: the sending card opens on the invoice just issued.
    const delivery = page.getByRole("dialog");
    await expect(delivery, "the delivery dialog did not open after the final payment").toBeVisible({ timeout: 30_000 });
    await delivery.getByRole("button", { name: "Fermer" }).click();
    await expect(page.getByRole("row").filter({ hasText: `Vente n°${orderNumber}` })).toHaveCount(0, { timeout: 20_000 });

    payment = await prisma.payment.findFirst({
      where: { order: { orderNumber } },
      include: { invoice: { include: { lines: true } }, transactions: { orderBy: { createdAt: "asc" } } },
    });
    expect(payment.status).toBe("PAID");
    expect(Number(payment.paidAmount)).toBe(TOTAL);
    expect(payment.invoice).toMatchObject({ source: "MANUAL", notes: comment, customerVatNumber: VALID_BE_VAT });
    expect(payment.invoice.number).toMatch(/^F-\d{4}-\d{6}$/);
    expect(Number(payment.invoice.totalInclVat), "the invoice is for the full price").toBe(TOTAL);
    expect(payment.invoice.lines).toHaveLength(2);
    expect(
      payment.transactions.map((t) => [t.method, t.transactionType, Number(t.amount), t.cashSessionId]),
      "a transfer never touches the cash book",
    ).toEqual([
      ["TRANSFER", "DEPOSIT", ACOMPTE, null],
      ["TRANSFER", "FINAL_PAYMENT", TOTAL - ACOMPTE, null],
    ]);

    // The invoice now sits in the Factures list, like any other.
    await page.goto(`/dashboard/factures?q=${encodeURIComponent(payment.invoice.number)}`);
    await expect(page.getByRole("row").filter({ hasText: payment.invoice.number })).toBeVisible({ timeout: 20_000 });
  });
});
