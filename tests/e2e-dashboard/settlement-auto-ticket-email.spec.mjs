import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, waitForEmail, assertNoEmail } from "../e2e-money/fixtures/mailpit.mjs";
import {
  seedAdmin,
  seedStaff,
  seedAppointment,
  createStaffService,
  seedActivitySessionOwnedBy,
  seedActivityReservationWithBalance,
} from "./fixtures/seed-dashboard.mjs";

/**
 * The ON side of the gate `reservation-ticket-not-emailed.spec.mjs` pins the
 * OFF side of: settling a balance now auto-e-mails the client's ticket again
 * — via the same shared, permission-gated `sendTicketByEmail` the manual
 * "Envoyer par e-mail" button already used — but only when the settling
 * staff member holds SEND_TICKET_EMAIL. No manual click is involved in any
 * scenario below; every send here is a direct side effect of "Terminer"/
 * "Clôturer".
 *
 * Off-till throughout (plain STAFF, never Marie/admin): settleReservation's
 * `!isTillCashOperator` branch needs no open CashSession and no payment
 * method choice — SettleReservationDialog collapses to a single "Clôturer"
 * confirmation — so these scenarios don't compete with other specs for the
 * one global CashSession the way a CASH till settlement would.
 */

const APPOINTMENTS_PAGE = "/dashboard/appointments";
const WORKSHOP_RESERVATIONS_PAGE = "/dashboard/workshops/reservations";
const FORMATION_RESERVATIONS_PAGE = "/dashboard/formations/reservations";
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

/**
 * The onboarding nag's own "Connect Stripe" status genuinely never completes
 * for a throwaway seeded staff account, so it can re-render (a fresh z-[9999]
 * overlay) between a dismiss and the very next click — a single dismiss
 * cannot reliably win that race. This retries the click, re-dismissing the
 * nag every time it blocks, until the click actually lands.
 */
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

test.afterAll(async () => {
  await disconnect();
});

test("appointment settlement auto-e-mails the ticket when staff holds SEND_TICKET_EMAIL, and stays silent when nothing new was collected", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await requireMailpit();

  const admin = await seedAdmin({ label: "autoticketrdv" });
  const staff = await seedStaff({
    label: "autoticketrdvstaff",
    permissions: ["APPOINTMENTS", "SEND_TICKET_EMAIL"],
  });
  const customerDue = await seedCustomer({ label: "autoticketrdvdue" });
  const customerPaid = await seedCustomer({ label: "autoticketrdvpaid" });

  await seedAppointment({
    staff: staff.staff,
    customer: customerDue,
    createdByUserId: admin.user.id,
    hoursFromNow: -2,
    status: "CONFIRMED",
    payment: "balanceDue",
    price: 60,
  });
  await seedAppointment({
    staff: staff.staff,
    customer: customerPaid,
    createdByUserId: admin.user.id,
    hoursFromNow: -1,
    status: "CONFIRMED",
    payment: "paid",
    price: 60,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, staff.credentials);
  await page.goto(APPOINTMENTS_PAGE);
  await dismissOnboardingNag(page);

  // This staff member is not a till operator (not Marie/admin), so
  // AppointmentsPageClient's onOpenCompleteDialog skips the confirmation
  // dialog entirely for a balance-due appointment and completes it directly
  // — there is no payment-method choice or "j'ai bien reçu" checkbox to
  // interact with off-till. Only wait for a dialog briefly; if none shows,
  // the click itself already triggered completion.
  async function terminer(customer) {
    const search = page.getByPlaceholder("Rechercher un client…");
    await search.fill(customer.email);
    await search.press("Enter");
    const row = rowFor(page, customer.fullName);
    await expect(row, "the seeded appointment never showed up in the search").toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /actions du rendez-vous/i }).click();
    await row.getByRole("menuitem", { name: /^terminer$/i }).click();
    const dialog = page.getByRole("dialog");
    try {
      const confirmButton = dialog.getByRole("button", { name: /encaisser et terminer|^terminer$/i });
      await expect(confirmButton).toBeVisible({ timeout: 3_000 });
      const checkbox = dialog.getByRole("checkbox");
      if (await checkbox.count()) await checkbox.check();
      await expect(confirmButton).toBeEnabled();
      await confirmButton.click();
    } catch {
      // No dialog for this off-till staff member — the menuitem click
      // already completed the appointment directly.
    }
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
  }

  // ── Balance due: the ticket should arrive with no manual click ─────────
  await terminer(customerDue);
  const message = await waitForEmail({ to: customerDue.email, subject: TICKET_SUBJECT, timeout: 30_000 });
  expect(message.Subject).toMatch(TICKET_SUBJECT);

  const paymentDue = await prisma.appointment
    .findFirst({ where: { userId: customerDue.id }, select: { payment: { select: { id: true } } } })
    .then((a) => a?.payment);
  await expect
    .poll(
      async () => (paymentDue ? prisma.payment.findUnique({ where: { id: paymentDue.id }, select: { ticketEmailedAt: true } }) : null),
      { message: "ticketEmailedAt was never set on auto-send", timeout: 10_000 },
    )
    .not.toBeNull();

  // ── Already fully paid: nothing new collected, nothing new sent ────────
  await page.goto(APPOINTMENTS_PAGE);
  await dismissOnboardingNag(page);
  await terminer(customerPaid);
  await assertNoEmail({ to: customerPaid.email, subject: TICKET_SUBJECT, timeout: 8_000 });

  await context.close();
});

