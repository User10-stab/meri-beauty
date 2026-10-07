import { test, expect } from "@playwright/test";
import { prisma, disconnect, waitFor } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { requireMailpit, waitForEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStaff, seedAppointment, createStaffService } from "./fixtures/seed-dashboard.mjs";

/**
 * A visit: several prestations booked together for one client from
 * « Ajouter un rendez-vous ».
 *
 * Each prestation stays its own appointment — that is what blocks each staff
 * member's agenda and keeps her money hers — but the client, the staff and
 * the counter deal with ONE visit:
 *
 *   booking      one visit, one e-mail and one check-in ticket for the
 *                client, one e-mail per staff member;
 *   same staff   the second prestation cannot start inside the first one's
 *                duration plus its rest time;
 *   other staff  overlapping is allowed, announced while filling in the
 *                form and confirmed again on submit;
 *   « Terminer » the whole visit in one go, cashed as one operation per
 *                staff member — one staff member doing two prestations is a
 *                single Payment, a single Transaction.
 *
 * Asserted against the database and the inbox rather than the screen: the
 * point of a visit is what it does NOT multiply.
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
  prisma.appointment.findMany({
    where: { userId, isDeleted: false },
    orderBy: { startTime: "asc" },
    include: { payment: { include: { transactions: true } } },
  });

/**
 * Two prestations that have already happened, tied into one visit — the
 * state « Terminer » works on. Booked straight into the database because the
 * dialog (rightly) refuses a slot in the past.
 */
async function seedPastVisit({ admin, customer, legs }) {
  const visit = await prisma.appointmentVisit.create({ data: {} });
  const seeded = [];
  for (const leg of legs) {
    const row = await seedAppointment({
      staff: leg.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: leg.hoursFromNow,
      status: "CONFIRMED",
      price: leg.price ?? 60,
    });
    await prisma.appointment.update({ where: { id: row.appointment.id }, data: { visitId: visit.id } });
    seeded.push(row.appointment);
  }
  return { visit, appointments: seeded };
}

