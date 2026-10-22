import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, seedPrivateFormation } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStaff, createStaffService, tagPhone } from "./fixtures/seed-dashboard.mjs";
import { parseBrusselsInputValue, toBrusselsInputValue } from "../../lib/datetime/brussels-input.js";

/**
 * Two staff members share a weekday by weeks of the month, and nothing can be
 * booked with either of them on the other's days.
 *
 * 2026-10-22: Marie sets once, in « Définir les horaires de travail », which
 * weeks of the month each one works a weekday (Julie the 1st and 3rd
 * Saturdays, Lyly the 2nd and 4th). A month's 5th occurrence of a weekday is
 * in nobody's rule — not even « every week »: it is extra work Marie agrees
 * directly, so it is nobody's until she gives it — the dashboard warns about
 * it three weeks ahead.
 *
 *   the rule             set from the modal, stored, and a change that would
 *                        take away a day already booked is refused;
 *   rendez-vous          no slot on her partner's weeks nor on an unassigned
 *                        5th day (even with all four weeks ticked); a form
 *                        opened before a change is refused on submit;
 *   5th day              once given to A, bookable with A and not with B;
 *   formation privée     the « date libre » picker follows the same days;
 *   formation / atelier  a new session on her partner's week is refused at
 *   à date fixe          creation, one on her own week is accepted;
 *   caisse (walk-in)     nothing is recorded in her name on a day not hers.
 *
 * The shared weekday is the one of the next 5th occurrence after today, so
 * that day is always in reach of the modal (and of the alert, when close).
 */

const pad = (n) => String(n).padStart(2, "0");
const WEEK_DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const DAY_FR = { MONDAY: "lundi", TUESDAY: "mardi", WEDNESDAY: "mercredi", THURSDAY: "jeudi", FRIDAY: "vendredi", SATURDAY: "samedi", SUNDAY: "dimanche" };
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
const weekDayOf = (key) => WEEK_DAYS[new Date(`${key}T12:00:00Z`).getUTCDay()];
const at = (dateKey, time) => parseBrusselsInputValue(`${dateKey}T${time}`);
const label = (key) => `${DAY_FR[weekDayOf(key)]} ${Number(key.slice(8))} ${MONTHS_FR[Number(key.slice(5, 7)) - 1]}`;

const today = toBrusselsInputValue(new Date()).slice(0, 10);

// The next 5th occurrence of any weekday (a 29th, 30th or 31st) after today.
const FIFTH = (() => {
  let key = addDays(today, 1);
  while (Number(key.slice(8)) < 29) key = addDays(key, 1);
  return key;
})();
const SHARED_DAY = weekDayOf(FIFTH);

