import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { taggedEmail, getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStockedVariant, tagPhone } from "./fixtures/seed-dashboard.mjs";

/**
 * The retail till's own two staff-facing overrides, both new: a VAT-eligible
 * B2B client can decline the invoice for one specific sale (checked by
 * default — today's automatic behaviour is unchanged unless someone
 * unchecks it), and a walk-in's e-mail — previously hard-required
 * server-side — is now a nudge staff can uncheck to still complete the sale.
 *
 * completePointOfSaleSale (unlike the booking composer covered by
 * counter-unified-sale.spec.mjs) unconditionally requires an open
 * CashSession regardless of payment method — CounterCart renders a
 * full-page "Caisse fermée" lock instead of the till at all otherwise. Only
 * one CashSession may be open system-wide, so this suite opens its own (a
 * plain Prisma row, not through the UI — nothing here needs to prove the
 * open-till flow itself, that is cash-session-gate.spec.mjs's job) and
 * skips rather than fights over somebody else's.
 *
 * Every sale here pays EXTERNAL_TERMINAL, never CASH, so the session's own
 * expectedCash never has to be computed from real cash movements — it stays
 * exactly the opening float, and closing it afterwards is a one-line update.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";
// VIES-bypassed in this environment (VAT_SKIP_VIES_VERIFICATION), same
// number counter-unified-sale.spec.mjs already relies on being accepted.
const VALID_BE_VAT = "BE1234567894";
const OPENING_FLOAT = 100;

// CounterCart's own root — a <section> (cart) and a sibling <aside> (buyer
// form + payment) under one #counter-cart div, distinct from the "Pointage
// & encaissement" composer elsewhere on the same page, which shares several
// of the same field placeholders via the same CounterBuyerForm component.
function tillSection(page) {
  return page.locator("#counter-cart");
}

function orderIdFromUrl(url) {
  const match = /\/dashboard\/boutique\/orders\/([^/?#]+)/.exec(url);
  if (!match) throw new Error(`did not land on an order detail page — url was ${url}`);
  return match[1];
}

/** Adds the seeded product to the till's cart via its own search box. */
async function addProductToCart(page, till, product) {
  await till.getByLabel("Rechercher un produit par nom").fill(product.name);
  const resultRow = till.locator("li").filter({ hasText: product.name });
  await expect(resultRow.first(), "the seeded product did not surface in the till's own search").toBeVisible({
    timeout: 20_000,
  });
  await resultRow.first().getByRole("button", { name: /^ajouter$/i }).click();
}