/** Opens « Terminer » for one appointment from the appointments list. */
async function openTerminer(page, appointmentId) {
  await page.goto(`/dashboard/appointments?appointmentId=${appointmentId}`);
  await page.getByRole("button", { name: "Actions du rendez-vous" }).first().click();
  await page.getByRole("menuitem", { name: "Terminer" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Terminer la visite" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function payByTerminalAndConfirm(dialog) {
  await dialog.getByRole("radio", { name: /terminal externe/i }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /encaisser et terminer/i }).click();
}

test.describe("a visit — several prestations for one client", () => {
  test.beforeAll(async () => {
    await requireMailpit();
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("two staff members at the same time: warned, confirmed on submit, ONE visit with one client e-mail and one ticket", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-two-staff" });
    const lyly = await seedStaff({ label: "visit-a", permissions: ["APPOINTMENTS"] });
    const rose = await seedStaff({ label: "visit-b", permissions: ["APPOINTMENTS"] });
    const a = await createStaffService({ staff: lyly.staff, createdByUserId: admin.user.id });
    const b = await createStaffService({ staff: rose.staff, createdByUserId: admin.user.id });
    const customer = await seedCustomer({ label: "visit-two-staff" });
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
        // The visit's ticket is minted just after the rows are written.
        return rows.length === 2 && rows[0].checkInCode ? rows : null;
      },
      { what: "two appointments for the client, with the visit's ticket", timeout: 30_000 },
    );
    expect(created.map((row) => row.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(created.map((row) => row.staffId)).toEqual([lyly.staff.id, rose.staff.id]);
    expect(created.map((row) => brusselsTime(row.startTime))).toEqual(["10:00", "10:30"]);
    // One visit, not two unrelated rendez-vous.
    expect(created[0].visitId, "the prestations were not tied into a visit").toBeTruthy();
    expect(created[1].visitId).toBe(created[0].visitId);

    // ONE e-mail for the client, listing the whole visit, with ONE ticket —
    // and one e-mail for each staff member.
    await waitForEmail({ to: customer.email });
    await waitForEmail({ to: lyly.user.email });
    await waitForEmail({ to: rose.user.email });
    // Let a duplicate arrive, if one was ever going to.
    await page.waitForTimeout(3_000);
    expect(await emailsTo(customer.email), "the client got one e-mail per prestation").toHaveLength(1);
    const clientMail = await waitForEmail({ to: customer.email });
    expect(clientMail.Text).toContain("10:00");
    expect(clientMail.Text).toContain("10:30");
    expect(clientMail.Text.match(/R-[0-9A-F]{6,}/g) ?? [], "the visit carries exactly one check-in code").toHaveLength(1);
    expect(clientMail.Text).toContain(created[0].checkInCode);
    expect(await emailsTo(lyly.user.email)).toHaveLength(1);
    expect(await emailsTo(rose.user.email)).toHaveLength(1);

    // The list shows each prestation as part of a visit.
    await page.goto(`/dashboard/appointments?appointmentId=${created[0].id}`);
    await expect(page.getByRole("row").filter({ hasText: customer.email }).getByText("Visite")).toBeVisible();
  });

  test("same staff member: slots inside the first prestation's rest time are greyed out, and she gets one e-mail", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-same-staff" });
    const staff = await seedStaff({ label: "visit-same", permissions: ["APPOINTMENTS"] });
    const s = await createStaffService({ staff: staff.staff, createdByUserId: admin.user.id });
    // 60 min + 15 min of rest.
    await prisma.staffService.update({ where: { id: s.staffService.id }, data: { margin: 15 } });
    const customer = await seedCustomer({ label: "visit-same-staff" });
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
    expect(created[1].visitId).toBe(created[0].visitId);

    // Her two prestations in a single e-mail.
    const staffMail = await waitForEmail({ to: staff.user.email });
    await page.waitForTimeout(3_000);
    expect(await emailsTo(staff.user.email), "the staff member got one e-mail per prestation").toHaveLength(1);
    expect(staffMail.Text).toContain("13:00");
    expect(staffMail.Text).toContain("14:30");
  });

  test("« Terminer toute la visite », one staff member: both prestations closed, ONE payment and ONE operation", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-terminer-same" });
    const staff = await seedStaff({ label: "visit-terminer-same", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "visit-terminer-same" });
    const { appointments } = await seedPastVisit({
      admin,
      customer,
      legs: [
        { staff: staff.staff, hoursFromNow: -4 },
        { staff: staff.staff, hoursFromNow: -2 },
      ],
    });

    await loginAs(page, admin.credentials);
    const dialog = await openTerminer(page, appointments[0].id);

    // Both prestations are listed, and the whole visit is what is proposed.
    await expect(dialog.getByTestId("visit-prestations").getByRole("listitem")).toHaveCount(2);
    await expect(dialog.getByRole("radio", { name: /toute la visite/i })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("radio", { name: /toute la visite/i })).toContainText("Une seule opération");
    await expect(dialog.getByTestId("complete-amount-due")).toContainText("120");
    await payByTerminalAndConfirm(dialog);

    const rows = await waitFor(
      async () => {
        const all = await appointmentsOf(customer.id);
        return all.every((row) => row.status === "COMPLETED") ? all : null;
      },
      { what: "both prestations of the visit completed", timeout: 30_000 },
    );

    // One Payment, on the prestation the button was pressed on, for the total.
    const paid = rows.filter((row) => row.payment);
    expect(paid, "each prestation got its own payment — two operations instead of one").toHaveLength(1);
    expect(paid[0].id).toBe(appointments[0].id);
    expect(paid[0].payment.status).toBe("PAID");
    expect(Number(paid[0].payment.totalAmount)).toBeCloseTo(120, 2);
    expect(Number(paid[0].payment.paidAmount)).toBeCloseTo(120, 2);
    expect(paid[0].payment.transactions).toHaveLength(1);
    expect(Number(paid[0].payment.transactions[0].amount)).toBeCloseTo(120, 2);
    expect(paid[0].payment.transactions[0].method).toBe("CARD");

    // The other prestation points at that payment and has none of its own.
    const other = rows.find((row) => row.id === appointments[1].id);
    expect(other.payment).toBeNull();
    expect(other.coveredByPaymentId).toBe(paid[0].payment.id);

    // The single operation is on the salon's ledger.
    await page.goto("/dashboard/operations");
    await expect(page.getByText(customer.email, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("« Terminer toute la visite », two staff members: one operation EACH", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-terminer-two" });
    const first = await seedStaff({ label: "visit-terminer-a", permissions: ["APPOINTMENTS"] });
    const second = await seedStaff({ label: "visit-terminer-b", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "visit-terminer-two" });
    const { appointments } = await seedPastVisit({
      admin,
      customer,
      legs: [
        { staff: first.staff, hoursFromNow: -3 },
        { staff: second.staff, hoursFromNow: -3 },
      ],
    });

    await loginAs(page, admin.credentials);
    const dialog = await openTerminer(page, appointments[0].id);
    await expect(dialog.getByRole("radio", { name: /toute la visite/i })).toContainText("2 opérations");
    await expect(dialog.getByTestId("complete-amount-due")).toContainText("120");
    await payByTerminalAndConfirm(dialog);

    const rows = await waitFor(
      async () => {
        const all = await appointmentsOf(customer.id);
        return all.every((row) => row.status === "COMPLETED") ? all : null;
      },
      { what: "both prestations of the visit completed", timeout: 30_000 },
    );

    // Each staff member's prestation is her own payment — never merged.
    expect(rows.every((row) => row.payment), "a staff member's prestation was cashed on someone else's payment").toBe(true);
    for (const row of rows) {
      expect(row.coveredByPaymentId).toBeNull();
      expect(row.payment.status).toBe("PAID");
      expect(Number(row.payment.totalAmount)).toBeCloseTo(60, 2);
      expect(row.payment.transactions).toHaveLength(1);
    }
  });

  test("« Cette prestation seulement »: the rest of the visit stays open", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-terminer-single" });
    const staff = await seedStaff({ label: "visit-terminer-single", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "visit-terminer-single" });
    const { appointments } = await seedPastVisit({
      admin,
      customer,
      legs: [
        { staff: staff.staff, hoursFromNow: -4 },
        { staff: staff.staff, hoursFromNow: -2 },
      ],
    });

    await loginAs(page, admin.credentials);
    const dialog = await openTerminer(page, appointments[0].id);
    await dialog.getByRole("radio", { name: /cette prestation seulement/i }).click();
    await expect(dialog.getByTestId("complete-amount-due")).toContainText("60");
    await payByTerminalAndConfirm(dialog);

    const rows = await waitFor(
      async () => {
        const all = await appointmentsOf(customer.id);
        return all.some((row) => row.status === "COMPLETED") ? all : null;
      },
      { what: "the chosen prestation completed", timeout: 30_000 },
    );
    const done = rows.find((row) => row.id === appointments[0].id);
    const open = rows.find((row) => row.id === appointments[1].id);
    expect(done.status).toBe("COMPLETED");
    expect(Number(done.payment.totalAmount)).toBeCloseTo(60, 2);
    expect(open.status, "the other prestation was closed too").toBe("CONFIRMED");
    expect(open.payment).toBeNull();
    expect(open.coveredByPaymentId).toBeNull();
  });

  test("a company client: ONE invoice for the visit, one line per prestation — and Opérations lists both", async ({ page }) => {
    const admin = await seedAdmin({ label: "visit-invoice" });
    const staff = await seedStaff({ label: "visit-invoice", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "visit-invoice" });
    // A VAT-validated company: the only kind of client that gets an invoice
    // (a particulier gets a ticket). Set directly rather than driven through
    // VIES — same shortcut as workshop-admin-transfer.spec.mjs.
    await prisma.user.update({
      where: { id: customer.id },
      data: {
        isCompany: true,
        vatNumber: "BE0123456749",
        vatValidatedAt: new Date(),
        vatValidationName: "Société Test Visite SRL",
        vatValidationAddress: "Avenue de la Note 7, 4000 Liège",
      },
    });
    await prisma.billingProfile.create({
      data: { userId: customer.id, companyLegalName: "Société Test Visite SRL", companyRegistrationNo: "BE0123456749" },
    });

    // Two DIFFERENT services, so the two lines can be told apart.
    const services = await prisma.service.findMany({
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      take: 2,
      select: { id: true, name: true },
    });
    expect(services, "the database needs two services for this scenario").toHaveLength(2);
    const visit = await prisma.appointmentVisit.create({ data: {} });
    const HOUR = 60 * 60 * 1000;
    const legs = [
      { service: services[0], price: 45, start: new Date(Date.now() - 4 * HOUR) },
      { service: services[1], price: 70, start: new Date(Date.now() - 2 * HOUR) },
    ];
    const appointments = [];
    for (const leg of legs) {
      const staffService = await prisma.staffService.create({
        data: {
          staffId: staff.staff.id,
          serviceId: leg.service.id,
          createdById: admin.user.id,
          price: leg.price,
          duration: 60,
          photo: "/images/placeholder.png",
          isActive: true,
        },
      });
      appointments.push(
        await prisma.appointment.create({
          data: {
            userId: customer.id,
            staffServiceId: staffService.id,
            staffId: staff.staff.id,
            date: leg.start,
            startTime: leg.start,
            endTime: new Date(leg.start.getTime() + HOUR),
            status: "CONFIRMED",
            visitId: visit.id,
          },
        })
      );
    }

    await loginAs(page, admin.credentials);
    const dialog = await openTerminer(page, appointments[0].id);
    await expect(dialog.getByTestId("complete-amount-due")).toContainText("115");
    await payByTerminalAndConfirm(dialog);

    const invoice = await waitFor(
      async () => {
        const payment = await prisma.payment.findUnique({
          where: { appointmentId: appointments[0].id },
          include: { invoice: { include: { lines: { orderBy: { unitPrice: "asc" } } } }, transactions: true },
        });
        return payment?.invoice ? { ...payment.invoice, payment } : null;
      },
      { what: "the visit's invoice", timeout: 30_000 },
    );

    // One invoice for the whole visit, each prestation on its own line.
    expect(await prisma.invoice.count({ where: { payment: { appointment: { userId: customer.id } } } })).toBe(1);
    expect(Number(invoice.totalInclVat)).toBeCloseTo(115, 2);
    expect(invoice.lines.map((line) => line.description)).toEqual([services[0].name, services[1].name]);
    expect(invoice.lines.map((line) => Number(line.unitPrice))).toEqual([45, 70]);
    console.log(`\n  visit invoice issued: ${invoice.number} — ${invoice.lines.map((l) => `${l.description} ${Number(l.unitPrice).toFixed(2)} €`).join(" | ")}\n`);

    // Opérations shows what the single operation is made of.
    await page.goto("/dashboard/operations");
    const row = page.getByRole("row").filter({ hasText: customer.email }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: /voir \/ gérer/i }).click();
    const prestations = page.getByTestId("operation-prestations");
    await expect(prestations).toBeVisible({ timeout: 20_000 });
    await expect(prestations).toContainText("Prestations (2)");
    await expect(prestations).toContainText(services[0].name);
    await expect(prestations).toContainText(services[1].name);
  });
});
