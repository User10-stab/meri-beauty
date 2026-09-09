import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * What happens to the ticket when staff discounts an already-deposit-paid
 * booking at the counter (FicheSettleAction, lib/payments/counter-price-adjustment.js).
 *
 * Two cases, because they settle down completely different code paths:
 *
 * 1. A discount that still leaves something to collect. The booking produces a
 *    real CASH Transaction (with a pieceNumber), so it reaches the Livre de
 *    caisse, and the ticket sent from there (manually — nothing auto-sends any
 *    more, see send-ticket-email.spec.mjs) states the whole prestation: the
 *    adjusted total, with the acompte and the balance broken out underneath.
 *
 *    This is what regressed once already. CashBookClient used to pass the
 *    row's own transactionId, which made buildPaymentTicket emit a single-leg
 *    slip — a client who settled a 60 € booking discounted to 40 € received an
 *    e-mail reading "10,00 €", with no total and nothing tying it to the
 *    booking. The assertions below pin the consolidated shape.
 *
 * 2. A discount taken all the way down to exactly the deposit already paid.
 *    completeAppointment collects nothing and creates no new Transaction
 *    (lib/payments/counter-price-adjustment.js's amountDue is 0), so this
 *    booking never appears in the Livre de caisse — build-ledger.js only lists
 *    CASH transactions carrying a pieceNumber. It is reachable only through
 *    Opérations, via its original deposit transaction, so the send button in
 *    that drawer (TransactionDetailDrawer) is the single surface in the whole
 *    app from which such a client can be sent any receipt at all.
 *
 * 3. A ticket sent *before* the price moved. ticketEmailedAt records only that
 *    a ticket went out, never for which total, so an adjustment afterwards
 *    leaves the client holding a receipt for a price that no longer exists.
 *    The drawer compares that timestamp against the price_adjusted audit row
 *    and says so — nothing else in the app would.
 */

const COUNTER_PAGE = "/dashboard/boutique/point-of-sale";
const CAISSE_PAGE = "/dashboard/boutique/caisse";
const OPERATIONS_PAGE = "/dashboard/operations";
const OPENING_FLOAT = 120;
const TICKET_SUBJECT = /ticket/i;
const ORIGINAL_PRICE = 60;
const DEPOSIT = 30; // seedAppointment's "balanceDue" branch always takes exactly half.

function rowFor(page, text) {
  return page.locator("tr").filter({ hasText: text }).first();
}

async function dismissOnboardingNag(page) {
  try {
    await page.getByRole("button", { name: /plus tard/i }).click({ timeout: 8_000 });
  } catch {
    // No nag this time.
  }
}

/** Opens a customer's fiche on the counter via a name search — searchCounterTickets matches on fullName. */
async function openFiche(page, customer) {
  await page.goto(COUNTER_PAGE);
  await dismissOnboardingNag(page);
  await page.getByLabel("Code, client ou service").fill(customer.fullName);
  await page.getByRole("button", { name: "Rechercher" }).click();
  await expect(page.getByLabel("Prix final TTC"), "the seeded appointment's fiche never opened").toBeVisible({
    timeout: 20_000,
  });
}

async function setFinalPrice(page, amount, reason) {
  await page.getByLabel("Prix final TTC").fill(String(amount));
  await page
    .getByPlaceholder("Raison obligatoire : geste commercial, correction de tarif…")
    .fill(reason);
}

test.describe("counter price adjustment vs. the ticket email", () => {
  test.describe.configure({ mode: "serial" });

  let openedSessionId = null;

  test.beforeAll(async () => {
    const existing = await prisma.cashSession.findFirst({
      where: { closedAt: null },
      select: { id: true, openedAt: true, openedBy: { select: { fullName: true } } },
    });
    test.skip(
      Boolean(existing),
      existing
        ? `A till session is already open (${existing.id}, opened ${existing.openedAt.toISOString()} by ` +
            `${existing.openedBy?.fullName ?? "?"}). Only one CashSession can be open system-wide, so this spec ` +
            "cannot open its own — close it from /dashboard/boutique/caisse and re-run."
        : "",
    );
  });

  test.afterAll(async () => {
    if (openedSessionId) {
      await prisma.cashSession.updateMany({
        where: { id: openedSessionId, closedAt: null },
        data: { closedAt: new Date(), countedCash: OPENING_FLOAT, expectedCash: OPENING_FLOAT, variance: 0 },
      });
    }
    await disconnect();
  });

  test("a discounted booking is ticketed at its adjusted total, whether or not the settlement collected anything", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    await requireMailpit();

    const admin = await seedAdmin({ label: "priceadjust" });
    const staff = await seedStaff({
      label: "priceadjust",
      permissions: ["APPOINTMENTS", "CASH_REGISTER", "POINT_OF_SALE", "SEND_TICKET_EMAIL"],
    });
    const customerA = await seedCustomer({ label: "priceadjusta" });
    const customerB = await seedCustomer({ label: "priceadjustb" });
    const customerC = await seedCustomer({ label: "priceadjustc" });

    const { appointment: appointmentA, payment: paymentA } = await seedAppointment({
      staff: staff.staff,
      customer: customerA,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: ORIGINAL_PRICE,
    });
    const { appointment: appointmentB, payment: paymentB } = await seedAppointment({
      staff: staff.staff,
      customer: customerB,
      createdByUserId: admin.user.id,
      hoursFromNow: -1,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: ORIGINAL_PRICE,
    });
    // Case 3's booking. Its deposit is ONLINE, so it carries no pieceNumber and
    // never reaches the Livre de caisse — the only place its ticket can be sent
    // before settlement is the Opérations drawer, which is the point.
    const { appointment: appointmentC, payment: paymentC } = await seedAppointment({
      staff: staff.staff,
      customer: customerC,
      createdByUserId: admin.user.id,
      hoursFromNow: -3,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: ORIGINAL_PRICE,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, staff.credentials);

    // ── Open the till ────────────────────────────────────────────────────
    await page.goto(CAISSE_PAGE);
    await dismissOnboardingNag(page);
    await page.locator("#opening-float").fill(String(OPENING_FLOAT));
    await page.getByRole("button", { name: /ouvrir la caisse/i }).click();
    await expect(page.getByRole("heading", { name: "Session ouverte", exact: true })).toBeVisible({ timeout: 20_000 });

    const opened = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
    expect(opened, "opening the till did not create a real session").not.toBeNull();
    openedSessionId = opened.id;

    // ── Case 1: discount 60 -> 40 (still owes 10), settle in cash ─────────
    await openFiche(page, customerA);
    await setFinalPrice(page, 40, "Geste commercial — cliente fidèle");
    await page.getByRole("radio", { name: "Espèces" }).check();
    await page.getByRole("button", { name: /encaisser et facturer/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

    const paymentAAfter = await prisma.payment.findUnique({
      where: { id: paymentA.id },
      include: { transactions: { where: { isDeleted: false }, orderBy: { paidAt: "asc" } } },
    });
    expect(Number(paymentAAfter.totalAmount)).toBe(40);
    expect(Number(paymentAAfter.remainingAmount)).toBe(0);
    expect(paymentAAfter.status).toBe("PAID");
    expect(paymentAAfter.transactions).toHaveLength(2);
    const finalPaymentA = paymentAAfter.transactions.find((t) => t.transactionType === "FINAL_PAYMENT");
    expect(finalPaymentA, "the reduced balance never produced a FINAL_PAYMENT transaction").toBeTruthy();
    expect(Number(finalPaymentA.amount)).toBe(10);
    expect(finalPaymentA.pieceNumber, "a CASH settlement with the till open must get a piece number").not.toBeNull();

    const auditA = await prisma.auditLog.findFirst({
      where: { action: "reservation.price_adjusted", entityType: "Appointment", entityId: appointmentA.id },
    });
    expect(auditA, "no reservation.price_adjusted audit row was written").not.toBeNull();
    expect(auditA.before).toMatchObject({ totalAmount: ORIGINAL_PRICE });
    expect(auditA.after).toMatchObject({ totalAmount: 40 });

    // ── Case 1: send the ticket, and it reflects the new total ────────────
    await page.goto(`${CAISSE_PAGE}/${openedSessionId}`);
    const rowA = rowFor(page, finalPaymentA.pieceNumber);
    await expect(rowA, "the just-settled cash row never showed up in the Livre de caisse").toBeVisible({
      timeout: 20_000,
    });
    const ledgerRowCountAfterCase1 = await page.locator("tbody tr").count();

    await rowA.getByRole("button", { name: /envoyer par e-mail/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

    const messageA = await waitForEmail({ to: customerA.email, subject: TICKET_SUBJECT, timeout: 30_000 });
    expect(messageA.Subject).toMatch(TICKET_SUBJECT);
    const bodyA = `${messageA.Text ?? ""} ${messageA.HTML ?? ""}`;
    // CashBookClient's "Envoyer par e-mail" sends Payment-scoped (no
    // transactionId), so buildPaymentTicket takes its consolidated branch: the
    // booking's adjusted total, with both legs listed underneath. The N° pièce
    // link on the same row stays per-leg — that column is the cash-book's own
    // register reference — but what the client receives is the whole booking.
    // 40,00 € is a figure the old single-leg slip could not have contained: it
    // is the sum of both legs, so its presence alone is the consolidation. The
    // per-leg acompte/solde breakdown rides in the PDF attachment
    // (TicketDocument renders `payments` whenever there is more than one leg);
    // the e-mail body itself carries the totals.
    expect(bodyA, "the emailed ticket does not state the adjusted total (40,00 €)").toContain("40.00");
    // The 60 € the booking was originally sold at is not what was charged, and
    // a receipt states what was charged — the adjustment is named on the
    // invoice instead (see counter-adjustment-documents.test.js).
    expect(bodyA, "the emailed ticket still shows the original, pre-adjustment total (60,00 €)").not.toContain(
      "60.00",
    );

    // ── Case 2: discount 60 -> 30, exactly the deposit already paid ───────
    await openFiche(page, customerB);
    await setFinalPrice(page, DEPOSIT, "Geste commercial — cliente fidèle");
    await expect(page.getByRole("button", { name: /je confirme cet ajustement/i })).toBeVisible();
    // No payment-method/collection UI at all once amountDue is 0.
    await expect(page.getByRole("radio", { name: "Espèces" })).toHaveCount(0);
    await page.getByRole("button", { name: /je confirme cet ajustement/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

    const paymentBAfter = await prisma.payment.findUnique({
      where: { id: paymentB.id },
      include: { transactions: { where: { isDeleted: false }, orderBy: { paidAt: "asc" } } },
    });
    expect(Number(paymentBAfter.totalAmount)).toBe(DEPOSIT);
    expect(Number(paymentBAfter.remainingAmount)).toBe(0);
    expect(paymentBAfter.status).toBe("PAID");
    // Only the original online deposit — closing the balance to zero collects nothing new.
    expect(paymentBAfter.transactions).toHaveLength(1);
    expect(paymentBAfter.transactions[0].transactionType).toBe("DEPOSIT");
    expect(
      paymentBAfter.transactions.some((t) => t.transactionType === "FINAL_PAYMENT"),
      "closing the balance to zero should never create a FINAL_PAYMENT transaction",
    ).toBe(false);

    const auditB = await prisma.auditLog.findFirst({
      where: { action: "reservation.price_adjusted", entityType: "Appointment", entityId: appointmentB.id },
    });
    expect(auditB, "no reservation.price_adjusted audit row was written for the zero-balance case").not.toBeNull();
    expect(auditB.before).toMatchObject({ totalAmount: ORIGINAL_PRICE });
    expect(auditB.after).toMatchObject({ totalAmount: DEPOSIT });

    // ── Case 2: nothing new lands in the Livre de caisse ───────────────────
    await page.goto(`${CAISSE_PAGE}/${openedSessionId}`);
    await expect(page.getByText(/session ouverte le/i)).toBeVisible({ timeout: 20_000 });
    const ledgerRowCountAfterCase2 = await page.locator("tbody tr").count();
    expect(
      ledgerRowCountAfterCase2,
      "closing the balance to zero produced a new Livre de caisse row, which should be impossible with no Transaction",
    ).toBe(ledgerRowCountAfterCase1);

    // ── Case 2: Opérations is the only place this client can be sent a
    //     receipt at all ────────────────────────────────────────────────────
    //
    // A price adjustment gets its own read-only "Ajustement de prix" summary
    // row here too (60,00 € → 30,00 €, reason, staff name — good audit
    // visibility) but that row carries no action button at all. The row with
    // a "Voir / gérer" button is the *transaction* row underneath it (here,
    // the original online deposit — the only Transaction this payment has).
    // Scope past the adjustment row explicitly rather than taking the first
    // match, so this assertion is about the transaction row's drawer, not an
    // accident of row order.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAs(adminPage, admin.credentials);
    await adminPage.goto(OPERATIONS_PAGE);

    // The adjustment itself is visible and well-audited — its own row states
    // the before/after total, the reason and who did it — but that row is
    // informational only and carries no action button.
    const adjustmentRowB = adminPage
      .locator("tr")
      .filter({ hasText: "Ajustement de prix" })
      .filter({ hasText: customerB.email });
    await expect(adjustmentRowB, "the price adjustment never showed up as its own row in Opérations").toBeVisible({
      timeout: 30_000,
    });
    await expect(adjustmentRowB).toContainText(`${ORIGINAL_PRICE},00 € → ${DEPOSIT},00 €`);
    await expect(adjustmentRowB.getByRole("button", { name: /voir.*gérer/i })).toHaveCount(0);

    const adminRowB = adminPage
      .locator("tr")
      .filter({ hasText: customerB.email })
      .filter({ has: adminPage.getByRole("button", { name: /voir.*gérer/i }) })
      .first();
    await expect(adminRowB, "the discounted booking's transaction row never showed up in Opérations").toBeVisible({
      timeout: 30_000,
    });
    await adminRowB.getByRole("button", { name: /voir.*gérer/i }).click();

    const drawer = adminPage.getByRole("dialog");
    await expect(drawer.getByText(/ticket jamais envoyé par e-mail au client/i)).toBeVisible({ timeout: 20_000 });

    // The whole point of this drawer's send button: this booking has exactly
    // one Transaction (the original deposit) and no cash-book row, so without
    // it the client discounted to a zero balance could never be sent anything.
    await drawer.getByRole("button", { name: /envoyer par e-mail/i }).click();
    const messageB = await waitForEmail({ to: customerB.email, subject: TICKET_SUBJECT, timeout: 30_000 });
    const bodyB = `${messageB.Text ?? ""} ${messageB.HTML ?? ""}`;
    // Nothing was collected at settlement, so the receipt states the deposit —
    // the only money this booking ever took, and its adjusted total.
    expect(bodyB, "the emailed ticket does not state the adjusted total (30,00 €)").toContain("30.00");
    expect(bodyB, "the emailed ticket still shows the original, pre-adjustment total (60,00 €)").not.toContain(
      "60.00",
    );

    const paymentBEmailed = await prisma.payment.findUnique({
      where: { id: paymentB.id },
      select: { ticketEmailedAt: true },
    });
    expect(paymentBEmailed.ticketEmailedAt, "sending from the drawer never stamped ticketEmailedAt").not.toBeNull();

    // Sent *before* the adjustment is the case the drawer has to warn about;
    // this one was sent after, so the receipt in the client's hands is current.
    await expect(drawer.getByText(/reçu obsolète/i)).toHaveCount(0);

    // ── Case 3: a ticket sent *before* the price moved is flagged stale ────
    //
    // ticketEmailedAt records only that a ticket went out, never for which
    // total, so nothing else in the app could tell an admin that the receipt
    // this client is holding no longer matches what they were charged.
    const openDrawerFor = async (customer) => {
      await adminPage.goto(OPERATIONS_PAGE);
      const row = adminPage
        .locator("tr")
        .filter({ hasText: customer.email })
        .filter({ has: adminPage.getByRole("button", { name: /voir.*gérer/i }) })
        .first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.getByRole("button", { name: /voir.*gérer/i }).click();
      return adminPage.getByRole("dialog");
    };

    const drawerC = await openDrawerFor(customerC);
    await drawerC.getByRole("button", { name: /envoyer par e-mail/i }).click();
    await waitForEmail({ to: customerC.email, subject: TICKET_SUBJECT, timeout: 30_000 });
    await expect(drawerC.getByText(/ticket envoyé au client le/i)).toBeVisible({ timeout: 20_000 });
    await expect(drawerC.getByText(/reçu obsolète/i), "flagged stale before any price change").toHaveCount(0);

    // Now move the price under that already-sent ticket.
    await openFiche(page, customerC);
    await setFinalPrice(page, 45, "Geste commercial — après envoi du ticket");
    await page.getByRole("radio", { name: "Espèces" }).check();
    await page.getByRole("button", { name: /encaisser et facturer/i }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 30_000 });

    const staleDrawer = await openDrawerFor(customerC);
    await expect(
      staleDrawer.getByText(/reçu obsolète/i),
      "the client holds a ticket for a price that no longer exists and the drawer never says so",
    ).toBeVisible({ timeout: 20_000 });
    await expect(staleDrawer.getByRole("button", { name: /renvoyer le ticket corrigé/i })).toBeVisible();

    const auditC = await prisma.auditLog.findFirst({
      where: { action: "reservation.price_adjusted", entityType: "Appointment", entityId: appointmentC.id },
      orderBy: { createdAt: "desc" },
    });
    const paymentCAfter = await prisma.payment.findUnique({
      where: { id: paymentC.id },
      select: { ticketEmailedAt: true },
    });
    expect(
      auditC.createdAt.getTime(),
      "the staleness flag only means anything if the adjustment really is the later of the two",
    ).toBeGreaterThan(paymentCAfter.ticketEmailedAt.getTime());

    await adminContext.close();
    await context.close();
  });
});
