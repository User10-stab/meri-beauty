import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * Finishing a rendez-vous, where finishing it collects money.
 *
 * A deposit-paid appointment has a balance owed at the counter, and marking
 * it complete is what records that balance as received — real, invoiceable
 * revenue. The system cannot observe a cash handoff or a terminal's
 * "APPROUVÉ" screen, so the only thing standing between "staff clicked a
 * button" and "the books say we were paid" is an explicit human confirmation.
 *
 * That confirmation is enforced twice, and both halves matter for different
 * reasons: the checkbox stops an accidental click, and the server check
 * (`paymentConfirmed !== true`) stops everything else. This exercises the
 * first through the UI and asserts the ledger it produces.
 *
 * CARD is used throughout rather than CASH on purpose — settling in cash
 * pulls in the open-till machinery, which is a different subject with its own
 * spec (caisse-till-session.spec.mjs) and its own global-resource problem.
 */

const APPOINTMENTS_PAGE = "/dashboard/appointments";

/** The row for one customer's appointment in the list. */
function rowFor(page, customerName) {
  return page.locator("tr").filter({ hasText: customerName }).first();
}

test.describe("completing an appointment that still owes money", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let adminId;

  test.beforeAll(async ({ browser }) => {
    // This file's own admin, not the shared admin@meribeauty.com. Both e2e
    // suites used to borrow that one account and share its 10-per-5-minutes
    // login budget, which produced a failure that looked like a flake (T1c).
    const admin = await seedAdmin({ label: "appointments" });
    adminId = admin.user.id;

    // Still one login for the file: a per-file bucket is not a licence to
    // sign in per test.
    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("the balance cannot be taken until someone confirms the money arrived", async () => {
    const staff = await seedStaff({ label: "rdv-owner", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "rdv-balance" });
    const { appointment } = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: adminId,
      hoursFromNow: -2, // already happened; a future one cannot be completed at all
      payment: "balanceDue",
      price: 60,
    });

    await page.goto(APPOINTMENTS_PAGE);
    await rowFor(page, customer.fullName).getByRole("button", { name: /^terminer$/i }).click();

    // A balance is owed, so this opens the collection dialog rather than
    // completing outright. Everything below is scoped to that dialog: the
    // page itself carries status and staff filter dropdowns, so an unscoped
    // getByRole("combobox") is ambiguous.
    const dialog = page.getByRole("dialog");
    const confirmButton = dialog.getByRole("button", { name: /encaisser et terminer/i });
    await expect(confirmButton).toBeVisible();
    await expect(confirmButton, "the balance could be taken without confirming it arrived").toBeDisabled();

    // Nothing has been recorded yet.
    const before = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { status: true },
    });
    expect(before.status).toBe("CONFIRMED");

    // Card is accepted only as EXTERNAL_TERMINAL now, and the terminal's
    // receipt reference is required with it — a bare card collection carried
    // no evidence tying it to a real charge.
    await dialog.getByRole("combobox").selectOption("EXTERNAL_TERMINAL");
    await dialog.getByLabel(/référence du ticket du terminal/i).fill("E2E-TERM-GUARD");
    await dialog.getByRole("checkbox").check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // The dialog closes on failure just as it does on success, so waiting for
    // it to disappear says nothing. The toast carries the server's answer —
    // read it, so a refusal shows up here as its own message rather than as a
    // mystified "status is still CONFIRMED" further down.
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 20_000 });
    const toastText = await toast.innerText();
    expect(toastText, `completing the appointment was refused: ${toastText}`).toMatch(/termin/i);

    const after = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { status: true, payment: { select: { status: true, paidAmount: true, remainingAmount: true } } },
    });
    expect(after.status).toBe("COMPLETED");
    expect(after.payment.status).toBe("PAID");
    expect(Number(after.payment.paidAmount)).toBe(60);

    // The balance has to be recorded as a transaction, not merely as a
    // status: the status is what a screen shows, the transaction is what the
    // books add up.
    const settlement = await prisma.transaction.findFirst({
      where: { payment: { appointmentId: appointment.id }, transactionType: "FINAL_PAYMENT", isDeleted: false },
      select: { amount: true, method: true, pieceNumber: true },
    });
    expect(settlement, "no FINAL_PAYMENT transaction was written for the balance").not.toBeNull();
    expect(Number(settlement.amount)).toBe(30);
    expect(settlement.method).toBe("CARD");
    // Card money never enters the drawer, so it must not consume a cash-book
    // line number.
    expect(settlement.pieceNumber).toBeNull();
  });

  test("an appointment that has not happened yet cannot be completed", async () => {
    const staff = await seedStaff({ label: "rdv-future", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "rdv-future-client" });
    const { appointment } = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: adminId,
      hoursFromNow: 48,
      payment: "balanceDue",
    });

    await page.goto(APPOINTMENTS_PAGE);
    await rowFor(page, customer.fullName).getByRole("button", { name: /^terminer$/i }).click();

    const dialog = page.getByRole("dialog");
    const confirmButton = dialog.getByRole("button", { name: /encaisser et terminer/i });
    await expect(confirmButton).toBeVisible();
    await dialog.getByRole("checkbox").check();
    await confirmButton.click();

    // The refusal comes from the server — the dialog offers no hint that this
    // appointment is in the future.
    await expect(page.getByText(/n'a pas encore eu lieu/i)).toBeVisible({ timeout: 20_000 });

    const after = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { status: true },
    });
    expect(after.status).toBe("CONFIRMED");

    // "No new money", not "no money": the seed records the deposit the
    // customer really did pay online, so counting *all* transactions here
    // asserts the wrong thing. What must not appear is a settlement of the
    // balance for a service nobody has received yet.
    expect(
      await prisma.transaction.count({
        where: {
          payment: { appointmentId: appointment.id },
          transactionType: { in: ["FINAL_PAYMENT", "REFUND"] },
        },
      }),
      "the balance was collected for an appointment that has not happened",
    ).toBe(0);
  });
});

test.describe("a staff member's book is their own", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("the appointments list shows only their appointments", async ({ browser }) => {
    // getAllAppointments narrows STAFF to `staffService.staffId = their own`,
    // while admins see everything. Worth checking at runtime rather than by
    // reading: the narrowing lives in a branch that an admin session never
    // executes, so every manual check by whoever built it passes trivially.
    // This describe block has its own admin. `adminId` above belongs to the
    // other block's scope — reaching for it from here is a ReferenceError,
    // which is how this failed once. Seeding is also the honest thing: the
    // account is only needed as the author of the two appointments below.
    const admin = (await seedAdmin({ label: "books" })).user;

    const mine = await seedStaff({ label: "book-mine", permissions: ["APPOINTMENTS"] });
    const theirs = await seedStaff({ label: "book-theirs", permissions: ["APPOINTMENTS"] });
    const myClient = await seedCustomer({ label: "book-my-client" });
    const theirClient = await seedCustomer({ label: "book-their-client" });

    await seedAppointment({ staff: mine.staff, customer: myClient, createdByUserId: admin.id });
    await seedAppointment({ staff: theirs.staff, customer: theirClient, createdByUserId: admin.id });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, mine.credentials);
    await page.goto(APPOINTMENTS_PAGE);

    await expect(page.getByText(myClient.fullName).first()).toBeVisible();
    await expect(page.getByText(theirClient.fullName)).toHaveCount(0);

    await context.close();
  });
});
