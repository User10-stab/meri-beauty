import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { taggedEmail, getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, waitForEmail, assertNoEmail } from "../e2e-money/fixtures/mailpit.mjs";
import {
  seedAdmin,
  seedStaff,
  seedAppointment,
  createStaffService,
  seedStockedVariant,
  seedActivitySessionOwnedBy,
  seedActivityReservationWithBalance,
  tagPhone,
} from "./fixtures/seed-dashboard.mjs";

/**
 * The CAISSE permission (25/09/2026), end to end, against the four rules the
 * client set for it:
 *
 *   1. a staff member granted CAISSE runs the till — and only the till;
 *   2. a boutique sale she rings up is ALWAYS the salon's (Marie's): it goes
 *      into the Livre de caisse, gets the salon's ticket, counts as salon
 *      revenue;
 *   3. her own appointment / the formation she animates is HER money: off the
 *      salon's till, no salon ticket, no salon invoice;
 *   4. her own takings never appear in the salon's revenue.
 *
 * tests/critical pins the source of every one of these rules. This file
 * exists because a contract test proves the rule is written down, not that a
 * real staff login clicking through the real till reaches it.
 *
 * The staff member is INDEPENDENT (every practitioner here is) and is NOT
 * Marie: TILL_CASH_OPERATOR_EMAIL is Marie's address, never a seeded one.
 *
 * Till session: completePointOfSaleSale needs one open. An already-open
 * session is reused and left open (only one may exist system-wide, and it is
 * not this suite's to close); otherwise one is opened here and closed in
 * afterAll. The boutique sale pays CASH on purpose — it is the only method
 * whose row joins the Livre de caisse, which is the thing being proved. The
 * purge script deletes that Transaction with the order, so the session's
 * running total goes back to what it was.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";
const SIDEBAR_PROBE_PAGE = "/dashboard/mes-operations";
const OPENING_FLOAT = 100;
const TICKET_SUBJECT = /ticket|reçu/i;
const CONFIRMATION_SUBJECT = /confirmation de votre paiement/i;

// fullNameSchema rejects digits; the run id has them. Map them to letters so
// every name in this run is unique and still searchable at the counter.
function lettersOf(value) {
  return String(value).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]).replace(/[^a-z]/gi, "").slice(-10);
}

function brusselsToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
}

function tillSection(page) {
  return page.locator("#counter-cart");
}

async function dismissOnboardingNag(page) {
  try {
    await page.getByRole("button", { name: /plus tard/i }).click({ timeout: 5_000 });
  } catch {
    // No nag this time.
  }
}

async function clickThroughNag(page, locator, { attempts = 8 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await locator.click({ timeout: 3_000 });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await dismissOnboardingNag(page);
    }
  }
}

/** The counter's one search box → the booking's fiche. */
async function openCounterFiche(page, customerName) {
  await page.goto(POS_PAGE);
  await dismissOnboardingNag(page);
  await page.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(customerName);
  await clickThroughNag(page, page.getByRole("button", { name: /^rechercher$/i }));
  // One match opens its fiche straight away; several list buttons to pick.
  const fiche = page.getByLabel(/prix final/i);
  const result = page.getByRole("button").filter({ hasText: customerName });
  await expect(fiche.or(result.first()), `the counter search did not find ${customerName}`).toBeVisible({ timeout: 20_000 });
  if (!(await fiche.isVisible())) await clickThroughNag(page, result.first());
  await expect(fiche, "the booking's fiche never opened").toBeVisible({ timeout: 20_000 });
}

/** Her own sale: no method picker, no "facturer" — a plain record-and-close. */
async function settleOwnSaleAtCounter(page, amountLabel) {
  const button = page.getByRole("button", { name: new RegExp(`enregistrer ${amountLabel}.*cl[ôo]turer`, "i") });
  await expect(button, "her own sale must not offer the salon's till (method picker / « encaisser et facturer »)").toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /encaisser et facturer/i })).toHaveCount(0);
  await clickThroughNag(page, button);
}

async function lastCollection(paymentId) {
  return prisma.transaction.findFirst({
    where: { paymentId, isDeleted: false, transactionType: "FINAL_PAYMENT" },
    orderBy: { createdAt: "desc" },
  });
}

