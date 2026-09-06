import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * A price changed at the counter has to be findable afterwards.
 *
 * Every other row in Opérations is anchored to money that moved. A price
 * adjustment need not move any: lowering the total of a booking that already
 * paid its deposit writes off the balance and collects nothing. That is a
 * real commercial decision — money the salon chose not to take — and until
 * the ADJUSTMENT arm existed it lived only in the audit log, invisible on the
 * one screen anyone reconciles against.
 *
 * The scenario is deliberately the *no money* case, because the paying case
 * was already visible: it writes a Transaction, and a transaction always had
 * a row. If this passes, both halves are covered.
 *
 * Driven through the caisse rather than the appointments list, because that
 * is where the price field lives — the list's "Terminer" dialog only chooses
 * a payment method. Nothing is collected here, so no till session is touched.
 */

const PRICE = 80;
const DEPOSIT = 40;

test.describe("a price adjustment reaches Opérations", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("writing off a balance shows up even though no money moved", async ({ browser }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "adjust" });
    const staff = await seedStaff({ label: "adjust-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "adjust" });

    // A deposit paid online, a balance outstanding, and in the past so it can
    // be closed out at all. CONFIRMED is what the counter search looks for.
    const seeded = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: PRICE,
    });

    const before = await prisma.payment.findFirst({
      where: { appointmentId: seeded.appointment.id },
      select: { totalAmount: true, paidAmount: true, remainingAmount: true },
    });
    expect(Number(before.totalAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(before.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(
      Number(before.remainingAmount),
      "the fixture left nothing outstanding, so there is no balance to write off",
    ).toBeGreaterThan(0);

    expect(
      await prisma.auditLog.count({
        where: { action: "reservation.price_adjusted", entityId: seeded.appointment.id },
      }),
    ).toBe(0);

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/point-of-sale");

    // Searching by a value drops the "today only" window, so a name is enough.
    // Matched loosely: the counter's one search box has been reworded once
    // already, and a test that pins its exact copy fails on a wording change
    // rather than on the behaviour it is here to protect.
    await page.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(customer.fullName);
    // The counter searches on submit, not as you type — filling the box alone
    // leaves the results empty and the failure then reads as "the booking was
    // not found" rather than "nothing was searched for".
    await page.getByRole("button", { name: /^rechercher$/i }).click();

    const result = page.getByRole("button").filter({ hasText: customer.fullName });
    await expect(result.first(), "the counter search did not find the booking").toBeVisible({
      timeout: 20_000,
    });
    await result.first().click();

    // ── Write the balance off ────────────────────────────────────────────
    // Dropping the total to exactly what was already paid collects nothing.
    // The server refuses to go *below* it — that would be a refund, and
    // refunds have their own path with their own correcting document.
    const priceField = page.getByLabel(/prix final/i);
    await expect(priceField, "the settle panel never opened").toBeVisible({ timeout: 20_000 });
    await priceField.fill(String(DEPOSIT));
    await page.getByPlaceholder(/raison obligatoire/i).fill("Test e2e — geste commercial");

    const confirm = page.getByRole("button", { name: /clôturer|encaisser et facturer/i });
    await expect(confirm.first()).toBeEnabled({ timeout: 10_000 });
    await confirm.first().click();

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({
            where: { id: seeded.appointment.id },
            select: { status: true },
          }))?.status,
        { message: "the booking was not closed out", timeout: 25_000 },
      )
      .toBe("COMPLETED");

    // ── The adjustment was recorded, with a reason and an author ─────────
    const log = await prisma.auditLog.findFirst({
      where: { action: "reservation.price_adjusted", entityId: seeded.appointment.id },
    });
    expect(log, "the price changed with no audit trail").not.toBeNull();
    expect(Number(log.before.totalAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(log.after.totalAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(log.metadata.reason).toMatch(/geste commercial/i);
    expect(log.actorId, "nobody is named against the price change").toBe(admin.user.id);

    // ── And no money moved, which is why this needed its own arm ─────────
    const payment = await prisma.payment.findFirst({
      where: { appointmentId: seeded.appointment.id },
      include: { transactions: { where: { isDeleted: false } } },
    });
    expect(Number(payment.totalAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(Number(payment.remainingAmount)).toBeCloseTo(0, 2);
    // The seeded deposit is the only collection there has ever been.
    expect(
      payment.transactions,
      "a collection was recorded for a write-off that took no money",
    ).toHaveLength(1);
    expect(payment.transactions[0].transactionType).toBe("DEPOSIT");

    // ── The whole point: it is on the screen ─────────────────────────────
    await page.goto("/dashboard/operations");
    const mine = page
      .getByRole("row")
      .filter({ hasText: customer.email })
      .filter({ hasText: /ajustement de prix/i });
    await expect(
      mine.first(),
      "the price adjustment does not appear in Opérations at all",
    ).toBeVisible({ timeout: 30_000 });

    // Readable, not merely present: before → after and the reason. A row that
    // only says "adjustment" sends the reader back to the audit log, which is
    // where this already was.
    await expect(mine.first()).toContainText(/80/);
    await expect(mine.first()).toContainText(/40/);
    await expect(mine.first()).toContainText(/geste commercial/i);

    await context.close();
  });
});
