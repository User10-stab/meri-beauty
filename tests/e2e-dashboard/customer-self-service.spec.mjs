import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * /mes-reservations — what a customer can see and do about their own bookings.
 *
 * Two things are being checked, and they fail in opposite directions.
 *
 * Scoping: this page is the only place a customer's own money and
 * appointments are exposed to them, so it must show theirs and nothing else.
 *
 * The 48-hour boundary: inside the window a customer may no longer cancel
 * themselves, and the page must not pretend otherwise. What it offers instead
 * is a *request* — which explicitly does not cancel the appointment and does
 * not commit anyone to a refund. Getting that wrong in the reassuring
 * direction (a customer believing they are cancelled and refunded when they
 * are neither) is the expensive failure, so the assertions below check the
 * appointment is left untouched as carefully as they check the request was
 * recorded.
 */

const MY_RESERVATIONS = "/mes-reservations";

test.describe("the customer reservations page", () => {
  test.describe.configure({ mode: "serial" });

  let adminId;

  test.beforeAll(async () => {
    const admin = await prisma.user.findFirst({
      where: { id: (await seedAdmin({ label: "selfservice" })).user.id },
      select: { id: true },
    });
    if (!admin) throw new Error("The seeded admin account is missing — run prisma/seed.mjs.");
    adminId = admin.id;
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("an anonymous visitor is sent to log in and brought back afterwards", async ({ page }) => {
    await page.goto(MY_RESERVATIONS);
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fmes-reservations|\/login\?callbackUrl=\/mes-reservations/);
  });

  test("a staff member is sent to the dashboard, not to a customer page", async ({ browser }) => {
    const staff = await seedStaff({ label: "selfservice-staff", permissions: ["APPOINTMENTS"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, staff.credentials);

    await page.goto(MY_RESERVATIONS);
    await expect(page).toHaveURL(/\/dashboard/);

    await context.close();
  });

  test("a customer sees their own booking and not somebody else's", async ({ browser }) => {
    // Two *different* staff members, because the card never shows the
    // customer's own name — it is their page, so the only thing on screen
    // that distinguishes one booking from another is who it is with.
    const myStaff = await seedStaff({ label: "selfservice-owner-mine", permissions: ["APPOINTMENTS"] });
    const otherStaff = await seedStaff({ label: "selfservice-owner-theirs", permissions: ["APPOINTMENTS"] });
    const mine = await seedCustomer({ label: "selfservice-mine" });
    const theirs = await seedCustomer({ label: "selfservice-theirs" });

    await seedAppointment({ staff: myStaff.staff, customer: mine, createdByUserId: adminId, hoursFromNow: 72 });
    await seedAppointment({ staff: otherStaff.staff, customer: theirs, createdByUserId: adminId, hoursFromNow: 72 });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, customerCredentials(mine));
    await page.goto(MY_RESERVATIONS);

    await expect(page.getByText(myStaff.user.fullName).first()).toBeVisible();
    await expect(page.getByText(otherStaff.user.fullName)).toHaveCount(0);

    await context.close();
  });

  test("inside the 48-hour window, a request is offered — and it cancels nothing", async ({ browser }) => {
    const staff = await seedStaff({ label: "selfservice-window", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "selfservice-window-client" });
    const { appointment } = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: adminId,
      hoursFromNow: 24, // inside the window
      // A recorded deposit: the request path refuses outright when nothing
      // was actually collected, since there would be nothing to decide about.
      payment: "balanceDue",
      price: 80,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, customerCredentials(customer));
    await page.goto(MY_RESERVATIONS);

    // Self-service cancellation is off the table this close to the
    // appointment; what is offered is a review.
    await page.getByRole("button", { name: /demander un examen exceptionnel/i }).click();

    const send = page.getByRole("button", { name: /envoyer la demande/i });
    // A reason under 10 characters is not a reason.
    await expect(send).toBeDisabled();

    await page.getByPlaceholder(/maladie soudaine/i).fill("Je suis malade et je ne peux pas me déplacer.");
    await expect(send).toBeEnabled();
    await send.click();

    // Polled: the action runs, then notifies admins and sends e-mail before
    // the page settles, so the row can land a moment after the click.
    const request = await expect
      .poll(
        () =>
          prisma.appointmentCancellationRequest.findUnique({
            where: { appointmentId: appointment.id },
            select: { status: true, requestedByUserId: true, reviewedAt: true },
          }),
        { timeout: 20_000, message: "no cancellation request was recorded" },
      )
      .not.toBeNull()
      .then(() =>
        prisma.appointmentCancellationRequest.findUnique({
          where: { appointmentId: appointment.id },
          select: { status: true, requestedByUserId: true, reviewedAt: true },
        }),
      );

    expect(request.status).toBe("PENDING");
    expect(request.requestedByUserId).toBe(customer.id);
    expect(request.reviewedAt).toBeNull();

    // The half that matters most: asking is not getting.
    const after = await prisma.appointment.findUnique({
      where: { id: appointment.id },
      select: { status: true, cancelledAt: true },
    });
    expect(after.status, "the appointment was cancelled by merely requesting it").toBe("CONFIRMED");
    expect(after.cancelledAt).toBeNull();

    // No refund is set in motion either — no operation, no leg, nothing.
    expect(
      await prisma.refundOperation.count({ where: { payment: { appointmentId: appointment.id } } }),
      "a refund was started by a request nobody has approved",
    ).toBe(0);
    expect(
      await prisma.transaction.count({
        where: { payment: { appointmentId: appointment.id }, transactionType: "REFUND" },
      }),
    ).toBe(0);

    // Somebody has to know it is waiting.
    expect(
      await prisma.notification.count({
        where: { appointmentId: appointment.id, type: "APPOINTMENT_CANCELLATION_REQUEST" },
      }),
      "no admin notification was raised for the pending request",
    ).toBeGreaterThan(0);

    await context.close();
  });
});