test("workshop and formation settlement auto-e-mail the ticket when the acting staff holds SEND_TICKET_EMAIL", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await requireMailpit();

  const admin = await seedAdmin({ label: "autoticketactivity" });
  const staff = await seedStaff({
    label: "autoticketactivity",
    permissions: ["WORKSHOP_RESERVATIONS", "FORMATION_RESERVATIONS", "ACTIVITY_SETTLEMENTS", "SEND_TICKET_EMAIL"],
  });
  // A staff account with zero services triggers an "Ajoutez vos services"
  // onboarding card with no skip button, permanently blocking every click —
  // not the Stripe nag dismissOnboardingNag handles. This service is never
  // actually used by an atelier/formation booking; it only satisfies that
  // onboarding gate.
  await createStaffService({ staff: staff.staff, createdByUserId: admin.user.id });
  const workshopCustomer = await seedCustomer({ label: "autoticketworkshop" });
  const formationCustomer = await seedCustomer({ label: "autoticketformation" });

  const { session: workshopSession } = await seedActivitySessionOwnedBy({
    kind: "WORKSHOP",
    createdById: staff.user.id,
    price: 80,
  });
  await seedActivityReservationWithBalance({
    kind: "WORKSHOP",
    session: workshopSession,
    customer: workshopCustomer,
    price: 80,
  });

  const { session: formationSession } = await seedActivitySessionOwnedBy({
    kind: "FORMATION",
    createdById: staff.user.id,
    price: 120,
  });
  await seedActivityReservationWithBalance({
    kind: "FORMATION",
    session: formationSession,
    customer: formationCustomer,
    price: 120,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, staff.credentials);
  await dismissOnboardingNag(page);

  // ── Atelier ──────────────────────────────────────────────────────────
  await page.goto(WORKSHOP_RESERVATIONS_PAGE);
  await dismissOnboardingNag(page);
  const workshopRow = rowFor(page, workshopCustomer.email);
  await expect(workshopRow, "the seeded workshop reservation never showed up").toBeVisible({ timeout: 20_000 });
  // The onboarding nag's Stripe status never completes for a throwaway
  // seeded staff account, so it can re-render between a dismiss and the
  // very next click — clickThroughNag retries until it actually lands.
  await clickThroughNag(page, workshopRow.getByRole("button", { name: /^clôturer$/i }));
  const workshopDialog = page.getByRole("dialog");
  await expect(workshopDialog.getByRole("button", { name: /^clôturer$/i })).toBeVisible({ timeout: 15_000 });
  await clickThroughNag(page, workshopDialog.getByRole("button", { name: /^clôturer$/i }));
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

  const workshopMessage = await waitForEmail({ to: workshopCustomer.email, subject: TICKET_SUBJECT, timeout: 30_000 });
  expect(workshopMessage.Subject).toMatch(TICKET_SUBJECT);

  // ── Formation ────────────────────────────────────────────────────────
  await page.goto(FORMATION_RESERVATIONS_PAGE);
  await dismissOnboardingNag(page);
  const formationRow = rowFor(page, formationCustomer.email);
  await expect(formationRow, "the seeded formation reservation never showed up").toBeVisible({ timeout: 20_000 });
  await clickThroughNag(page, formationRow.getByRole("button", { name: /^clôturer$/i }));
  const formationDialog = page.getByRole("dialog");
  await expect(formationDialog.getByRole("button", { name: /^clôturer$/i })).toBeVisible({ timeout: 15_000 });
  await clickThroughNag(page, formationDialog.getByRole("button", { name: /^clôturer$/i }));
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

  const formationMessage = await waitForEmail({ to: formationCustomer.email, subject: TICKET_SUBJECT, timeout: 30_000 });
  expect(formationMessage.Subject).toMatch(TICKET_SUBJECT);

  await context.close();
});