/** The k-th SHARED_DAY of the month `monthsAhead` months after today's. */
function nth(k, monthsAhead) {
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + monthsAhead, 1));
  let key = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01`;
  while (weekDayOf(key) !== SHARED_DAY) key = addDays(key, 1);
  return addDays(key, 7 * (k - 1));
}

const DAY = {
  aFirst: nth(1, 1), //      A's week → bookable with A
  bSecond: nth(2, 1), //     B's week → not with A
  aThird: nth(3, 1),
  stale: nth(1, 2), //       A's week, taken from her behind an open form
  booked: nth(3, 2), //      A's week with a rendez-vous → her rule cannot drop it
  formationNo: nth(2, 2), // B's week → a formation with A is refused
  formationOk: nth(1, 3),
  atelierNo: nth(4, 3),
  atelierOk: nth(3, 3),
};

async function staffRule(staffId) {
  const row = await prisma.workingHour.findFirst({ where: { staffId, day: SHARED_DAY } });
  return row?.weeksOfMonth ?? null;
}

/** Writes all seven days: SHARED_DAY open 09:00–17:00 with `weeks`, the rest closed. */
async function setHours(staffId, weeks) {
  await prisma.workingHour.deleteMany({ where: { staffId } });
  await prisma.workingHour.createMany({
    data: WEEK_DAYS.map((day) => ({
      staffId,
      day,
      startTime: day === SHARED_DAY ? "09:00" : "00:00",
      endTime: day === SHARED_DAY ? "17:00" : "00:00",
      isClosed: day !== SHARED_DAY,
      weeksOfMonth: day === SHARED_DAY ? weeks : [],
    })),
  });
}

/** « Horaires de travail » of one staff member, from the Auto-Entrepreneurs list. */
async function openWorkingHours(page, staffEmail) {
  await page.goto("/dashboard/staff/auto-entrepreneur");
  // By e-mail: earlier runs leave staff members with the same name behind.
  await page.getByPlaceholder("Rechercher par nom, e-mail ou téléphone...").fill(staffEmail);
  const row = page.getByRole("row").filter({ hasText: staffEmail });
  await expect(row).toHaveCount(1);
  // The row menu closes on any scroll (Tables/ActionMenu), and reaching the
  // last column scrolls the table — so scroll first, then open it.
  const actions = row.getByRole("button", { name: "Actions sur la ligne" });
  await actions.scrollIntoViewIfNeeded();
  await expect(async () => {
    await actions.click();
    await page.getByRole("menuitem", { name: "Horaires de travail" }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const dialog = page.getByRole("dialog").filter({ hasText: "Définir les horaires de travail" });
  await expect(dialog.getByRole("button", { name: "Enregistrer" })).toBeVisible();
  return dialog;
}

const weekButton = (dialog, k) =>
  dialog.getByRole("button", { name: `${["", "1er", "2e", "3e", "4e"][k]} ${DAY_FR[SHARED_DAY]} du mois`, exact: true });

async function openBookingDialog(page) {
  await page.goto("/dashboard/appointments");
  await page.getByRole("button", { name: /nouveau rendez-vous/i }).click();
  await expect(page.getByRole("heading", { name: "Ajouter un rendez-vous" })).toBeVisible();
  return page.locator("form").filter({ hasText: "Ajouter une prestation" });
}

async function chooseStaffAndDate(form, { serviceId, staffServiceId, date }) {
  const selects = form.locator("select");
  await selects.nth(0).selectOption(serviceId);
  await expect(selects.nth(1).locator(`option[value="${staffServiceId}"]`)).toBeAttached();
  await selects.nth(1).selectOption(staffServiceId);
  await form.locator('input[type="date"]').first().fill(date);
  await expect(form.getByText("Chargement des créneaux…")).toBeHidden({ timeout: 30_000 });
}

/** True when the « Ajouter un rendez-vous » form offers a slot that day. */
async function offersSlots(form, booking, date) {
  await chooseStaffAndDate(form, { ...booking, date });
  return !(await form.getByText("Aucun créneau disponible").isVisible());
}

const datePicker = (page) => page.getByTestId("custom-date-picker");

/** The « date libre » picker's button for one day, its month brought on screen. */
async function libreDay(page, dateKey) {
  const target = dateKey.slice(0, 7);
  for (let step = 0; step < 8; step += 1) {
    await expect(datePicker(page).getByText("Chargement des disponibilités…")).toBeHidden({ timeout: 30_000 });
    const shown = (await datePicker(page).locator("button[data-date]").first().getAttribute("data-date")).slice(0, 7);
    if (shown === target) break;
    await datePicker(page).getByRole("button", { name: "Mois suivant" }).click();
  }
  await expect(datePicker(page).getByText("Chargement des disponibilités…")).toBeHidden({ timeout: 30_000 });
  return datePicker(page).locator(`button[data-date="${dateKey}"]`);
}

const errorToast = (page) => page.locator("[data-sonner-toast][data-type='error']");
const successToast = (page) => page.locator("[data-sonner-toast][data-type='success']");

test.describe.configure({ mode: "serial" });

test.describe("staff sharing a weekday by weeks of the month", () => {
  let admin;
  let a; // works weeks 1 and 3
  let b; // works weeks 2 and 4
  let animatorA;
  let bookingA;
  let bookingB;
  let customer;

  test.beforeAll(async () => {
    admin = await seedAdmin({ label: "jours-partages" });
    a = await seedStaff({ label: "partage-a", permissions: ["APPOINTMENTS"] });
    b = await seedStaff({ label: "partage-b", permissions: ["APPOINTMENTS"] });
    for (const member of [a, b]) {
      // The modal lives on the Auto-Entrepreneurs list, which lists independents.
      await prisma.staff.update({ where: { id: member.staff.id }, data: { type: "INDEPENDENT" } });
    }
    await setHours(a.staff.id, []);
    await setHours(b.staff.id, [2, 4]);
    const sa = await createStaffService({ staff: a.staff, createdByUserId: admin.user.id });
    const sb = await createStaffService({ staff: b.staff, createdByUserId: admin.user.id });
    bookingA = { serviceId: sa.service.id, staffServiceId: sa.staffService.id };
    bookingB = { serviceId: sb.service.id, staffServiceId: sb.staffService.id };
    animatorA = await prisma.animator.create({ data: { name: a.user.fullName, email: a.user.email, staffId: a.staff.id } });
    customer = await seedCustomer({ label: "jours-partages" });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("Marie sets A to the 1st and 3rd weeks once, from the modal", async ({ page }) => {
    await loginAs(page, admin.credentials);
    const dialog = await openWorkingHours(page, a.user.email);

    for (const k of [1, 2, 3, 4]) await expect(weekButton(dialog, k)).toHaveAttribute("aria-pressed", "true");
    await weekButton(dialog, 2).click();
    await weekButton(dialog, 4).click();
    await expect(dialog.getByText(`5e ${DAY_FR[SHARED_DAY]} du mois — vous choisissez à chaque fois qui le travaille :`)).toBeVisible();

    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Les horaires de travail ont été enregistrés avec succès.")).toBeVisible();
    expect(await staffRule(a.staff.id)).toEqual([1, 3]);
  });

  test("rendez-vous: A only on her weeks, B only on hers, nobody on the unassigned 5th", async ({ page }) => {
    await loginAs(page, admin.credentials);
    const form = await openBookingDialog(page);

    expect(await offersSlots(form, bookingA, DAY.aFirst), "A is not bookable on her 1st week").toBe(true);
    expect(await offersSlots(form, bookingA, DAY.bSecond), "A is bookable on B's week").toBe(false);
    expect(await offersSlots(form, bookingA, DAY.aThird)).toBe(true);
    expect(await offersSlots(form, bookingB, DAY.bSecond), "B is not bookable on her 2nd week").toBe(true);
    expect(await offersSlots(form, bookingB, DAY.aFirst), "B is bookable on A's week").toBe(false);
    expect(await offersSlots(form, bookingA, FIFTH), "A is bookable on an unassigned 5th day").toBe(false);
    expect(await offersSlots(form, bookingB, FIFTH), "B is bookable on an unassigned 5th day").toBe(false);

    // All four weeks ticked: every week — still not the 5th until it is given.
    await prisma.workingHour.updateMany({ where: { staffId: b.staff.id, day: SHARED_DAY }, data: { weeksOfMonth: [] } });
    expect(await offersSlots(form, bookingB, DAY.aFirst), "B (every week) is not bookable on a 1st week").toBe(true);
    expect(await offersSlots(form, bookingB, FIFTH), "every week gave B the 5th day by itself").toBe(false);
    await prisma.workingHour.updateMany({ where: { staffId: b.staff.id, day: SHARED_DAY }, data: { weeksOfMonth: [2, 4] } });
  });

  test("the 5th day: warned on the dashboard when close, given to A, then bookable with A only", async ({ page }) => {
    await loginAs(page, admin.credentials);

    if (FIFTH <= addDays(today, 21)) {
      await page.goto("/dashboard");
      const alert = page.getByTestId("fifth-day-alert");
      await expect(alert).toContainText(new RegExp(label(FIFTH), "i"));
    }

    const dialog = await openWorkingHours(page, a.user.email);
    const fifthRow = dialog.locator(`[data-fifth-days="${SHARED_DAY}"] div`).filter({ hasText: label(FIFTH) });
    await expect(fifthRow).toContainText("personne pour l'instant");
    await fifthRow.getByRole("button", { name: "Choisir" }).click();

    const assign = page.getByRole("dialog").filter({ hasText: "Qui travaille ce jour-là ?" });
    // Nobody is ticked until Marie says so.
    await expect(assign.getByRole("checkbox", { name: a.user.fullName })).not.toBeChecked();
    await expect(assign.getByRole("checkbox", { name: b.user.fullName })).not.toBeChecked();
    await assign.getByRole("checkbox", { name: a.user.fullName }).check();
    await assign.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText(`${a.user.fullName} travaillera ce jour-là.`)).toBeVisible();
    await expect(fifthRow).toContainText(a.user.fullName);

    const overrides = await prisma.workingDayOverride.findMany({ where: { dateKey: FIFTH, staffId: { in: [a.staff.id, b.staff.id] } } });
    expect(overrides.map((o) => [o.staffId, o.isWorking])).toEqual([[a.staff.id, true]]);

    if (FIFTH <= addDays(today, 21)) {
      await page.goto("/dashboard");
      // Other staff members (the real ones in this database) still have it to be
      // given: the day stays listed while it is nobody's; once anyone has it, it goes.
      await expect(page.getByTestId("fifth-day-alert").filter({ hasText: new RegExp(label(FIFTH), "i") })).toHaveCount(0);
    }

    const form = await openBookingDialog(page);
    expect(await offersSlots(form, bookingA, FIFTH), "A is not bookable on the 5th day given to her").toBe(true);
    expect(await offersSlots(form, bookingB, FIFTH), "B is bookable on the 5th day given to A").toBe(false);
  });

  test("rendez-vous: a form opened before her week is taken away is refused on submit", async ({ page }) => {
    await loginAs(page, admin.credentials);
    const form = await openBookingDialog(page);

    await chooseStaffAndDate(form, { ...bookingA, date: DAY.stale });
    await form.locator('button[aria-haspopup="listbox"]').first().click();
    await form.getByTitle("Réserver à 10:00", { exact: true }).click();
    await form.getByPlaceholder("Nom, e-mail ou téléphone…").fill(customer.email);
    await form.getByRole("button", { name: new RegExp(customer.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();

    // Another admin moves A to the 3rd week only while this form is open.
    await prisma.workingHour.updateMany({ where: { staffId: a.staff.id, day: SHARED_DAY }, data: { weeksOfMonth: [3] } });

    await form.getByRole("button", { name: "Ajouter le rendez-vous" }).click();
    // validateAppointmentSlot's "not a working day" refusal — not any other error.
    await expect(errorToast(page)).toContainText("Ce créneau n'est plus disponible", { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    expect(await prisma.appointment.count({ where: { staffId: a.staff.id, isDeleted: false } })).toBe(0);

    await prisma.workingHour.updateMany({ where: { staffId: a.staff.id, day: SHARED_DAY }, data: { weeksOfMonth: [1, 3] } });
  });

  test("the rule: dropping a week that already holds a rendez-vous is refused", async ({ page }) => {
    await prisma.appointment.create({
      data: {
        userId: customer.id,
        staffServiceId: bookingA.staffServiceId,
        staffId: a.staff.id,
        date: at(DAY.booked, "10:00"),
        startTime: at(DAY.booked, "10:00"),
        endTime: at(DAY.booked, "11:00"),
        status: "CONFIRMED",
      },
    });

    await loginAs(page, admin.credentials);
    const dialog = await openWorkingHours(page, a.user.email);
    await weekButton(dialog, 3).click();
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(errorToast(page)).toContainText("a déjà des rendez-vous le", { timeout: 30_000 });
    expect(await staffRule(a.staff.id)).toEqual([1, 3]);
  });

  test("formation privée: the « date libre » picker follows her weeks", async ({ page }) => {
    const { formation } = await seedPrivateFormation({ animator: animatorA, duration: 240, label: "Jours Partages" });

    await page.goto(`/reservation-formation?formation=${formation.id}&date=libre`);
    const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
    if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();
    await expect(datePicker(page)).toBeVisible({ timeout: 30_000 });

    await expect(await libreDay(page, DAY.aFirst), "her own week is not offered").toHaveAttribute("data-free", "true");
    const partners = await libreDay(page, DAY.bSecond);
    await expect(partners, "her partner's week is offered").toHaveAttribute("data-free", "false");
    await expect(partners).toBeDisabled();
  });

  test("formation: a session on her partner's week is refused at creation, one on hers is accepted", async ({ page }) => {
    const title = `E2E Formation Jours Partages ${getRunId()}`;
    await loginAs(page, admin.credentials);

    const fillForm = async (dateKey) => {
      await page.goto("/dashboard/formations");
      await page.getByRole("button", { name: /nouvelle formation/i }).click();
      const form = page.locator("form").filter({ hasText: /type de formation/i });
      await form.getByRole("button", { name: /privée \(1 personne\)/i }).click();
      await form.getByPlaceholder("ex. Formation Extension de Cils").fill(title);
      await form.getByPlaceholder("0.00").fill("120");
      await form.getByPlaceholder("180").fill("120");
      await form.locator("select").filter({ hasText: "Sélectionner un formateur" }).selectOption(a.user.id);
      await form.locator('input[type="datetime-local"]').first().fill(`${dateKey}T10:00`);
      await form.getByRole("button", { name: /créer la formation/i }).click();
    };

    await fillForm(DAY.formationNo);
    await expect(errorToast(page)).toContainText("ne travaille pas le", { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    expect(await prisma.formation.count({ where: { title } }), "a formation was scheduled on her partner's week").toBe(0);

    await fillForm(DAY.formationOk);
    await expect(successToast(page)).toBeVisible({ timeout: 30_000 });
    const created = await prisma.formation.findFirst({ where: { title }, include: { sessions: true } });
    expect(created?.sessions.map((s) => toBrusselsInputValue(s.startDate).slice(0, 10))).toEqual([DAY.formationOk]);
  });

  test("atelier: a session on her partner's week is refused at creation, one on hers is accepted", async ({ page }) => {
    const title = `E2E Atelier Jours Partages ${getRunId()}`;
    await loginAs(page, admin.credentials);

    const fillForm = async (dateKey) => {
      await page.goto("/dashboard/workshops/activities");
      await page.getByRole("button", { name: /nouvelle activité/i }).click();
      const form = page.locator("form").filter({ hasText: /créer l'activité/i });
      await form.getByPlaceholder("ex. Masterclass Balayage & Brillance").fill(title);
      await form.getByPlaceholder("0.00").fill("40");
      await form.getByPlaceholder("120").fill("120");
      await form.getByPlaceholder("8").first().fill("6");
      await form.locator("select").filter({ hasText: "-- Sélectionner un animateur --" }).selectOption(animatorA.id);
      await form.locator('input[type="datetime-local"]').first().fill(`${dateKey}T14:00`);
      await form.getByRole("button", { name: /créer l'activité/i }).click();
    };

    await fillForm(DAY.atelierNo);
    await expect(errorToast(page)).toContainText("ne travaille pas le", { timeout: 30_000 });
    await page.waitForTimeout(1_500);
    expect(await prisma.activity.count({ where: { title } }), "an atelier was scheduled on her partner's week").toBe(0);

    await fillForm(DAY.atelierOk);
    await expect(successToast(page)).toBeVisible({ timeout: 30_000 });
    const created = await prisma.activity.findFirst({ where: { title }, include: { sessions: true } });
    expect(created?.sessions.map((s) => toBrusselsInputValue(s.startDate).slice(0, 10))).toEqual([DAY.atelierOk]);
  });

  test("caisse: no walk-in prestation is recorded in her name on a day not hers", async ({ page }) => {
    test.setTimeout(180_000);
    const runId = getRunId();
    // The till records what happens today: today's weekday is made hers on
    // another week than this one.
    const todayDay = weekDayOf(today);
    const rank = Math.ceil(Number(today.slice(8)) / 7);
    await prisma.workingHour.updateMany({
      where: { staffId: a.staff.id, day: todayDay },
      data: { isClosed: false, startTime: "09:00", endTime: "17:00", weeksOfMonth: [rank === 1 ? 2 : 1] },
    });

    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/point-of-sale");
    const counter = page.locator("section").filter({ hasText: /pointage/i });
    await counter.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(a.user.fullName);
    await counter.getByRole("button", { name: /^rechercher$/i }).click();
    const serviceRow = counter.getByRole("button").filter({ hasText: a.user.fullName });
    await expect(serviceRow.first(), "the seeded service did not surface in search").toBeVisible({ timeout: 20_000 });
    await serviceRow.first().click();
    await expect(counter.getByRole("heading", { name: /encaisser une prestation du catalogue/i })).toBeVisible({ timeout: 20_000 });

    await counter.getByPlaceholder(/^nom complet$/i).fill("Client Jours Partages Automatise");
    await counter.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(`e2e+walkin-jours-partages.${runId}@meribeauty.test`);
    await counter.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:walkin-jours-partages`));
    await counter.getByRole("radio", { name: /terminal externe/i }).click();
    await counter.getByRole("button", { name: /encaisser et enregistrer/i }).click();

    await expect(errorToast(page)).toContainText("ne travaille pas aujourd'hui", { timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const walkIns = await prisma.appointment.count({
      where: { staffServiceId: bookingA.staffServiceId, notes: { contains: "sans réservation" } },
    });
    expect(walkIns, "a walk-in was recorded on a day not hers").toBe(0);
  });
});
