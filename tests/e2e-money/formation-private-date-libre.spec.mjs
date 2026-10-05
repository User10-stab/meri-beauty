import { expect, test } from "@playwright/test";
import { prisma, waitFor, disconnect } from "./fixtures/db.mjs";
import { assertLedgerSound } from "./fixtures/ledger.mjs";
import { loginAs } from "./fixtures/auth.mjs";
import { expectOnStripeCheckout, payAndReturn } from "./fixtures/stripe-checkout.mjs";
import { requireMailpit, waitForEmail } from "./fixtures/mailpit.mjs";
import { getRunId } from "./fixtures/run-id.mjs";
import {
  seedCustomer,
  customerCredentials,
  seedFormationTrainer,
  seedFormationAdmin,
  seedTrainerDayOff,
  seedTrainerAppointment,
  seedSalonClosure,
  seedPrivateFormation,
} from "./fixtures/seed-money.mjs";
import { parseBrusselsInputValue, toBrusselsInputValue } from "../../lib/datetime/brussels-input.js";

/**
 * « Date libre » — a private formation's client picks her own date.
 *
 * Marie's problem (2026-10-02): a private formation could only be booked on
 * the dates typed into it, so a client whose diary did not match could not
 * book. The rule now:
 *
 *   - a private formation can be created with NO date;
 *   - with or without scheduled dates, the client may take any day the
 *     animator is free — her working hours, indisponibilités (jours fériés
 *     included), the salon's fermetures exceptionnelles, her rendez-vous and
 *     the sessions she already animates are all read;
 *   - she chooses 1 journée or 2 journées, the second being the next day at
 *     the same hours, and both days must be free;
 *   - the date is confirmed ONLY by a payment — deposit or full. An unpaid
 *     pick blocks nobody, and a pick whose day was taken before the money
 *     arrived is not confirmed.
 *
 * It is in the money suite because that last rule IS a payment: nothing
 * short of a real Checkout and its webhook proves a date gets confirmed, and
 * by what.
 *
 * The trainer is seeded and works every day 09:00–18:00, so every day this
 * scenario finds closed is one it closed itself. The formation lasts 4 h in
 * total: 4 h on one journée, 2 h on each of two. A formation too long for one
 * working day is two journées automatically.
 */

const PRICE = 120;
const DEPOSIT = 60;
const DURATION = 240;
const FULL_DAY_TIMES = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"];
// Two journées: 2 h a day, so the last start is 16:00.
const HALF_DAY_TIMES = [...FULL_DAY_TIMES, "14:30", "15:00", "15:30", "16:00"];
const AFTER_NOON = HALF_DAY_TIMES.slice(HALF_DAY_TIMES.indexOf("12:00"));

const pad = (n) => String(n).padStart(2, "0");

