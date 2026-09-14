import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * The per-staff operations privacy feature: every account (STAFF, ADMIN,
 * OWNER alike) sees only the transactions it personally recorded, on
 * "Mes opérations" and on the admin-only "Opérations" page alike — not even
 * an admin/owner sees another staff member's activity there. Two other
 * pieces of the same change are exercised through a real on-site collection
 * rather than seeded, because both only ever happen inside that action:
 * non-privileged staff get an independently gapless "TS-" ticket series
 * instead of the admin "T-" series, and can never cause a real Invoice to be
 * created, VAT-eligible customer or not — the sale still completes, it
 * simply never gets one.
 *
 * tests/critical/*-contracts.test.js pins all of this at the source level
 * (exact strings, mocked Prisma). None of those can tell whether a real
 * staff login, on a real seeded sale, actually fails to see a colleague's
 * row or actually gets blocked from invoicing — which is the only thing
 * that would tell you privacy actually held.
 */

// Real mod-97 checksum, same number already reused by several specs in this
// suite (see workshop-admin-transfer.spec.mjs) — User.vatNumber carries no
// unique constraint, so reusing it across customers/runs is safe.
const B2B_VAT_NUMBER = "BE0123456749";

async function seedVatEligibleCustomer(label) {
  const customer = await seedCustomer({ label, withAddress: true });
  // vatValidatedAt set directly rather than driven through the VIES
  // verification UI — same shortcut workshop-admin-transfer.spec.mjs takes,
  // for the same reason (this suite's config has no live registry to call).
  await prisma.user.update({
    where: { id: customer.id },
    data: { isCompany: true, vatNumber: B2B_VAT_NUMBER, vatValidatedAt: new Date() },
  });
  return customer;
}

async function collectOnSite(page, { customerEmail, terminalReference }) {
  await page.goto("/dashboard/appointments");
  const row = page.getByRole("row").filter({ hasText: customerEmail });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  console.log(`DEBUG row text for ${terminalReference}:`, await row.innerText());
  // Row actions are a single "Actions du rendez-vous" trigger, not a direct
  // button — "Terminer" is a menuitem inside the dropdown it opens (see
  // AppointmentsPageClient.jsx's getAppointmentMenuItems).
  await row.getByRole("button", { name: "Actions du rendez-vous" }).click();
  const menuItem = row.getByRole("menuitem", { name: /^terminer$/i });
  await expect(menuItem, "no Terminer menuitem found in the opened dropdown").toBeVisible({ timeout: 5_000 });
  console.log(`DEBUG menu items for ${terminalReference}:`, await row.getByRole("menu").innerText());
  await menuItem.click();

  // Two valid outcomes here, both of which reach completeAppointment server
  // side (appointmentCollectsAtCounter only decides whether the client shows
  // a confirmation dialog first — completeAppointment is the actual
  // authority, per its own doc comment): a collection dialog asking for a
  // method and terminal reference, or a direct one-click complete. Only the
  // "did a dialog show up at all" wait is allowed to fail silently — any
  // error filling in a dialog that DID appear must fail the test loudly,
  // not be swallowed as "no dialog".
  const dialog = page.getByRole("dialog");
  const dialogAppeared = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const toast = page.locator("[data-sonner-toast]").first();
  const toastText = await toast
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => toast.innerText())
    .catch(() => null);
  console.log(`DEBUG toast for ${terminalReference}: dialogAppeared=${dialogAppeared} toast=${JSON.stringify(toastText)}`);
  if (dialogAppeared) {
    await dialog.getByRole("combobox").selectOption("EXTERNAL_TERMINAL");
    await dialog.getByLabel(/référence du ticket du terminal/i).fill(terminalReference);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: /encaisser et terminer/i }).click();
  }
}

