import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import {
  seedAdmin,
  seedStaff,
  seedAppointment,
  seedStockedVariant,
  seedOrder,
  seedFormationReservation,
} from "./fixtures/seed-dashboard.mjs";

/**
 * "Réalisé par" — the Opérations tab now shows which staff/admin account a
 * sale's revenue belongs to, not just the client and the amount. Three
 * sources carry a real link (Order.createdByStaff, Appointment via
 * StaffService.staff, Formation via the Animator/staff e-mail bridge
 * resolveFormationAnimatorId already maintains for commission); a
 * self-service order (no staff at all) gets its own explicit label rather
 * than looking like the attribution was never loaded.
 *
 * tests/critical/operations-performed-by-contracts.test.js pins the select
 * shapes and helper wiring at the source level. It cannot tell whether a
 * real page, for a real seeded sale, actually renders the right name —
 * which is the only thing anyone looking at Opérations would notice.
 */

const OPERATIONS_PAGE = "/dashboard/operations";

function rowFor(page, text) {
  return page.locator("tr").filter({ hasText: text }).first();
}

test.describe("Opérations shows who on staff/admin side each sale belongs to", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("an appointment, a staff-attributed order, a self-service order, and a formation each show the right attribution", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const admin = await seedAdmin({ label: "performedby" });
    const staff = await seedStaff({ label: "performedby", permissions: ["APPOINTMENTS", "ORDERS", "FORMATIONS"] });
    const customerA = await seedCustomer({ label: "performedbya" });
    const customerB = await seedCustomer({ label: "performedbyb" });
    const customerC = await seedCustomer({ label: "performedbyc" });
    // A distinct 4th customer for the formation case — reusing one of the
    // above would make its e-mail match two rows in the unified Transactions
    // tab (sourceTypes: null merges every source), and `.first()` would pick
    // whichever sorts newer instead of the one this assertion means to check.
    const customerD = await seedCustomer({ label: "performedbyd" });
    const staffLabel = `Personnel — ${staff.user.fullName}`;

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);

    // ── Appointment: attributed via StaffService.staff ────────────────────
    const { appointment } = await seedAppointment({
      staff: staff.staff,
      customer: customerA,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "paid",
      price: 60,
    });
    expect(appointment).toBeTruthy();

    await page.goto(OPERATIONS_PAGE);
    const appointmentRow = rowFor(page, customerA.email);
    await expect(appointmentRow, "the seeded appointment never showed up in Opérations").toBeVisible({ timeout: 30_000 });
    await expect(appointmentRow).toContainText(staffLabel);

    // ── Order, staff-attributed: simulate a counter sale ───────────────────
    // seedOrder has no createdByStaffId param, so it's set directly — same
    // as other specs poking a field the fixture doesn't expose.
    const { variant } = await seedStockedVariant({ label: "performedby1" });
    const staffOrder = await seedOrder({ variant, customer: customerB, status: "READY_FOR_PICKUP", payment: "paid" });
    await prisma.order.update({ where: { id: staffOrder.id }, data: { createdByStaffId: staff.user.id } });

    await page.goto(`${OPERATIONS_PAGE}?tab=orders`);
    const staffOrderRow = rowFor(page, customerB.email);
    await expect(staffOrderRow, "the staff-attributed order never showed up in Commandes").toBeVisible({ timeout: 30_000 });
    await expect(staffOrderRow).toContainText(staffLabel);

    // ── Order, self-service: no staff involved at all ──────────────────────
    const { variant: variant2 } = await seedStockedVariant({ label: "performedby2" });
    await seedOrder({ variant: variant2, customer: customerC, status: "READY_FOR_PICKUP", payment: "paid" });

    await page.goto(`${OPERATIONS_PAGE}?tab=orders`);
    const selfServiceRow = rowFor(page, customerC.email);
    await expect(selfServiceRow, "the self-service order never showed up in Commandes").toBeVisible({ timeout: 30_000 });
    await expect(selfServiceRow).toContainText("Achat en ligne (client)");
    await expect(selfServiceRow, "a self-service order must not show a staff name").not.toContainText(staff.user.fullName);

    // ── Formation: assigned to this staff member via the real dashboard form ─
    const formationTitle = `E2E Performed By ${runId}`;
    await page.goto("/dashboard/formations");
    await page.getByRole("button", { name: "Nouvelle formation" }).click();
    await expect(page.getByRole("heading", { name: "Nouvelle formation" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Privée (1 personne)" }).click();
    await page.getByPlaceholder("ex. Formation Extension de Cils").fill(formationTitle);
    await page.locator('label:has-text("Tarif TTC") + div input').fill("200");
    await page.locator('label:has-text("Durée (min)") + div input').fill("180");
    await page.locator('label:text-is("Formateur") + select').selectOption(staff.user.id);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('label:has-text("Date de début") + input').fill(tomorrow);
    await page.getByRole("button", { name: "Créer la formation" }).click();

    const formation = await expect
      .poll(() => prisma.formation.findFirst({ where: { title: formationTitle }, include: { sessions: true, animator: true } }), {
        message: "the formation was never created",
        timeout: 20_000,
      })
      .not.toBeNull()
      .then(() => prisma.formation.findFirst({ where: { title: formationTitle }, include: { sessions: true, animator: true } }));
    expect(formation.animator?.email, "the formation was not assigned the staff member's Animator profile").toBe(
      staff.user.email,
    );

    await seedFormationReservation({ session: formation.sessions[0], customer: customerD, price: 200 });

    await page.goto(`${OPERATIONS_PAGE}?tab=formations`);
    const formationRow = rowFor(page, formationTitle);
    await expect(formationRow, "the seeded formation reservation never showed up in Formations").toBeVisible({
      timeout: 30_000,
    });
    await expect(formationRow).toContainText(staffLabel);

    // ── Same attribution reaches the detail drawer, not just the row ──────
    // Back on the Transactions tab: the page navigated to Formations above,
    // so the appointment row has to be re-located against the current DOM.
    await page.goto(OPERATIONS_PAGE);
    const appointmentRowAgain = rowFor(page, customerA.email);
    await expect(appointmentRowAgain).toBeVisible({ timeout: 20_000 });
    await appointmentRowAgain.getByRole("button", { name: /voir.*gérer/i }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Réalisé par")).toBeVisible({ timeout: 20_000 });
    await expect(drawer.getByText(staffLabel)).toBeVisible();

    await context.close();
  });
});