test("workshop and formation settlement stays silent when the acting staff lacks SEND_TICKET_EMAIL", async ({ browser }) => {
  test.setTimeout(180_000);
  await requireMailpit();

  const admin = await seedAdmin({ label: "noticketactivity" });
  const staff = await seedStaff({
    label: "noticketactivity",
    permissions: ["WORKSHOP_RESERVATIONS", "FORMATION_RESERVATIONS", "ACTIVITY_SETTLEMENTS"],
  });
  await createStaffService({ staff: staff.staff, createdByUserId: admin.user.id });
  const workshopCustomer = await seedCustomer({ label: "noticketworkshop" });
  const formationCustomer = await seedCustomer({ label: "noticketformation" });

  const { session: workshopSession } = await seedActivitySessionOwnedBy({
    kind: "WORKSHOP",
    createdById: staff.user.id,
    price: 80,
  });
  await seedActivityReservationWithBalance({
    kind: "WORKSHOP",
    session: workshopSession,
    customer: workshopCustomer,
    price: 80,
  });

  const { session: formationSession } = await seedActivitySessionOwnedBy({
    kind: "FORMATION",
    createdById: staff.user.id,
    price: 120,
  });
  await seedActivityReservationWithBalance({
    kind: "FORMATION",
    session: formationSession,
    customer: formationCustomer,
    price: 120,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, staff.credentials);
  await dismissOnboardingNag(page);

  await page.goto(WORKSHOP_RESERVATIONS_PAGE);
  await dismissOnboardingNag(page);
  const workshopRow = rowFor(page, workshopCustomer.email);
  await expect(workshopRow).toBeVisible({ timeout: 20_000 });
  await clickThroughNag(page, workshopRow.getByRole("button", { name: /^clôturer$/i }));
  const workshopDialog = page.getByRole("dialog");
  await expect(workshopDialog.getByRole("button", { name: /^clôturer$/i })).toBeVisible({ timeout: 15_000 });
  await clickThroughNag(page, workshopDialog.getByRole("button", { name: /^clôturer$/i }));
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

  await page.goto(FORMATION_RESERVATIONS_PAGE);
  await dismissOnboardingNag(page);
  const formationRow = rowFor(page, formationCustomer.email);
  await expect(formationRow).toBeVisible({ timeout: 20_000 });
  await clickThroughNag(page, formationRow.getByRole("button", { name: /^clôturer$/i }));
  const formationDialog = page.getByRole("dialog");
  await expect(formationDialog.getByRole("button", { name: /^clôturer$/i })).toBeVisible({ timeout: 15_000 });
  await clickThroughNag(page, formationDialog.getByRole("button", { name: /^clôturer$/i }));
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });

  await assertNoEmail({ to: workshopCustomer.email, subject: TICKET_SUBJECT, timeout: 8_000 });
  await assertNoEmail({ to: formationCustomer.email, subject: TICKET_SUBJECT, timeout: 8_000 });

  await context.close();
});