function addDays(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Brussels wall clock on a calendar day → the instant. */
const at = (dateKey, time) => parseBrusselsInputValue(`${dateKey}T${time}`);

const today = toBrusselsInputValue(new Date()).slice(0, 10);
const base = addDays(today, 40);
// One role per day, far enough apart that no two rules can explain one result.
const DAY = {
  twoDays: base, //            free, and so is the next day   → paid, 2 journées
  twoDaysSecond: addDays(base, 1),
  beforeDayOff: addDays(base, 4), // free, but the next day is off → 1 journée only
  dayOff: addDays(base, 5), //       full-day indisponibilité
  closure: addDays(base, 7), //      fermeture exceptionnelle of the salon
  appointment: addDays(base, 9), //  a rendez-vous 12:00–13:00
  scheduled: addDays(base, 11), //   formation B's own scheduled date, 10:00
  fullPayment: addDays(base, 12), // paid in full, 1 journée
  takenLate: addDays(base, 14), //   picked, then closed before the payment
  takenEarly: addDays(base, 16), //  picked, then closed before the submit
  stretch: addDays(base, 20), //     a 30 h formation spread over five journées (20 → 24)
  stretchBlocked: addDays(base, 27), // four journées from here would cross the day off at +30
  stretchDayOff: addDays(base, 30),
  counter: addDays(base, 33), //     sold at the till, 2 journées (33 → 34)
  counterSecond: addDays(base, 34),
};

const picker = (page) => page.getByTestId("custom-date-picker");

/** Brings the month holding `dateKey` on screen and returns that day's button. */
async function dayButton(page, dateKey) {
  const target = dateKey.slice(0, 7);
  for (let step = 0; step < 15; step += 1) {
    await expect(picker(page).getByText("Chargement des disponibilités…")).toBeHidden({ timeout: 30_000 });
    const shown = (await picker(page).locator("button[data-date]").first().getAttribute("data-date")).slice(0, 7);
    if (shown === target) break;
    await picker(page).getByRole("button", { name: shown < target ? "Mois suivant" : "Mois précédent" }).click();
  }
  await expect(picker(page).getByText("Chargement des disponibilités…")).toBeHidden({ timeout: 30_000 });
  return picker(page).locator(`button[data-date="${dateKey}"]`);
}

async function expectDay(page, dateKey, free, why) {
  const day = await dayButton(page, dateKey);
  await expect(day, why).toHaveAttribute("data-free", free ? "true" : "false");
  if (!free) await expect(day, why).toBeDisabled();
}

/** Clicks a day and returns the start times offered for the selected duration. */
async function offeredTimes(page) {
  await expect(picker(page).getByText("Chargement des horaires…")).toBeHidden({ timeout: 30_000 });
  return picker(page).locator("button[data-time]").evaluateAll((buttons) => buttons.map((b) => b.dataset.time));
}

async function openPicker(page, formationId) {
  await page.goto(`/reservation-formation?formation=${formationId}&date=libre`);
  const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
  if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();
  await expect(picker(page)).toBeVisible({ timeout: 30_000 });
}

async function fillAndAcceptTerms(page) {
  await page.locator("#formation-phone").fill(`04${String(Date.now()).slice(-8)}`);
  await page.locator("label", { hasText: /j'ai lu et j'accepte/i }).locator('input[type="checkbox"]').check();
}

function customReservation(formationId, customerId) {
  return prisma.formationReservation.findFirst({
    where: { customerId, session: { formationId } },
    orderBy: { createdAt: "desc" },
    include: { session: true, payment: { include: { transactions: true } } },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("formation privée — date libre", () => {
  let trainer;
  let admin; // creates the formation and reads the bookings, as Marie would
  let payer; // pays a deposit for two journées
  let neighbour; // sees what the payer's booking left, and is refused twice
  let fullPayer; // pays in full for one journée
  let formationA; // created through the dashboard, with no date at all
  let formationB; // seeded with one scheduled date
  let closure;
  const titleA = `E2E Formation Date Libre ${getRunId()}`;

  test.beforeAll(async () => {
    trainer = await seedFormationTrainer();
    admin = await seedFormationAdmin();
    payer = await seedCustomer({ label: "datelibre" });
    neighbour = await seedCustomer({ label: "voisine" });
    fullPayer = await seedCustomer({ label: "totalite" });

    await seedTrainerDayOff({ staff: trainer.staff, start: at(DAY.dayOff, "00:00"), end: at(DAY.dayOff, "23:59") });
    closure = await seedSalonClosure({ start: at(DAY.closure, "00:00"), end: at(DAY.closure, "23:59") });
    await seedTrainerAppointment({
      staff: trainer.staff,
      trainerUser: trainer.user,
      customer: neighbour,
      start: at(DAY.appointment, "12:00"),
      end: at(DAY.appointment, "13:00"),
    });
    formationB = await seedPrivateFormation({
      animator: trainer.animator,
      price: PRICE,
      duration: DURATION,
      sessionStart: at(DAY.scheduled, "10:00"),
      label: "Avec Date",
    });
  });

  test.afterAll(async () => {
    // The one exception to "never clean up": a salon closure is not this
    // run's own data, it closes the real salon's calendar for everyone using
    // this database. Everything else stays, tagged, as evidence.
    if (closure) await prisma.salonClosure.delete({ where: { id: closure.id } }).catch(() => {});
    await disconnect();
  });

  test("a private formation is created and published with no date", async ({ page }) => {
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/formations");
    await page.getByRole("button", { name: /nouvelle formation/i }).click();

    const form = page.locator("form").filter({ hasText: /type de formation/i });
    await form.getByRole("button", { name: /privée \(1 personne\)/i }).click();

    // The form says so itself, and no longer demands a date.
    await expect(form.getByTestId("private-date-hint")).toContainText(/date facultative/i);
    await expect(form.locator('input[type="datetime-local"]').first()).not.toHaveAttribute("required", "");

    await form.getByPlaceholder("ex. Formation Extension de Cils").fill(titleA);
    await form.getByPlaceholder("0.00").fill(String(PRICE));
    await form.getByPlaceholder("180").fill(String(DURATION));
    // The staff member whose calendar the formation will run on.
    await form.locator("select").filter({ hasText: "Sélectionner un formateur" }).selectOption(trainer.user.id);
    await form.locator("select").filter({ hasText: "Brouillon" }).selectOption("PUBLISHED");
    await form.getByRole("button", { name: /créer la formation/i }).click();

    formationA = await waitFor(
      () => prisma.formation.findFirst({ where: { title: titleA }, include: { sessions: true } }),
      { what: "the private formation to be created without a date", timeout: 30_000 },
    );
    expect(formationA.type).toBe("PRIVATE");
    expect(formationA.status, "a dateless private formation was not allowed to be published").toBe("PUBLISHED");
    expect(formationA.sessions, "a session was invented for a formation created with no date").toHaveLength(0);
    expect(formationA.animatorId, "the formation is not on its trainer's calendar").toBe(trainer.animator.id);
    expect(formationA.depositPercentage).toBe(50);
  });

  test("the calendar only offers the days the trainer is really free", async ({ page }) => {
    await loginAs(page, customerCredentials(payer));

    // Listed and bookable although it has no session at all.
    await page.goto(`/formations/${formationA.id}`);
    const card = page.getByTestId("formation-custom-date-card");
    await expect(card).toContainText(/date au choix/i);
    await card.getByRole("link", { name: /choisir ma date/i }).click();
    await expect(page).toHaveURL(/date=libre/);
    await expect(picker(page)).toBeVisible({ timeout: 30_000 });

    await expectDay(page, DAY.dayOff, false, "a day of indisponibilité was offered");
    await expectDay(page, DAY.closure, false, "a fermeture exceptionnelle was offered");
    await expectDay(page, DAY.twoDays, true, "a free day was not offered");

    // A rendez-vous 12:00–13:00 leaves only the starts that clear it (4 h).
    await (await dayButton(page, DAY.appointment)).click();
    expect(await offeredTimes(page), "start times overlapping a rendez-vous were offered").toEqual(["13:00", "13:30", "14:00"]);

    // The day before a day off: one journée, never two.
    await (await dayButton(page, DAY.beforeDayOff)).click();
    expect(await offeredTimes(page)).toEqual(FULL_DAY_TIMES);
    await expect(picker(page).getByTestId("custom-date-days-2"), "two journées were offered into a day off").toBeDisabled();
  });

  test("two journées paid by deposit: confirmed, and both days are then taken", async ({ page, browser }) => {
    await loginAs(page, customerCredentials(payer));
    await openPicker(page, formationA.id);

    await (await dayButton(page, DAY.twoDays)).click();
    await offeredTimes(page);
    await picker(page).getByTestId("custom-date-days-2").click();
    expect(await offeredTimes(page)).toEqual(HALF_DAY_TIMES);
    await picker(page).locator('button[data-time="10:00"]').click();

    // The 4 h are split: 2 h on each day.
    const summary = page.getByTestId("custom-date-summary");
    await expect(summary).toContainText("10:00 – 12:00");
    await expect(summary).toContainText(/2 journées/);

    await fillAndAcceptTerms(page);
    await page.getByRole("button", { name: /payer l'acompte de/i }).click();

    // Reached Stripe, not yet paid: the pick exists but confirms nothing and
    // holds nobody's calendar.
    await expectOnStripeCheckout(page);
    const held = await waitFor(() => customReservation(formationA.id, payer.id), { what: "the unpaid pick to be recorded" });
    expect(held.status, "a date was confirmed before any payment").toBe("PENDING_DEPOSIT");
    expect(held.payment).toBeNull();
    expect(held.session.customerRequested).toBe(true);

    const other = await browser.newContext();
    try {
      const otherPage = await other.newPage();
      await loginAs(otherPage, customerCredentials(neighbour));
      await openPicker(otherPage, formationA.id);
      await expectDay(otherPage, DAY.twoDays, true, "an unpaid pick blocked the day for everyone else");
      await (await dayButton(otherPage, DAY.twoDays)).click();
      expect(await offeredTimes(otherPage), "an unpaid pick removed start times").toEqual(FULL_DAY_TIMES);
    } finally {
      await other.close();
    }

    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await waitFor(
      async () => {
        const row = await customReservation(formationA.id, payer.id);
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: "the two-day date libre to be confirmed by its deposit" },
    );

    expect(reservation.session.customerRequested).toBe(true);
    expect(reservation.session.capacity).toBe(1);
    expect(reservation.session.animatorId).toBe(trainer.animator.id);
    expect(reservation.session.startDate.toISOString()).toBe(at(DAY.twoDays, "10:00").toISOString());
    expect(reservation.session.endDate.toISOString(), "two journées do not end on the second day").toBe(
      at(DAY.twoDaysSecond, "12:00").toISOString(),
    );

    expect(Number(reservation.totalPrice), "two journées changed the price").toBeCloseTo(PRICE, 2);
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(Number(reservation.balanceDue)).toBeCloseTo(PRICE - DEPOSIT, 2);
    expect(reservation.payment.status).toBe("PARTIALLY_PAID");
    expect(reservation.payment.transactions.map((t) => t.transactionType)).toContain("DEPOSIT");
    await assertLedgerSound(reservation.payment.id, { expectHeld: DEPOSIT });

    await expect(page.getByTestId("formation-second-day")).toContainText(/2 journées/, { timeout: 60_000 });

    // The trainer is told by e-mail: who, which days, acompte paid.
    await requireMailpit();
    const staffMail = await waitForEmail({ to: trainer.user.email, subject: /formation réservée/i, timeout: 60_000 });
    expect(staffMail.Text).toContain(payer.email);
    expect(staffMail.Text).toContain("2 journées");
    expect(staffMail.Text).toContain("date choisie par la cliente");
    expect(staffMail.Text).toContain("Acompte payé");

    // Paid: both days are now off the calendar for the next client.
    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, formationA.id);
    await expectDay(page, DAY.twoDays, true, "the first paid day lost its remaining free hours");
    await (await dayButton(page, DAY.twoDays)).click();
    // 10:00–12:00 is taken on each day; a 4 h journée only fits from 12:00.
    const afterBooking = FULL_DAY_TIMES.slice(FULL_DAY_TIMES.indexOf("12:00"));
    expect(await offeredTimes(page), "the paid hours of day one are still offered").toEqual(afterBooking);
    await (await dayButton(page, DAY.twoDaysSecond)).click();
    expect(await offeredTimes(page), "the paid hours of day two are still offered").toEqual(afterBooking);
    // The day before the booking can no longer run two journées into it at 10:00.
    await (await dayButton(page, addDays(DAY.twoDays, -1))).click();
    await offeredTimes(page);
    await picker(page).getByTestId("custom-date-days-2").click();
    expect(await offeredTimes(page)).toEqual(AFTER_NOON);
  });

  test("a formation too long for one working day is two journées automatically", async ({ page }) => {
    // 15 h in total against a 9 h working day (09:00–18:00): never one
    // journée, 7 h 30 on each of two.
    const long = await seedPrivateFormation({ animator: trainer.animator, price: PRICE, duration: 900, label: "Longue" });

    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, long.formation.id);

    await expectDay(page, DAY.fullPayment, true, "a long formation greyed out a day with two free days ahead");
    await expectDay(page, DAY.beforeDayOff, false, "a long formation was offered into a day off");

    await (await dayButton(page, DAY.fullPayment)).click();
    await offeredTimes(page);
    await expect(picker(page).getByTestId("custom-date-days-1"), "one journée was offered for a 15 h formation").toBeDisabled();
    await expect(picker(page).getByTestId("custom-date-days-2")).toHaveAttribute("aria-checked", "true");
    expect(await offeredTimes(page)).toEqual(["09:00", "09:30", "10:00", "10:30"]);

    await picker(page).locator('button[data-time="09:00"]').click();
    const summary = page.getByTestId("custom-date-summary");
    await expect(summary).toContainText("09:00 – 16:30");
    await expect(summary).toContainText(/2 journées/);
  });

  test("the salon sees the booking, and saving the formation does not delete the client's date", async ({ page }) => {
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/formations/reservations");
    const row = page.getByRole("row").filter({ hasText: payer.email });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.getByTestId("reservation-custom-date")).toContainText(/date choisie par la cliente · 2 journées/i);

    // The session editor never lists a client's own date — and must not read
    // its absence as "removed" (editing a formation once wiped its bookings).
    await page.goto("/dashboard/formations");
    const formationRow = page.getByRole("row").filter({ hasText: titleA });
    await formationRow.getByRole("button", { name: /row actions/i }).click();
    await page.getByRole("menuitem", { name: /modifier/i }).click();
    const form = page.locator("form").filter({ hasText: /type de formation/i });
    await expect(form.locator('input[type="datetime-local"]').first()).toHaveValue("");
    await form.getByRole("button", { name: /mettre à jour/i }).click();
    await expect(page.getByText(/formation mise à jour avec succès/i)).toBeVisible({ timeout: 30_000 });

    const after = await customReservation(formationA.id, payer.id);
    expect(after.status, "saving the formation touched the client's booking").toBe("CONFIRMED");
    expect(after.session.startDate.toISOString()).toBe(at(DAY.twoDays, "10:00").toISOString());
  });

  test("a formation with a scheduled date still lets the client pick another day, paid in full", async ({ page }) => {
    await loginAs(page, customerCredentials(fullPayer));
    await page.goto(`/formations/${formationB.formation.id}`);

    // Both ways in: the date the salon scheduled, and a date of her own.
    await expect(page.getByRole("link", { name: /^réserver$/i })).toHaveCount(1);
    const card = page.getByTestId("formation-custom-date-card");
    await expect(card).toContainText(/une autre date vous arrange/i);
    await card.getByRole("link", { name: /choisir ma date/i }).click();
    await expect(picker(page)).toBeVisible({ timeout: 30_000 });

    // The scheduled session occupies the trainer 10:00–14:00 that day.
    await (await dayButton(page, DAY.scheduled)).click();
    expect(await offeredTimes(page), "the trainer's own scheduled session was double-booked").toEqual(["14:00"]);

    await (await dayButton(page, DAY.fullPayment)).click();
    await offeredTimes(page);
    await picker(page).locator('button[data-time="13:30"]').click();
    await expect(page.getByTestId("custom-date-summary")).toContainText(/13:30 – 17:30 · 1 journée/);

    await page.getByRole("button", { name: /payer le montant total/i }).first().click();
    await fillAndAcceptTerms(page);
    await page.getByRole("button", { name: /payer le montant total de/i }).click();
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await waitFor(
      async () => {
        const row = await customReservation(formationB.formation.id, fullPayer.id);
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: "the one-day date libre to be confirmed by its full payment" },
    );

    expect(reservation.session.customerRequested).toBe(true);
    expect(reservation.session.id, "the booking landed on the scheduled session").not.toBe(formationB.session.id);
    expect(reservation.session.startDate.toISOString()).toBe(at(DAY.fullPayment, "13:30").toISOString());
    expect(reservation.session.endDate.toISOString()).toBe(at(DAY.fullPayment, "17:30").toISOString());
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(PRICE, 2);
    expect(Number(reservation.balanceDue)).toBeCloseTo(0, 2);
    expect(reservation.payment.status).toBe("PAID");
    await assertLedgerSound(reservation.payment.id, { expectHeld: PRICE });

    // The scheduled date is untouched and still for sale.
    const scheduled = await prisma.formationSession.findUnique({
      where: { id: formationB.session.id },
      include: { reservations: true },
    });
    expect(scheduled.status).toBe("SCHEDULED");
    expect(scheduled.reservations).toHaveLength(0);

    // …and the client's own date is not listed publicly as a session.
    await page.goto(`/formations/${formationB.formation.id}`);
    await expect(page.getByRole("link", { name: /^réserver$/i }), "a client's own date was listed as a public session").toHaveCount(1);
  });

  test("a day that closes between picking and submitting is refused, with nothing recorded", async ({ page }) => {
    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, formationA.id);

    await (await dayButton(page, DAY.takenEarly)).click();
    await offeredTimes(page);
    await picker(page).locator('button[data-time="09:00"]').click();
    await fillAndAcceptTerms(page);

    // The trainer declares herself unavailable while the form is open.
    await seedTrainerDayOff({ staff: trainer.staff, start: at(DAY.takenEarly, "00:00"), end: at(DAY.takenEarly, "23:59") });

    await page.getByRole("button", { name: /payer l'acompte de/i }).click();
    await expect(page.getByText(/cette date n'est plus disponible/i)).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/checkout\.stripe\.com/);

    expect(
      await prisma.formationReservation.count({ where: { customerId: neighbour.id, session: { formationId: formationA.id } } }),
      "a refused date still created a booking",
    ).toBe(0);
    // The picker reloaded on what is really free.
    await expectDay(page, DAY.takenEarly, false, "the refused day is still offered");
  });

  test("a day that closes before the payment arrives is not confirmed, and the money is flagged for refund", async ({ page }) => {
    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, formationA.id);

    await (await dayButton(page, DAY.takenLate)).click();
    await offeredTimes(page);
    await picker(page).locator('button[data-time="09:00"]').click();
    await fillAndAcceptTerms(page);
    await page.getByRole("button", { name: /payer l'acompte de/i }).click();
    await expectOnStripeCheckout(page);

    const held = await waitFor(() => customReservation(formationA.id, neighbour.id), { what: "the unpaid pick to be recorded" });
    expect(held.status).toBe("PENDING_DEPOSIT");

    // Unpaid, the pick held nothing — so the trainer could take a rendez-vous
    // on those very hours. She does, while the client is on the payment page.
    await seedTrainerAppointment({
      staff: trainer.staff,
      trainerUser: trainer.user,
      customer: payer,
      start: at(DAY.takenLate, "10:00"),
      end: at(DAY.takenLate, "11:00"),
    });

    await payAndReturn(page, /\/reservation-formation\/succes/);

    const refused = await waitFor(
      async () => {
        const row = await customReservation(formationA.id, neighbour.id);
        return row?.status === "CANCELLED" ? row : null;
      },
      { what: "the late payment to be refused because the day was taken" },
    );
    expect(refused.payment, "a Payment was booked for a date that could not be confirmed").toBeNull();

    // The charge is real, so it must not vanish: a durable manual-refund case.
    const refundCase = await waitFor(
      () => prisma.manualRefundCase.findFirst({
        where: { reason: { contains: "date libre" }, amount: DEPOSIT, createdAt: { gt: held.createdAt } },
        orderBy: { createdAt: "desc" },
      }),
      { what: "the captured deposit to be flagged for a manual refund" },
    );
    expect(refundCase.stripePaymentIntentId).toBeTruthy();
  });

  test("a 30 h formation is spread over as many journées as the client wants, every day free", async ({ page }) => {
    // 1800 min against a 9 h working day: one, two or three journées never
    // fit (10 h a day is too long), four is the fewest, and the client may
    // stretch further — each day at least 2 h, so up to ten.
    const long = await seedPrivateFormation({ animator: trainer.animator, price: PRICE, duration: 1800, label: "Trente Heures" });
    await seedTrainerDayOff({ staff: trainer.staff, start: at(DAY.stretchDayOff, "00:00"), end: at(DAY.stretchDayOff, "23:59") });

    await loginAs(page, customerCredentials(fullPayer));
    await openPicker(page, long.formation.id);

    // Every count from four up would cross the day off: nothing starts there.
    await expectDay(page, DAY.stretchBlocked, false, "a stretch over a day off was offered");
    await expectDay(page, addDays(DAY.stretchBlocked, -1), true, "four free days ahead were not offered");

    await (await dayButton(page, DAY.stretch)).click();
    await offeredTimes(page);
    for (const count of [1, 2, 3]) {
      await expect(picker(page).getByTestId(`custom-date-days-${count}`), `${count} journée(s) offered for 30 h`).toBeDisabled();
    }
    // The fewest that fit is chosen for her: four journées of 7 h 30.
    await expect(picker(page).getByTestId("custom-date-days-4")).toHaveAttribute("aria-checked", "true");
    expect(await offeredTimes(page)).toEqual(["09:00", "09:30", "10:00", "10:30"]);
    await expect(picker(page).getByTestId("custom-date-days-10")).toBeEnabled();

    // She stretches it over five: 6 h a day.
    await picker(page).getByTestId("custom-date-days-5").click();
    expect(await offeredTimes(page)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00"]);
    await picker(page).locator('button[data-time="09:00"]').click();
    const summary = page.getByTestId("custom-date-summary");
    await expect(summary).toContainText("09:00 – 15:00 chaque jour · 5 journées");

    await fillAndAcceptTerms(page);
    await page.getByRole("button", { name: /payer l'acompte de/i }).click();
    await payAndReturn(page, /\/reservation-formation\/succes/);

    const reservation = await waitFor(
      async () => {
        const row = await customReservation(long.formation.id, fullPayer.id);
        return row?.status === "CONFIRMED" && row.payment?.transactions?.length ? row : null;
      },
      { what: "the five-journée date libre to be confirmed by its deposit" },
    );
    expect(reservation.session.startDate.toISOString()).toBe(at(DAY.stretch, "09:00").toISOString());
    expect(reservation.session.endDate.toISOString(), "five journées do not end on the fifth day").toBe(
      at(addDays(DAY.stretch, 4), "15:00").toISOString(),
    );
    expect(Number(reservation.totalPrice), "spreading the formation changed its price").toBeCloseTo(PRICE, 2);
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    await expect(page.getByTestId("formation-second-day")).toContainText(/5 journées/, { timeout: 60_000 });

    // All five days are now taken 09:00–15:00 for the next client: whatever
    // she picks there can only start once that day's journée is over.
    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, formationA.id);
    for (let offset = 0; offset < 5; offset += 1) {
      await (await dayButton(page, addDays(DAY.stretch, offset))).click();
      const free = await offeredTimes(page);
      expect(free.length, `day ${offset + 1} of the paid stretch has nothing left`).toBeGreaterThan(0);
      expect(free.filter((time) => time < "15:00"), `day ${offset + 1} of the paid stretch is still offered before 15:00`).toEqual([]);
    }
  });

  test("an indisponibilité over a client's paid journées is refused — the booking has priority", async ({ page }) => {
    await loginAs(page, trainer.credentials);
    await page.goto("/dashboard/account-settings");
    const addButton = page.getByRole("button", { name: /ajouter l.indisponibilité/i });
    await expect(addButton).toBeVisible({ timeout: 60_000 });
    const section = page.locator("div.space-y-3\\.5").filter({ has: addButton }).last();
    const dates = section.locator('input[type="date"]');
    // Only the second of the payer's two journées.
    await dates.nth(0).fill(DAY.twoDaysSecond);
    await dates.nth(1).fill(DAY.twoDaysSecond);
    await section.locator("textarea").fill("Rendez-vous médical");
    await addButton.click();

    await expect(page.getByText(/impossible de créer cette indisponibilité : ce membre du personnel a déjà une formation/i).first())
      .toBeVisible({ timeout: 60_000 });
    const saved = await prisma.timeOff.count({
      where: { staffId: trainer.staff.id, startDate: { lt: at(DAY.twoDaysSecond, "23:00") }, endDate: { gt: at(DAY.twoDaysSecond, "01:00") } },
    });
    expect(saved, "an indisponibilité was saved over a paid formation day").toBe(0);

    const kept = await customReservation(formationA.id, payer.id);
    expect(kept.status).toBe("CONFIRMED");
  });

  test("the till sells a date libre, and its ticket is admitted once on each day", async ({ page }) => {
    const buyerEmail = `e2e+comptoir.${getRunId()}@meribeauty.test`.toLowerCase();
    await loginAs(page, admin.credentials);
    await page.goto("/dashboard/boutique/point-of-sale");
    await page.locator("#counter-input").fill(titleA);
    await page.getByRole("button", { name: "Rechercher" }).click();
    await page.getByRole("button").filter({ hasText: titleA }).filter({ hasText: "à choisir avec la cliente" }).first().click();

    // The same calendar as the website, on the trainer's agenda.
    await (await dayButton(page, DAY.counter)).click();
    await offeredTimes(page);
    await picker(page).getByTestId("custom-date-days-2").click();
    expect(await offeredTimes(page)).toContain("10:00");
    await picker(page).locator('button[data-time="10:00"]').click();

    const sell = page.getByRole("button", { name: /encaisser et réserver/i });
    const composer = page.locator("form").filter({ has: sell });
    await composer.getByPlaceholder("Nom complet").fill("Cliente Comptoir Test");
    await composer.getByPlaceholder("E-mail pour le reçu").fill(buyerEmail);
    await composer.getByPlaceholder("Téléphone (facultatif)").fill(`04${String(Date.now()).slice(-8)}`);
    await sell.click();
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 60_000 });
    expect(await toast.textContent(), "the till refused the sale").toMatch(/réservation enregistrée/i);

    const sold = await prisma.formationReservation.findFirst({
      where: { customer: { email: buyerEmail }, session: { formationId: formationA.id } },
      include: { session: true, payment: true },
    });
    expect(sold, "the till did not record the sale").toBeTruthy();
    expect(sold.status).toBe("CONFIRMED");
    expect(sold.session.customerRequested).toBe(true);
    expect(sold.session.startDate.toISOString()).toBe(at(DAY.counter, "10:00").toISOString());
    expect(sold.session.endDate.toISOString()).toBe(at(DAY.counterSecond, "12:00").toISOString());
    expect(Number(sold.payment.paidAmount)).toBeCloseTo(DEPOSIT, 2);
    expect(sold.payment.status).toBe("PARTIALLY_PAID");

    // The trainer is told, like for an online booking.
    await requireMailpit();
    const staffMail = await waitForEmail({ to: trainer.user.email, subject: new RegExp(`formation réservée – ${titleA}`, "i"), timeout: 60_000 });
    expect(staffMail.Text).toContain(buyerEmail);

    // Sold: those hours are gone for the website's clients.
    await loginAs(page, customerCredentials(neighbour));
    await openPicker(page, formationA.id);
    await (await dayButton(page, DAY.counter)).click();
    expect((await offeredTimes(page)).filter((time) => time < "12:00"), "the till's hours are still offered online").toEqual([]);

    // Check-in. Day 1 is an ordinary arrival.
    const code = (await waitFor(
      () => prisma.formationReservation.findUnique({ where: { id: sold.id }, select: { checkInCode: true } }).then((r) => r?.checkInCode ?? null),
      { what: "the ticket code" },
    ));
    await loginAs(page, admin.credentials);
    const scan = async () => {
      await page.goto("/dashboard/boutique/point-of-sale");
      await page.locator("#counter-input").fill(code);
      await page.getByRole("button", { name: "Rechercher" }).click();
    };
    await scan();
    await page.getByRole("button", { name: "Pointer l'arrivée" }).click();
    await expect(page.getByText(/1 place pointée/i).first()).toBeVisible({ timeout: 30_000 });

    // Day 2: the formation is moved so that "today" is its second day and
    // the first arrival was yesterday — the clock cannot be moved instead.
    const yesterday = addDays(today, -1);
    await prisma.formationSession.update({
      where: { id: sold.session.id },
      data: { startDate: at(yesterday, "10:00"), endDate: at(today, "12:00") },
    });
    await prisma.formationReservation.update({ where: { id: sold.id }, data: { checkedInAt: at(yesterday, "09:55") } });

    await scan();
    await expect(page.getByTestId("check-in-day")).toHaveText("Journée 2 sur 2", { timeout: 30_000 });
    await page.getByRole("button", { name: "Pointer l'arrivée" }).click();
    await expect(page.getByText(/1 place pointée/i).first()).toBeVisible({ timeout: 30_000 });

    // And not twice the same day.
    await scan();
    await expect(page.getByText("Déjà pointé aujourd'hui (journée 2 sur 2).")).toBeVisible({ timeout: 30_000 });
    const after = await prisma.formationReservation.findUnique({ where: { id: sold.id } });
    expect(after.checkedInSeats, "a later day added seats").toBe(1);
  });
});