test.describe("CAISSE: the till for staff, the money for whoever owns the sale", () => {
  test.describe.configure({ mode: "serial" });

  const L = lettersOf(getRunId());
  let admin;
  let cashier; // INDEPENDENT, granted CAISSE
  let noCaisse; // same, without CAISSE
  let tillSessionId = null;
  let openedHere = false;

  // Names the later assertions look for in the salon's books.
  const boutiqueBuyerName = `Client Caisse Boutique ${L}`;
  let appointmentCustomer;
  let formationCustomer;

  test.beforeAll(async () => {
    await requireMailpit();

    admin = await seedAdmin({ label: `caisseadmin${L}` });
    cashier = await seedStaff({
      label: `caissiere${L}`,
      permissions: ["CAISSE", "APPOINTMENTS", "FORMATION_RESERVATIONS", "ACTIVITY_SETTLEMENTS"],
    });
    noCaisse = await seedStaff({ label: `sanscaisse${L}`, permissions: ["APPOINTMENTS"] });
    // Every practitioner here is a separate business. seedStaff creates
    // EMPLOYEE (whose work IS the salon's) — flip both to the real shape.
    for (const person of [cashier, noCaisse]) {
      await prisma.staff.update({ where: { id: person.staff.id }, data: { type: "INDEPENDENT" } });
      await createStaffService({ staff: person.staff, createdByUserId: admin.user.id });
    }

    const open = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
    if (open) {
      tillSessionId = open.id;
    } else {
      const created = await prisma.cashSession.create({
        data: { openedById: admin.user.id, openingFloat: OPENING_FLOAT },
      });
      tillSessionId = created.id;
      openedHere = true;
    }
  });

  test.afterAll(async () => {
    if (openedHere && tillSessionId) {
      await prisma.cashSession.updateMany({
        where: { id: tillSessionId, closedAt: null },
        data: { closedAt: new Date() },
      });
    }
    await disconnect();
  });

  test("1. CAISSE opens the Caisse screen — and not the Livre de caisse or Commandes", async ({ browser }) => {
    test.setTimeout(150_000);

    const context = await browser.newContext();
    const page = await context.newPage();

    // Without CAISSE: no menu entry, and the URL itself bounces.
    await loginAs(page, noCaisse.credentials);
    await page.goto(POS_PAGE);
    await expect(page).not.toHaveURL(/point-of-sale/, { timeout: 30_000 });
    await page.goto(SIDEBAR_PROBE_PAGE);
    await dismissOnboardingNag(page);
    await expect(page.locator('aside a[href="/dashboard/mes-operations"]').first()).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('aside a[href="/dashboard/boutique/point-of-sale"]')).toHaveCount(0);

    // With CAISSE: the till loads; the salon's own books stay closed.
    await loginAs(page, cashier.credentials);
    await page.goto(POS_PAGE);
    await dismissOnboardingNag(page);
    await expect(page).toHaveURL(/point-of-sale/);
    await expect(tillSection(page)).toBeVisible({ timeout: 30_000 });
    // Sidebar. The till page has no dashboard shell (app/(dashboard) has no
    // layout), so read it from Mes opérations, whose group ("Ventes &
    // paiements") is auto-expanded there: Caisse yes, Livre de caisse and
    // Commandes no.
    await page.goto(SIDEBAR_PROBE_PAGE);
    await dismissOnboardingNag(page);
    await expect(page.locator('aside a[href="/dashboard/mes-operations"]').first()).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('aside a[href="/dashboard/boutique/point-of-sale"]').first()).toBeAttached();
    await expect(page.locator('aside a[href="/dashboard/boutique/caisse"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/dashboard/boutique/orders"]')).toHaveCount(0);

    for (const salonOnly of ["/dashboard/boutique/caisse", "/dashboard/boutique/orders"]) {
      await page.goto(salonOnly);
      await expect(page, `${salonOnly} must stay Marie/admin only`).not.toHaveURL(new RegExp(salonOnly), {
        timeout: 30_000,
      });
    }

    await context.close();
  });

  test("2. a boutique sale she rings up is the salon's: Livre de caisse, salon ticket, salon revenue", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const runId = getRunId();
    const { product } = await seedStockedVariant({ label: `caisse${L}`, price: 25 });
    const buyerEmail = taggedEmail("caisse-boutique-buyer", runId);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, cashier.credentials);
    await page.goto(POS_PAGE);
    await dismissOnboardingNag(page);
    const till = tillSection(page);

    await till.getByLabel("Rechercher un produit par nom").fill(product.name);
    const resultRow = till.locator("li").filter({ hasText: product.name });
    await expect(resultRow.first(), "the seeded product did not surface in the till").toBeVisible({ timeout: 20_000 });
    await clickThroughNag(page, resultRow.first().getByRole("button", { name: /^ajouter$/i }));

    await till.getByPlaceholder(/^nom complet$/i).fill(boutiqueBuyerName);
    await till.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(buyerEmail);
    await till.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:caisse-boutique-buyer`));
    // A brand-new named client needs a billing address at the till.
    await till.getByPlaceholder(/^rue et num[ée]ro$/i).fill("Rue de Test 12");
    await till.getByPlaceholder(/^code postal$/i).fill("1000");
    await till.getByPlaceholder(/^ville$/i).fill("Bruxelles");

    await clickThroughNag(page, till.getByRole("radio", { name: /esp[èe]ces/i }));
    await till.locator("#pos-cash-received").fill("30");
    await clickThroughNag(page, till.getByRole("button", { name: /encaisser et envoyer le ticket/i }));

    // Her till clears for the next client instead of bouncing her to the
    // (salon-only) order page.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/point-of-sale/);

    let order = null;
    await expect
      .poll(
        async () => {
          order = await prisma.order.findFirst({
            where: { createdByStaffId: cashier.user.id, source: "POS", status: "COMPLETED" },
            include: { payment: { include: { transactions: true, invoice: true } } },
          });
          return Boolean(order?.payment);
        },
        { message: "the boutique sale never completed", timeout: 30_000 },
      )
      .toBe(true);

    // The salon's money…
    expect(order.payment.payeeStaffId, "a boutique sale must belong to the salon, whoever rang it up").toBeNull();
    // …in the salon's drawer book…
    const cash = order.payment.transactions.find((t) => t.method === "CASH");
    expect(cash, "no CASH transaction recorded").toBeTruthy();
    expect(cash.cashSessionId, "the cash did not enter the Livre de caisse").toBe(tillSessionId);
    expect(cash.pieceNumber, "no cash-book piece number").not.toBeNull();
    // …with the salon's ticket.
    expect(order.ticketNumber, "the salon ticket was not issued").not.toBeNull();
    const receipt = await waitForEmail({ to: buyerEmail, subject: TICKET_SUBJECT, timeout: 30_000 });
    expect((receipt.Attachments ?? []).length, "the client's receipt carries no ticket PDF").toBeGreaterThan(0);

    await context.close();
  });

  test("3a. her own appointment, collected at the till: hers — off-till, no salon ticket, no invoice", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    appointmentCustomer = await seedCustomer({ label: `rdvcaisse${L}` });
    const { appointment } = await seedAppointment({
      staff: cashier.staff,
      customer: appointmentCustomer,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "none",
      price: 60,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, cashier.credentials);
    await openCounterFiche(page, appointmentCustomer.fullName);
    await settleOwnSaleAtCounter(page, "60");

    await expect
      .poll(async () => (await prisma.appointment.findUnique({ where: { id: appointment.id } }))?.status, {
        message: "the appointment was not closed out",
        timeout: 30_000,
      })
      .toBe("COMPLETED");

    const payment = await prisma.payment.findFirst({ where: { appointmentId: appointment.id }, include: { invoice: true } });
    expect(payment.payeeStaffId, "her appointment's money must be hers").toBe(cashier.staff.id);
    expect(payment.ticketNumber, "the salon issued a ticket for her own service").toBeNull();
    expect(payment.invoice, "the salon issued an invoice for her own service").toBeNull();
    const collection = await lastCollection(payment.id);
    expect(collection, "nothing was recorded as collected").toBeTruthy();
    expect(collection.cashSessionId, "her money entered the salon's Livre de caisse").toBeNull();
    expect(collection.pieceNumber).toBeNull();

    const mail = await waitForEmail({ to: appointmentCustomer.email, subject: CONFIRMATION_SUBJECT, timeout: 30_000 });
    expect((mail.Attachments ?? []).length, "her client received a document attached").toBe(0);
    await assertNoEmail({ to: appointmentCustomer.email, subject: /ticket/i, timeout: 5_000 });

    await context.close();
  });

  test("3b. the formation she animates, collected at the till: hers — off-till, no salon ticket, no invoice", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    formationCustomer = await seedCustomer({ label: `formationcaisse${L}` });
    const { formation, session } = await seedActivitySessionOwnedBy({
      kind: "FORMATION",
      createdById: cashier.user.id,
      price: 120,
    });
    // Linked the way production links it (Animator.staffId), so the payee is
    // resolved exactly as resolvePayeeForFormationSession does.
    const animator = await prisma.animator.create({
      data: { name: cashier.user.fullName, email: cashier.user.email, staffId: cashier.staff.id },
    });
    await prisma.formation.update({ where: { id: formation.id }, data: { animatorId: animator.id } });
    await prisma.formationSession.update({ where: { id: session.id }, data: { animatorId: animator.id } });
    const { reservation, payment: seededPayment } = await seedActivityReservationWithBalance({
      kind: "FORMATION",
      session,
      customer: formationCustomer,
      price: 120,
    });
    // The online deposit was charged to her, so the Payment was born hers
    // (payee frozen at checkout — see resolve-payee.js).
    await prisma.payment.update({ where: { id: seededPayment.id }, data: { payeeStaffId: cashier.staff.id } });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, cashier.credentials);
    await openCounterFiche(page, formationCustomer.fullName);
    await settleOwnSaleAtCounter(page, "60");

    await expect
      .poll(async () => (await prisma.formationReservation.findUnique({ where: { id: reservation.id } }))?.status, {
        message: "the formation booking was not closed out",
        timeout: 30_000,
      })
      .toBe("COMPLETED");

    const payment = await prisma.payment.findUnique({ where: { id: seededPayment.id }, include: { invoice: true } });
    expect(payment.payeeStaffId).toBe(cashier.staff.id);
    expect(payment.ticketNumber, "the salon issued a ticket for her own formation").toBeNull();
    expect(payment.invoice, "the salon issued an invoice for her own formation").toBeNull();
    const collection = await lastCollection(payment.id);
    expect(collection, "the balance was not recorded").toBeTruthy();
    expect(collection.cashSessionId, "her money entered the salon's Livre de caisse").toBeNull();
    expect(collection.pieceNumber).toBeNull();

    const mail = await waitForEmail({ to: formationCustomer.email, subject: CONFIRMATION_SUBJECT, timeout: 30_000 });
    expect((mail.Attachments ?? []).length).toBe(0);
    await assertNoEmail({ to: formationCustomer.email, subject: /ticket/i, timeout: 5_000 });

    await context.close();
  });

  test("4. the salon's revenue shows the boutique sale and never her own takings; her ledger shows the reverse", async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const today = brusselsToday();

    const context = await browser.newContext();
    const page = await context.newPage();

    // The admin's Livre de recettes — the salon's declared takings.
    await loginAs(page, admin.credentials);
    await page.goto(`/dashboard/livre-de-recettes?from=${today}&to=${today}`);
    const journal = page.locator("main");
    // The journal folds each day into one row — open today's.
    const dayRow = journal.getByRole("row", { name: /\(\d+ écritures?\)/ }).first();
    await expect(dayRow, "no takings at all for today in the salon's journal").toBeVisible({ timeout: 30_000 });
    await dayRow.click();
    await expect(journal.getByText(boutiqueBuyerName).first(), "the boutique sale is missing from the salon's revenue").toBeVisible({
      timeout: 30_000,
    });
    await expect(journal.getByText(appointmentCustomer.fullName), "her appointment leaked into the salon's revenue").toHaveCount(0);
    await expect(journal.getByText(formationCustomer.fullName), "her formation leaked into the salon's revenue").toHaveCount(0);

    // Her own ledger: her two sales, not the boutique sale she rang up.
    await loginAs(page, cashier.credentials);
    await page.goto("/dashboard/mes-operations");
    await dismissOnboardingNag(page);
    const ledger = page.locator("main");
    await expect(ledger.getByText(appointmentCustomer.fullName).first(), "her appointment is missing from her own ledger").toBeVisible({
      timeout: 30_000,
    });
    await expect(ledger.getByText(boutiqueBuyerName), "the salon's boutique sale showed up as hers").toHaveCount(0);

    await context.close();
  });
});
