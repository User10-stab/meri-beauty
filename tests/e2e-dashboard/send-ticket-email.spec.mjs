import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * The one deliberate exception to "nothing e-mails the client a ticket any
 * more" (see reservation-ticket-not-emailed.spec.mjs): a staff member
 * granted STAFF_PERMISSIONS.SEND_TICKET_EMAIL can manually send the ticket
 * for a sale they rang up, from the Livre de caisse. Everyone else still
 * cannot — the permission is opt-in, not a role.
 *
 * A CASH settlement is required (not the EXTERNAL_TERMINAL/CARD path the
 * other ticket spec uses) because Transaction.cashSessionId is only ever set
 * for CASH (actions/appointment/manage-appointment.js) — a sale with no
 * cashSessionId never appears in any Livre de caisse at all, so this needs a
 * real till open to even reach the row the send button lives on.
 *
 * Same global-resource caveat as caisse-till-session.spec.mjs: exactly one
 * CashSession may be open system-wide, so this skips rather than fights over
 * somebody else's open till, and it closes only the one it opened.
 */

const APPOINTMENTS_PAGE = "/dashboard/appointments";
const CAISSE_PAGE = "/dashboard/boutique/caisse";
const OPERATIONS_PAGE = "/dashboard/operations";
const OPENING_FLOAT = 120;
const TICKET_SUBJECT = /ticket/i;

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

/** Settles a CONFIRMED appointment's balance in CASH via the "Terminer" dialog. */
async function settleInCash(page, customer) {
  await page.goto(APPOINTMENTS_PAGE);
  await dismissOnboardingNag(page);

  const search = page.getByPlaceholder("Rechercher un client…");
  await search.fill(customer.email);
  await search.press("Enter");

  const row = rowFor(page, customer.fullName);
  await expect(row, "the seeded appointment never showed up in the search").toBeVisible({ timeout: 20_000 });

  await row.getByRole("button", { name: /actions du rendez-vous/i }).click();
  await row.getByRole("menuitem", { name: /^terminer$/i }).click();

  const dialog = page.getByRole("dialog");
  const confirmButton = dialog.getByRole("button", { name: /encaisser et terminer/i });
  await expect(confirmButton).toBeVisible();

  // CASH is the dialog's default method — no combobox change needed, only
  // the "j'ai bien reçu" confirmation.
  await dialog.getByRole("checkbox").check();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("manually e-mailing a ticket is gated on SEND_TICKET_EMAIL, not on who is logged in", () => {
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

  test("a staff member without the permission never sees the send action; one with it can actually deliver the ticket, and it becomes visible in Opérations", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    await requireMailpit();

    const admin = await seedAdmin({ label: "sendticket" });
    const noPermStaff = await seedStaff({ label: "sendticketnoperm", permissions: ["APPOINTMENTS", "CASH_REGISTER"] });
    const sendStaff = await seedStaff({
      label: "sendticketallowed",
      permissions: ["APPOINTMENTS", "CASH_REGISTER", "SEND_TICKET_EMAIL"],
    });
    const customerA = await seedCustomer({ label: "sendticketa" });
    const customerB = await seedCustomer({ label: "sendticketb" });

    await seedAppointment({
      staff: noPermStaff.staff,
      customer: customerA,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: 45,
    });
    const { appointment: appointmentB } = await seedAppointment({
      staff: sendStaff.staff,
      customer: customerB,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: 45,
    });

    // ── Open the till, as admin ─────────────────────────────────────────────
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAs(adminPage, admin.credentials);
    await adminPage.goto(CAISSE_PAGE);
    await adminPage.locator("#opening-float").fill(String(OPENING_FLOAT));
    await adminPage.getByRole("button", { name: /ouvrir la caisse/i }).click();
    // Exact text, not a loose regex: "Aucune session ouverte" (the closed
    // state's own heading) also contains the substring "session ouverte".
    await expect(adminPage.getByRole("heading", { name: "Session ouverte", exact: true })).toBeVisible({ timeout: 20_000 });

    const opened = await prisma.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
    expect(opened, "opening the till did not create a real session").not.toBeNull();
    openedSessionId = opened.id;

    // ── Both staff members settle their own client's balance in cash ──────
    const noPermContext = await browser.newContext();
    const noPermPage = await noPermContext.newPage();
    await loginAs(noPermPage, noPermStaff.credentials);
    await dismissOnboardingNag(noPermPage);
    await settleInCash(noPermPage, customerA);

    const sendContext = await browser.newContext();
    const sendPage = await sendContext.newPage();
    await loginAs(sendPage, sendStaff.credentials);
    await dismissOnboardingNag(sendPage);
    await settleInCash(sendPage, customerB);

    const settlementB = await prisma.transaction.findFirst({
      where: { payment: { appointmentId: appointmentB.id }, transactionType: "FINAL_PAYMENT", isDeleted: false },
      select: { id: true, pieceNumber: true, paymentId: true },
    });
    expect(settlementB, "the balance shows no FINAL_PAYMENT transaction").not.toBeNull();
    expect(settlementB.pieceNumber, "a CASH settlement with the till open must get a piece number").not.toBeNull();

    // ── Without the permission: the whole "Ticket" column is absent ───────
    await noPermPage.goto(`${CAISSE_PAGE}/${openedSessionId}`);
    await expect(noPermPage.getByRole("columnheader", { name: "Ticket" })).toHaveCount(0);
    await expect(noPermPage.getByRole("button", { name: /envoyer par e-mail/i })).toHaveCount(0);

    // ── With the permission: send it, and it actually arrives ─────────────
    await sendPage.goto(`${CAISSE_PAGE}/${openedSessionId}`);
    const rowB = rowFor(sendPage, settlementB.pieceNumber);
    await expect(rowB, "the just-settled cash row never showed up in the Livre de caisse").toBeVisible({ timeout: 20_000 });

    await rowB.getByRole("button", { name: /envoyer par e-mail/i }).click();
    await expect(sendPage.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

    const message = await waitForEmail({ to: customerB.email, subject: TICKET_SUBJECT, timeout: 30_000 });
    expect(message.Subject).toMatch(TICKET_SUBJECT);

    const paymentAfter = await expect
      .poll(
        async () => prisma.payment.findUnique({ where: { id: settlementB.paymentId }, select: { ticketEmailedAt: true } }),
        { message: "ticketEmailedAt was never set", timeout: 10_000 },
      )
      .not.toBeNull()
      .then(() => prisma.payment.findUnique({ where: { id: settlementB.paymentId }, select: { ticketEmailedAt: true } }));
    expect(paymentAfter.ticketEmailedAt).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { action: "ticket.emailed", entityType: "Payment", entityId: settlementB.paymentId },
    });
    expect(auditRow, "no ticket.emailed audit row was written").not.toBeNull();
    expect(auditRow.actorId).toBe(sendStaff.user.id);

    // ── Admin visibility: the send shows up next to this same transaction ──
    await adminPage.goto(OPERATIONS_PAGE);
    const adminRow = rowFor(adminPage, customerB.email);
    await expect(adminRow, "the settled transaction never showed up in Opérations").toBeVisible({ timeout: 30_000 });
    await adminRow.getByRole("button", { name: /voir.*gérer/i }).click();

    const drawer = adminPage.getByRole("dialog");
    await expect(drawer.getByText(/ticket envoyé au client le/i)).toBeVisible({ timeout: 20_000 });

    await adminContext.close();
    await noPermContext.close();
    await sendContext.close();
  });
});
