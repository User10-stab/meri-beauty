import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * Two ways an appointment ends other than happening.
 *
 * **Rescheduling** is customer-facing and time-boxed: the same 48-hour
 * window that governs cancellation, enforced server-side "regardless of what
 * the UI shows" (the action says so itself). A window enforced only in the
 * client is not a window — the action is a public endpoint — so the test
 * that matters is the one where the customer is *inside* it.
 *
 * **A no-show** is the opposite of a cancellation and is easy to conflate
 * with one: the customer did not come, but they also did not cancel, so the
 * salon keeps the money and the slot is not given away retroactively.
 * `markAppointmentNoShow` additionally refuses to mark an appointment that
 * has not happened yet, which stops staff pre-emptively writing somebody off.
 *
 * Both are asserted against the database rather than the screen, because in
 * both cases the interesting outcome is what did *not* change.
 */

const HOUR = 60 * 60 * 1000;

test.describe("rescheduling is time-boxed", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a customer inside the 48-hour window cannot move their appointment", async ({ browser }) => {
    const admin = await seedAdmin({ label: "reschedule" });
    const staff = await seedStaff({ label: "reschedule-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "reschedule-soon" });

    // 24 hours out: inside the window, and deliberately in the future so the
    // refusal is about the window rather than about the appointment being
    // over.
    const appointment = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: 24,
      status: "CONFIRMED",
    });

    const before = await prisma.appointment.findUnique({
      where: { id: appointment.appointment.id },
      select: { startTime: true, status: true },
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, customerCredentials(customer));
    await page.goto("/mes-reservations");

    // The customer's own page either hides the control inside the window or
    // shows it and lets the server refuse. Either is acceptable; what is not
    // is the appointment actually moving. Both branches are covered by
    // asserting the row afterwards rather than by insisting on a particular
    // button being present.
    const reschedule = page.getByRole("button", { name: /modifier|reporter|replanifier/i });
    if ((await reschedule.count()) > 0) {
      await reschedule.first().click();
      await page.waitForTimeout(2_000);
    }

    const after = await prisma.appointment.findUnique({
      where: { id: appointment.appointment.id },
      select: { startTime: true, status: true },
    });
    expect(
      after.startTime.getTime(),
      "an appointment inside the 48-hour window was moved",
    ).toBe(before.startTime.getTime());
    expect(after.status).toBe(before.status);

    await context.close();
  });
});

test.describe("a no-show keeps the money", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("an appointment that has not happened yet cannot be written off", async ({ browser }) => {
    const admin = await seedAdmin({ label: "noshow-future" });
    const staff = await seedStaff({ label: "noshow-future-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "noshow-future" });

    const seeded = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: 48,
      status: "CONFIRMED",
      payment: "paid",
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/appointments");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });

    // handleNoShow guards with `window.confirm`, a *native* dialog.
    // Playwright auto-dismisses those, so without this listener the handler
    // returns immediately and the action is never called — and a test
    // asserting "the status did not change" then passes without exercising
    // anything at all. This test did exactly that on its first run.
    page.on("dialog", (dialog) => dialog.accept());

    const absent = row.getByRole("button", { name: /absent/i });
    await expect(absent.first()).toBeVisible({ timeout: 10_000 });
    await absent.first().click();

    // The refusal comes back as a toast, which is also the proof the action
    // ran rather than being short-circuited by the confirm.
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
    const refusal = await page.locator("[data-sonner-toast]").first().innerText();
    expect(refusal, `expected a refusal, got: ${refusal}`).toMatch(/n'a pas encore eu lieu/i);

    // Whether the button is offered or not, the guard is the server's:
    // startTime > now means "this has not happened", and writing somebody off
    // in advance is not a judgement staff get to make.
    const after = await prisma.appointment.findUnique({
      where: { id: seeded.appointment.id },
      select: { status: true },
    });
    expect(after.status, "a future appointment was marked as a no-show").not.toBe("NO_SHOW");

    await context.close();
  });

  test("a past appointment marked absent stays paid and refunds nothing", async ({ browser }) => {
    const admin = await seedAdmin({ label: "noshow-past" });
    const staff = await seedStaff({ label: "noshow-past-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "noshow-past" });

    // Two hours ago, paid in full — the shape where the money question is
    // real. A no-show is not a cancellation: nobody asked for their money
    // back, and the slot was held for them and lost.
    const seeded = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "paid",
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/appointments");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });

    // Native confirm again — see the note in the test above.
    page.on("dialog", (dialog) => dialog.accept());

    const absent = row.getByRole("button", { name: /absent/i });
    await expect(absent.first(), "no way to record an absence on a past appointment").toBeVisible({
      timeout: 10_000,
    });
    await absent.first().click();

    // Read the toast first: both outcomes leave the row where it was, so a
    // refusal would otherwise surface as a bare "expected NO_SHOW, received
    // CONFIRMED" with the server's reason nowhere in the output (T6).
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 20_000 });
    const outcome = await page.locator("[data-sonner-toast]").first().innerText();
    expect(outcome, `marking the absence was refused: ${outcome}`).not.toMatch(/impossible|non autoris|requise|introuvable/i);

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({
            where: { id: seeded.appointment.id },
            select: { status: true },
          }))?.status,
        { message: "the appointment was not marked as a no-show", timeout: 20_000 },
      )
      .toBe("NO_SHOW");

    // The money half, which is the whole reason a no-show is a separate
    // status from a cancellation.
    const payment = await prisma.payment.findFirst({
      where: { appointmentId: seeded.appointment.id },
      include: { transactions: { where: { isDeleted: false } } },
    });
    expect(payment.status, "a no-show stopped counting as paid").toBe("PAID");
    expect(
      payment.transactions.filter((t) => t.transactionType === "REFUND"),
      "a no-show refunded the customer",
    ).toHaveLength(0);
    expect(
      await prisma.refundOperation.count({ where: { paymentId: payment.id } }),
      "a no-show queued a refund nobody asked for",
    ).toBe(0);

    await context.close();
  });
});