/** Card/terminal confirm dialog → real submission, same for every scenario below. */
async function payByExternalTerminalAndSubmit(page, till, terminalRef) {
  await till.getByRole("button", { name: /terminal externe/i }).click();
  await till.getByRole("button", { name: /encaisser et envoyer le ticket/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel(/je confirme.*terminal.*approuvé/i).check();
  await dialog.getByPlaceholder(/référence.*ticket terminal/i).fill(terminalRef);
  await dialog.getByRole("button", { name: /encaisser et envoyer le reçu/i }).click();

  await page.waitForURL(/\/dashboard\/boutique\/orders\/[^/?#]+/, { timeout: 30_000 });
  return orderIdFromUrl(page.url());
}

test.describe("the retail till's invoice opt-out and optional walk-in e-mail", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let admin;
  let openedSessionId = null;

  test.beforeAll(async ({ browser }) => {
    admin = await seedAdmin({ label: "posinvoiceopt" });

    const existing = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
    test.skip(
      Boolean(existing),
      existing ? `A till session is already open (${existing.id}) — only one may be open system-wide.` : "",
    );

    const opened = await prisma.cashSession.create({
      data: { openedById: admin.user.id, openingFloat: OPENING_FLOAT },
    });
    openedSessionId = opened.id;

    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    if (openedSessionId) {
      // No CASH transaction ever ran through it — EXTERNAL_TERMINAL only —
      // so the till was never touched: expected cash is still exactly the
      // opening float.
      await prisma.cashSession.updateMany({
        where: { id: openedSessionId, closedAt: null },
        data: { closedAt: new Date(), countedCash: OPENING_FLOAT, expectedCash: OPENING_FLOAT, variance: 0 },
      });
    }
    await page?.close();
    await disconnect();
  });

  test("a VAT-eligible client left with the invoice checkbox checked still gets a real invoice (default unchanged)", async () => {
    test.setTimeout(120_000);

    const runId = getRunId();
    const { product } = await seedStockedVariant({ label: "posinvA", price: 30 });
    const buyerEmail = taggedEmail("posinv-a-buyer", runId);

    await page.goto(POS_PAGE);
    const till = tillSection(page);

    await addProductToCart(page, till, product);

    await till.getByPlaceholder(/^nom complet$/i).fill("Client Facture Defaut Automatise");
    await till.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(buyerEmail);
    await till.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:posinv-a-buyer`));
    await till.getByPlaceholder(/BE0123456789/i).fill(VALID_BE_VAT);

    await expect(till.getByText(/adresse de facturation obligatoire/i)).toBeVisible({ timeout: 10_000 });
    await till.getByPlaceholder(/^rue et num[ée]ro$/i).fill("Rue de Test 99");
    await till.getByPlaceholder(/^code postal$/i).fill("1000");
    await till.getByPlaceholder(/^ville$/i).fill("Bruxelles");

    const invoiceCheckbox = till.getByLabel(/générer une facture pour ce client/i);
    await expect(invoiceCheckbox, "the new invoice checkbox never appeared for a VAT-typed buyer").toBeVisible({
      timeout: 10_000,
    });
    await expect(invoiceCheckbox, "it must default to checked — today's automatic behaviour").toBeChecked();

    const orderId = await payByExternalTerminalAndSubmit(page, till, `E2E-${runId}-INVA`);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: { include: { invoice: true } } },
    });
    expect(order.status).toBe("COMPLETED");
    expect(order.invoiceRequested, "a VAT-eligible client left checked must still be recorded as requested").toBe(true);
    expect(order.customerVatNumber).toBe(VALID_BE_VAT);
    expect(order.payment?.invoice, "no Invoice was created despite a valid VAT identity and the checkbox left checked").not.toBeNull();
  });

  test("unchecking the invoice checkbox for the same kind of VAT-eligible client creates no invoice at all", async () => {
    test.setTimeout(120_000);

    const runId = getRunId();
    const { product } = await seedStockedVariant({ label: "posinvB", price: 30 });
    const buyerEmail = taggedEmail("posinv-b-buyer", runId);

    await page.goto(POS_PAGE);
    const till = tillSection(page);

    await addProductToCart(page, till, product);

    await till.getByPlaceholder(/^nom complet$/i).fill("Client Facture Refusee Automatise");
    await till.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(buyerEmail);
    await till.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:posinv-b-buyer`));
    await till.getByPlaceholder(/BE0123456789/i).fill(VALID_BE_VAT);

    await expect(till.getByText(/adresse de facturation obligatoire/i)).toBeVisible({ timeout: 10_000 });
    await till.getByPlaceholder(/^rue et num[ée]ro$/i).fill("Rue de Test 99");
    await till.getByPlaceholder(/^code postal$/i).fill("1000");
    await till.getByPlaceholder(/^ville$/i).fill("Bruxelles");

    const invoiceCheckbox = till.getByLabel(/générer une facture pour ce client/i);
    await expect(invoiceCheckbox).toBeChecked();
    await invoiceCheckbox.uncheck();
    await expect(till.getByText(/aucune facture ne sera générée pour cette vente/i)).toBeVisible();

    const orderId = await payByExternalTerminalAndSubmit(page, till, `E2E-${runId}-INVB`);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: { include: { invoice: true } } },
    });
    expect(order.status).toBe("COMPLETED");
    expect(order.invoiceRequested, "a declined invoice must be recorded as false, not left null, for audit").toBe(false);
    expect(order.customerVatNumber, "declining the invoice must not leave a VAT number stamped on the order").toBeNull();
    expect(order.payment?.invoice, "an Invoice was created despite the client declining it").toBeNull();
  });

  test("a walk-in sale completes with no e-mail once the collect-e-mail checkbox is unchecked", async () => {
    test.setTimeout(120_000);

    const runId = getRunId();
    const { product } = await seedStockedVariant({ label: "posinvC", price: 18 });

    await page.goto(POS_PAGE);
    const till = tillSection(page);

    await addProductToCart(page, till, product);
    await till.getByLabel(/client de passage/i).check();

    const collectEmailCheckbox = till.getByLabel(/demander l.?e-?mail du client/i);
    await expect(collectEmailCheckbox, "the new collect-e-mail checkbox never appeared for a walk-in").toBeVisible({
      timeout: 10_000,
    });
    await expect(collectEmailCheckbox).toBeChecked();
    await collectEmailCheckbox.uncheck();

    const submitButton = till.getByRole("button", { name: /encaisser et envoyer le ticket/i });
    // Cart has one item, no method picked yet — pick EXTERNAL_TERMINAL, the
    // one still available while "client de passage" is active (CARD_QR is
    // disabled in that mode).
    await till.getByRole("button", { name: /terminal externe/i }).click();
    await expect(
      submitButton,
      "leaving the e-mail blank must not disable submission once the checkbox is unchecked",
    ).toBeEnabled();

    const orderId = await payByExternalTerminalAndSubmit(page, till, `E2E-${runId}-WALKIN`);

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.status).toBe("COMPLETED");
    expect(order.userId).toBeNull();
    expect(order.posTicketEmailTo, "no e-mail was collected, so nothing should have been recorded as sent to").toBeNull();
  });
});
