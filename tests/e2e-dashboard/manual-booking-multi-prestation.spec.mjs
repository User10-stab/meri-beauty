import { test, expect } from "@playwright/test";
import { prisma, disconnect, waitFor } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStaff, createStaffService } from "./fixtures/seed-dashboard.mjs";

/**
 * « Ajouter un rendez-vous » with several prestations for one client.
 *
 * Each prestation is its own appointment, so what matters is what lands in
 * the database and in the inboxes — two rows, two client e-mails, one e-mail
 * per staff member — and the two rules the form adds on top of the ordinary
 * availability checks:
 *
 *   same staff member   the second prestation cannot start inside the first
 *                       one's duration *plus its rest time*;
 *   different staff     overlapping is allowed, but is announced while
 *                       filling in the form and confirmed again on submit.
 */

const MAILPIT_API = process.env.MAILPIT_API_URL || "http://localhost:8025";

// seedStaff gives every staff member MONDAY 09:00–17:00 only.
function mondayKey(weeksAhead) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() !== 1);
  d.setDate(d.getDate() + 7 * weeksAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function emailsTo(address) {
  const response = await fetch(`${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=25`);
  return (await response.json()).messages ?? [];
}

async function openDialog(page) {
  await page.goto("/dashboard/appointments");
  await page.getByRole("button", { name: /nouveau rendez-vous/i }).click();
  await expect(page.getByRole("heading", { name: "Ajouter un rendez-vous" })).toBeVisible();
  return page.locator("form").filter({ hasText: "Ajouter une prestation" });
}

/** Fills prestation n°`index` (0-based): service, staff member, date, time. */
async function fillPrestation(form, index, { serviceId, staffServiceId, date, time }) {
  const selects = form.locator("select");
  await selects.nth(index * 2).selectOption(serviceId);
  await expect(selects.nth(index * 2 + 1).locator(`option[value="${staffServiceId}"]`)).toBeAttached();
  await selects.nth(index * 2 + 1).selectOption(staffServiceId);
  if (date) await form.locator('input[type="date"]').nth(index).fill(date);
  if (time) await pickTime(form, index, time);
}

async function pickTime(form, index, time) {
  await form.locator('button[aria-haspopup="listbox"]').nth(index).click();
  await form.getByTitle(`Réserver à ${time}`, { exact: true }).click();
}

async function pickCustomer(form, customer) {
  await form.getByPlaceholder("Nom, e-mail ou téléphone…").fill(customer.email);
  await form.getByRole("button", { name: new RegExp(customer.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
}

// The app pins its clock to Brussels (instrumentation.js); the machine
// running the tests may not be there.
const brusselsTime = (date) =>
  new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);

const appointmentsOf = (userId) =>
  prisma.appointment.findMany({ where: { userId, isDeleted: false }, orderBy: { startTime: "asc" } });

test.describe("manual booking — several prestations for one client", () => {
  test.beforeAll(async () => {
    await requireMailpit();
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("two staff members at the same time: warned, confirmed on submit, two appointments and their e-mails", async ({ page }) => {
    const admin = await seedAdmin({ label: "multi-two-staff" });
    const lyly = await seedStaff({ label: "multi-a", permissions: ["APPOINTMENTS"] });
    const rose = await seedStaff({ label: "multi-b", permissions: ["APPOINTMENTS"] });
    const a = await createStaffService({ staff: lyly.staff, createdByUserId: admin.user.id });
    const b = await createStaffService({ staff: rose.staff, createdByUserId: admin.user.id });
    const customer = await seedCustomer({ label: "multi-two-staff" });
    const date = mondayKey(1);

    await loginAs(page, admin.credentials);
    const form = await openDialog(page);

    await fillPrestation(form, 0, { serviceId: a.service.id, staffServiceId: a.staffService.id, date, time: "10:00" });
    await form.getByRole("button", { name: "Ajouter une prestation" }).click();
    // A new prestation starts on the previous one's date.
    await expect(form.locator('input[type="date"]').nth(1)).toHaveValue(date);
    await fillPrestation(form, 1, { serviceId: b.service.id, staffServiceId: b.staffService.id, time: "10:30" });

    // Announced under both prestations while filling in the form.
    await expect(form.getByText("Le client a déjà une prestation à ce moment-là")).toHaveCount(2);

    // A third prestation makes the form taller than the window: the body
    // scrolls, and the title and the buttons stay on screen.
    await form.getByRole("button", { name: "Ajouter une prestation" }).click();
    const scroller = form.locator("div.overflow-y-auto").first();
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight), "the form body does not scroll").toBe(true);
    await expect(page.getByRole("heading", { name: "Ajouter un rendez-vous" })).toBeInViewport();
    await expect(form.getByRole("button", { name: /Ajouter les 3 rendez-vous/ })).toBeInViewport();
    await form.getByRole("button", { name: "Retirer" }).nth(2).click();

    await pickCustomer(form, customer);

    // First press: a reminder, and nothing saved.
    await form.getByRole("button", { name: "Ajouter les 2 rendez-vous" }).click();
    const reminder = page.getByRole("alertdialog");
    await expect(reminder).toContainText("Prestations au même moment");
    await expect(reminder).toContainText("10:00 → 11:00");
    await expect(reminder).toContainText("10:30 → 11:30");
    await reminder.getByRole("button", { name: "Modifier" }).click();
    await expect(reminder).toBeHidden();
    expect(await appointmentsOf(customer.id), "« Modifier » saved appointments").toHaveLength(0);

    // Second press, confirmed.
    await form.getByRole("button", { name: "Ajouter les 2 rendez-vous" }).click();
    await reminder.getByRole("button", { name: "Confirmer et ajouter" }).click();

    const created = await waitFor(
      async () => {
        const rows = await appointmentsOf(customer.id);
        // The check-in ticket is minted just after the row is written.
        return rows.length === 2 && rows.every((row) => row.checkInCode) ? rows : null;
      },
      { what: "two appointments for the client, each with its ticket", timeout: 30_000 },
    );
    expect(created.map((row) => row.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(created.map((row) => row.staffId)).toEqual([lyly.staff.id, rose.staff.id]);
    expect(created.map((row) => brusselsTime(row.startTime))).toEqual(["10:00", "10:30"]);
    // Each appointment has its own check-in ticket.
    expect(new Set(created.map((row) => row.checkInCode)).size).toBe(2);

    // One e-mail per prestation to the client, one to each staff member.
    await waitFor(async () => ((await emailsTo(customer.email)).length >= 2 ? true : null), {
      what: "two e-mails to the client",
      timeout: 30_000,
    });
    expect(await emailsTo(customer.email)).toHaveLength(2);
    await waitForEmail({ to: lyly.user.email });
    await waitForEmail({ to: rose.user.email });
    expect(await emailsTo(lyly.user.email)).toHaveLength(1);
    expect(await emailsTo(rose.user.email)).toHaveLength(1);

    // And both are on the calendar's own data source.
    await page.goto("/dashboard/appointments");
    await expect(page.getByText(customer.fullName).first()).toBeVisible();
  });

  test("same staff member: slots inside the first prestation's rest time are greyed out", async ({ page }) => {
    const admin = await seedAdmin({ label: "multi-same-staff" });
    const staff = await seedStaff({ label: "multi-same", permissions: ["APPOINTMENTS"] });
    const s = await createStaffService({ staff: staff.staff, createdByUserId: admin.user.id });
    // 60 min + 15 min of rest.
    await prisma.staffService.update({ where: { id: s.staffService.id }, data: { margin: 15 } });
    const customer = await seedCustomer({ label: "multi-same-staff" });
    const date = mondayKey(1);

    await loginAs(page, admin.credentials);
    const form = await openDialog(page);

    await fillPrestation(form, 0, { serviceId: s.service.id, staffServiceId: s.staffService.id, date, time: "13:00" });
    await expect(form.getByText(/temps de repos 15 min/)).toBeVisible();

    await form.getByRole("button", { name: "Ajouter une prestation" }).click();
    await fillPrestation(form, 1, { serviceId: s.service.id, staffServiceId: s.staffService.id });

    // 13:00–14:00 + 15 min: 14:00 is still hers to recover, 14:30 is free.
    // 12:30 would itself run into 13:00.
    await form.locator('button[aria-haspopup="listbox"]').nth(1).click();
    const taken = "pris par une autre prestation de ce rendez-vous";
    for (const time of ["12:30", "13:00", "13:30", "14:00"]) {
      await expect(form.getByTitle(`${time} — ${taken}`, { exact: true })).toBeDisabled();
    }
    await form.getByTitle("Réserver à 14:30", { exact: true }).click();
    await expect(form.getByText("Le client a déjà une prestation à ce moment-là")).toHaveCount(0);

    await pickCustomer(form, customer);
    await form.getByRole("button", { name: "Ajouter les 2 rendez-vous" }).click();
    // One after the other: no reminder, saved directly.
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    const created = await waitFor(
      async () => {
        const rows = await appointmentsOf(customer.id);
        return rows.length === 2 ? rows : null;
      },
      { what: "two appointments with the same staff member", timeout: 30_000 },
    );
    expect(created.map((row) => row.staffId)).toEqual([staff.staff.id, staff.staff.id]);
    expect(created.map((row) => brusselsTime(row.startTime))).toEqual(["13:00", "14:30"]);
  });
});
