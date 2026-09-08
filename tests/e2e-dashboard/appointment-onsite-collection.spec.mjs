import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * The appointment nobody paid for online.
 *
 * A Payment row is only created when money is taken online at booking —
 * `shouldCreatePaymentRecord` in lib/reservation-payment.js is literally
 * `requiresOnlinePaymentNow`. Booking "payer au salon", MANUAL confirmation
 * mode, and staff-created appointments all produce none. Measured on the dev
 * database when this was found: **55 of 103 upcoming CONFIRMED appointments
 * had no Payment row.**
 *
 * Completing one used to write a single status change and nothing else. No
 * Transaction, no cash-book piece number, no till-session link, no invoice —
 * and so no row in Opérations, nothing in the Z-closure, and no record
 * anywhere that the service had been paid for. The screen took the silent
 * path because `a.paymentStatus` was undefined, so it never asked for a
 * payment method and the server never collected.
 *
 * These scenarios are about the money, not the status. The status half was
 * never broken: the appointment went to COMPLETED before this change too.
 * What was missing is everything that makes the revenue real, which is why
 * every assertion below is on a row nobody could see.
 *
 * **CARD, not CASH, on purpose.** A CASH collection attaches itself to
 * whatever till session happens to be open and allocates a cash-book piece
 * number, and the open session belongs to the salon, not to this suite —
 * writing a seeded €60 into it would leave a real Z-closure €60 out. The
 * CASH branch is asserted at source level in
 * tests/critical/appointment-counter-collection-contracts.test.js instead.
 */

const PRICE = 60;
const TERMINAL_REF = "E2E-TERM-0042";

test.describe("an appointment paid at the counter", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("completing it records the money and reaches Opérations", async ({ browser }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "onsite" });
    const staff = await seedStaff({ label: "onsite-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "onsite" });

    // Two hours ago, confirmed, and — the whole point — no Payment row.
    const seeded = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "none",
      price: PRICE,
    });

    expect(
      await prisma.payment.findFirst({ where: { appointmentId: seeded.appointment.id } }),
      "the fixture already had a Payment row, so this is not the case under test",
    ).toBeNull();

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/appointments");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });

    await row.getByRole("button", { name: /^terminer$/i }).click();

    // The regression, stated as an assertion: "Terminer" used to complete
    // this appointment on the spot, with no dialog and no collection. If the
    // dialog does not open, the money is about to go unrecorded again.
    const dialog = page.getByRole("dialog");
    await expect(dialog, "Terminer completed silently — nothing was collected").toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog).toContainText(/encaisser le paiement/i);
    // The full quoted price, not a balance. With no Payment row both
    // totalAmount and paidAmount are null, and the old expression collapsed
    // to zero — the dialog would have offered to collect nothing.
    await expect(dialog, "the dialog did not offer the full quoted price").toContainText(
      `€${PRICE.toFixed(2)}`,
    );

    // Card is only accepted as EXTERNAL_TERMINAL now: the terminal receipt
    // reference is what ties the row to a real charge, so the dialog will not
    // let the collection through without one.
    await dialog.getByRole("combobox").selectOption("EXTERNAL_TERMINAL");
    await dialog.getByLabel(/référence du ticket du terminal/i).fill(TERMINAL_REF);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: /encaisser et terminer/i }).click();

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({
            where: { id: seeded.appointment.id },
            select: { status: true },
          }))?.status,
        { message: "the appointment was not completed", timeout: 20_000 },
      )
      .toBe("COMPLETED");

    // ── The Payment row that did not exist a moment ago ───────────────────
    const payment = await prisma.payment.findFirst({
      where: { appointmentId: seeded.appointment.id },
      include: { transactions: { where: { isDeleted: false } } },
    });
    expect(payment, "the service was completed with no payment recorded at all").not.toBeNull();
    expect(payment.status).toBe("PAID");
    expect(payment.paymentType).toBe("ON_SITE");
    expect(Number(payment.totalAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(payment.paidAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(payment.remainingAmount)).toBeCloseTo(0, 2);
    expect(payment.paidAt, "a paid payment with no paidAt is not a collection").not.toBeNull();

    // ── The transaction is what Opérations is built on ────────────────────
    expect(payment.transactions, "no transaction — the money is still invisible").toHaveLength(1);
    const collection = payment.transactions[0];
    expect(collection.transactionType).toBe("FINAL_PAYMENT");
    // EXTERNAL_TERMINAL is an input token; the ledger stores CARD.
    expect(collection.method).toBe("CARD");
    expect(
      collection.manualReference,
      "the card collection kept no terminal reference, so nothing ties it to a real charge",
    ).toBe(TERMINAL_REF);
    expect(Number(collection.amount)).toBeCloseTo(PRICE, 2);
    expect(collection.paidAt).not.toBeNull();
    // A card collection is not a till movement: no piece number, no session.
    expect(collection.pieceNumber, "a card payment took a cash-book line number").toBeNull();
    expect(collection.cashSessionId, "a card payment was attached to a till session").toBeNull();

    // ── And the thing that was actually reported: it shows up ─────────────
    //
    // The Opérations appointment arm selects FROM "Transaction", so this row
    // exists only because the collection above does. Asserted through the
    // screen rather than the query, because "it doesn't show up in
    // Opérations" is the symptom a person sees.
    await page.goto("/dashboard/operations");
    await expect(
      page.getByText(customer.email, { exact: false }).first(),
      "the completed appointment still does not appear in Opérations",
    ).toBeVisible({ timeout: 30_000 });

    await context.close();
  });

  test("a free appointment still completes in one click", async ({ browser }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "onsite-free" });
    const staff = await seedStaff({ label: "onsite-free-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "onsite-free" });

    // The other direction. Charging nothing is a real case — a courtesy
    // touch-up, a redo — and it must not grow a payment dialog just because
    // there is no Payment row. This is why the predicate tests the price
    // rather than merely the absence of a payment.
    const seeded = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: -3,
      status: "CONFIRMED",
      payment: "none",
      price: 0,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/appointments");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole("button", { name: /^terminer$/i }).click();

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({
            where: { id: seeded.appointment.id },
            select: { status: true },
          }))?.status,
        { message: "a free appointment could not be completed without a payment dialog", timeout: 20_000 },
      )
      .toBe("COMPLETED");

    // Nothing collected, because nothing was owed. A €0 transaction would be
    // worse than none: it would put a meaningless line in Opérations and,
    // for cash, consume a cash-book piece number.
    const payment = await prisma.payment.findFirst({
      where: { appointmentId: seeded.appointment.id },
    });
    expect(payment, "a free appointment invented a payment").toBeNull();

    await context.close();
  });
});