test.describe("per-staff operations privacy", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("Mes opérations and the admin Opérations page never show another account's transactions — not even to the admin", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "isolation" });
    const staffA = await seedStaff({ label: "isolationa", permissions: ["APPOINTMENTS"] });
    const staffB = await seedStaff({ label: "isolationb", permissions: ["APPOINTMENTS"] });
    const customerA = await seedCustomer({ label: "isolationa" });
    const customerB = await seedCustomer({ label: "isolationb" });

    const { payment: paymentA } = await seedAppointment({
      staff: staffA.staff,
      customer: customerA,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "paid",
      price: 60,
    });
    const { payment: paymentB } = await seedAppointment({
      staff: staffB.staff,
      customer: customerB,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "paid",
      price: 60,
    });

    // seedAppointment's "paid" branch hand-writes the Transaction row without
    // going through the completion action, so it carries no recordedById —
    // set it directly, same as other specs in this suite poking a field the
    // fixture does not expose (see operations-performed-by.spec.mjs's
    // createdByStaffId update).
    await prisma.transaction.updateMany({ where: { paymentId: paymentA.id }, data: { recordedById: staffA.user.id } });
    await prisma.transaction.updateMany({ where: { paymentId: paymentB.id }, data: { recordedById: staffB.user.id } });

    const context = await browser.newContext();
    const page = await context.newPage();

    // ── Staff A sees their own transaction, never staff B's ───────────────
    await loginAs(page, staffA.credentials);
    await page.goto("/dashboard/mes-operations");
    await expect(
      page.getByText(customerA.email, { exact: false }).first(),
      "staff A cannot see their own transaction on Mes opérations",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(customerB.email, { exact: false }),
      "staff A can see staff B's transaction — cross-staff privacy is broken",
    ).toHaveCount(0);

    // ── Staff B: the mirror image ──────────────────────────────────────────
    await loginAs(page, staffB.credentials);
    await page.goto("/dashboard/mes-operations");
    await expect(
      page.getByText(customerB.email, { exact: false }).first(),
      "staff B cannot see their own transaction on Mes opérations",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(customerA.email, { exact: false }),
      "staff B can see staff A's transaction — cross-staff privacy is broken",
    ).toHaveCount(0);

    // ── Admin: the core guarantee this whole feature exists for — sees
    // neither, even on the admin-only Opérations page ─────────────────────
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/operations");
    await expect(page.getByRole("heading", { name: /opérations/i })).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(customerA.email, { exact: false }),
      "admin can see staff A's transaction — the core privacy guarantee is broken",
    ).toHaveCount(0);
    await expect(
      page.getByText(customerB.email, { exact: false }),
      "admin can see staff B's transaction — the core privacy guarantee is broken",
    ).toHaveCount(0);

    await context.close();
  });

  test("a non-privileged staff member's on-site collection gets the TS- ticket series and never creates an Invoice, even for a VAT-eligible customer — an admin's identical collection still gets the T- series and a real Invoice", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const admin = await seedAdmin({ label: "ticketseries" });
    const staff = await seedStaff({ label: "ticketseries", permissions: ["APPOINTMENTS"] });
    const customerForStaff = await seedVatEligibleCustomer("ticketseriesstaff");
    const customerForAdmin = await seedVatEligibleCustomer("ticketseriesadmin");

    // No Payment row yet — same shape as appointment-onsite-collection.spec.mjs.
    // Two separate appointments on the same staff member's book: what decides
    // the ticket series and the invoice outcome is who is *logged in* when
    // "Terminer" is clicked, not whose StaffService the booking belongs to.
    const seededForStaff = await seedAppointment({
      staff: staff.staff,
      customer: customerForStaff,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "none",
      price: 60,
    });
    const seededForAdmin = await seedAppointment({
      staff: staff.staff,
      customer: customerForAdmin,
      createdByUserId: admin.user.id,
      hoursFromNow: -3,
      status: "CONFIRMED",
      payment: "none",
      price: 60,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
    page.on("requestfailed", (req) => console.log(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));
    page.on("response", async (res) => {
      if (res.request().method() === "POST") {
        console.log(`[POST ${res.status()}] ${res.url()}`);
      }
    });

    // ── The non-privileged staff member completes their own collection ────
    await loginAs(page, staff.credentials);
    await collectOnSite(page, { customerEmail: customerForStaff.email, terminalReference: "E2E-ISO-STAFF" });

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({ where: { id: seededForStaff.appointment.id }, select: { status: true } }))
            ?.status,
        { message: "the staff-completed appointment never reached COMPLETED", timeout: 20_000 },
      )
      .toBe("COMPLETED");

    const staffPayment = await prisma.payment.findFirst({
      where: { appointmentId: seededForStaff.appointment.id },
      include: { invoice: true },
    });
    expect(staffPayment, "no payment was recorded for the staff-completed collection").not.toBeNull();
    expect(
      staffPayment.ticketNumber,
      "the staff collection did not get a TS- ticket number",
    ).toMatch(/^TS-\d{4}-\d{6}$/);
    expect(
      staffPayment.invoice,
      "a non-privileged staff member's VAT-eligible sale created a real Invoice — the hard block is broken",
    ).toBeNull();

    // ── An admin completes an otherwise-identical collection ──────────────
    await loginAs(page, admin.credentials);
    await collectOnSite(page, { customerEmail: customerForAdmin.email, terminalReference: "E2E-ISO-ADMIN" });

    await page.waitForTimeout(8_000);
    await page.screenshot({ path: "test-results/debug-admin-8s-later.png", fullPage: true });
    console.log(
      "DEBUG appointment id",
      seededForAdmin.appointment.id,
      JSON.stringify(
        await prisma.appointment.findUnique({
          where: { id: seededForAdmin.appointment.id },
          include: { payment: { include: { transactions: true } } },
        }),
      ),
    );

    await expect
      .poll(
        async () =>
          (await prisma.appointment.findUnique({ where: { id: seededForAdmin.appointment.id }, select: { status: true } }))
            ?.status,
        { message: "the admin-completed appointment never reached COMPLETED", timeout: 20_000 },
      )
      .toBe("COMPLETED");

    const adminPayment = await prisma.payment.findFirst({
      where: { appointmentId: seededForAdmin.appointment.id },
      include: { invoice: true },
    });
    expect(adminPayment, "no payment was recorded for the admin-completed collection").not.toBeNull();
    expect(
      adminPayment.ticketNumber,
      "the admin collection did not stay on the admin T- ticket series",
    ).toMatch(/^T-\d{4}-\d{6}$/);
    expect(
      adminPayment.invoice,
      "an admin's VAT-eligible sale did not create a real Invoice — regression on ordinary invoicing",
    ).not.toBeNull();

    await context.close();
  });
});
