import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStaff, seedFormationReservation } from "./fixtures/seed-dashboard.mjs";

/**
 * A staff member assigned to a formation earns commission on it, exactly as
 * they do on an appointment.
 *
 * Formation revenue was previously invisible to Staff Performance: a
 * FormationSession is assigned an Animator, not a Staff row, and nothing
 * attributed that money back to a practitioner. The fix is the same bridge
 * create-formation.js's resolveFormationAnimatorId() already maintains for
 * dashboard visibility — assigning a staff member to a formation upserts an
 * Animator with that staff member's email — read the other direction in
 * getStaffPerformance().
 *
 * This test drives the real assignment through the dashboard UI (proving the
 * Animator upsert actually fires from the form, not just in isolation), then
 * seeds the paid, completed reservation directly — the same way
 * seedAppointment's `payment: "paid"` branch skips Stripe, because what is
 * under test is attribution and display, not checkout.
 */
const PRICE = 200;

test.describe("a staff member's formation revenue", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("counts toward their commission on the Performance page, like an appointment does", async ({ browser }) => {
    test.setTimeout(120_000);

    const runId = getRunId();
    const admin = await seedAdmin({ label: "formation-commission" });
    const staff = await seedStaff({ label: "formation-commission", permissions: ["FORMATIONS"] });
    const customer = await seedCustomer({ label: "formation-commission" });
    const formationTitle = `E2E Formation Commission ${runId}`;

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);

    // ── Assign the staff member to a formation, through the real form ─────
    await page.goto("/dashboard/formations");
    await page.getByRole("button", { name: "Nouvelle formation" }).click();

    const dialog = page.getByRole("heading", { name: "Nouvelle formation" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // PRIVATE: capacity is forced to 1 and its input disabled, so there is
    // nothing else to fill for capacity.
    await page.getByRole("button", { name: "Privée (1 personne)" }).click();
    await page.getByPlaceholder("ex. Formation Extension de Cils").fill(formationTitle);
    await page.locator('label:has-text("Tarif TTC") + div input').fill(String(PRICE));
    await page.locator('label:has-text("Durée (min)") + div input').fill("180");

    // Formateur select — the label is a plain sibling, not a <label for>, so
    // it is targeted by adjacent-sibling CSS rather than getByLabel.
    await page.locator('label:text-is("Formateur") + select').selectOption(staff.user.id);

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator('label:has-text("Date de début") + input').fill(tomorrow);

    await page.getByRole("button", { name: "Créer la formation" }).click();

    // The regression this half guards: assigning staff in the dashboard used
    // to be disconnected from the Animator directory a formation actually
    // stores. If this upsert did not fire, there is nothing for
    // getStaffPerformance to bridge back to this staff member later.
    await expect
      .poll(
        () => prisma.formation.count({ where: { title: formationTitle } }),
        { message: "the formation was never created", timeout: 20_000 },
      )
      .toBe(1);
    const formation = await prisma.formation.findFirst({
      where: { title: formationTitle },
      include: { sessions: true, animator: true },
    });

    expect(formation.animator?.email, "the formation was not assigned the staff member's Animator profile").toBe(
      staff.user.email,
    );
    expect(formation.sessions, "no session was created for the formation").toHaveLength(1);
    const session = formation.sessions[0];
    expect(session.animatorId, "the session did not inherit the assigned animator").toBe(formation.animatorId);

    // ── A completed, paid booking on that session — seeded directly ───────
    await seedFormationReservation({ session, customer, price: PRICE });

    // ── It reaches Staff Performance, combined with appointment commission ─
    await page.goto("/dashboard/staff/performance");
    // Scoped to <main>: the header also has a combobox (language switcher).
    await page.getByRole("main").getByRole("combobox").selectOption("all");

    const row = page.getByRole("row").filter({ hasText: staff.user.email });
    await expect(row, "the assigned staff member does not appear on the Performance page").toHaveCount(1, {
      timeout: 20_000,
    });

    // Column order per StaffPerformanceClient.jsx: Staff, Contrat, RDV
    // effectués, Formations effectuées, Annulés/No-show, À venir, CA généré,
    // Encaissé, À reverser.
    const cells = row.getByRole("cell");
    await expect(cells.nth(3), "the completed formation was not counted").toHaveText("1");
    await expect(cells.nth(6), "formation revenue did not reach the combined CA généré total").toHaveText(
      `${PRICE.toFixed(2)} €`.replace(".", ","),
    );
    // Contract is PERCENTAGE at 50% (seedStaff's default) — half of PRICE.
    const expectedCommission = (PRICE / 2).toFixed(2).replace(".", ",");
    await expect(cells.nth(8), "commission owed was not computed from the formation's revenue").toContainText(
      `${expectedCommission} €`,
    );

    await context.close();
  });
});
