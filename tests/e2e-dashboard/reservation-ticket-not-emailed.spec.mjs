import { test, expect } from "@playwright/test";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { requireMailpit, assertNoEmail } from "../e2e-money/fixtures/mailpit.mjs";
import { seedAdmin, seedStaff, seedAppointment } from "./fixtures/seed-dashboard.mjs";

/**
 * By default, settling a balance stays silent for the client — but "by
 * default" now means "when the acting staff member does not hold
 * SEND_TICKET_EMAIL", not "always."
 *
 * `completeAppointment`/`settleReservation` both auto-e-mail a ticket after
 * settlement again, via the same shared, permission-gated
 * `sendTicketByEmail` (`actions/payments/send-ticket-email.js`) the manual
 * "Envoyer par e-mail" button already used — but only when the settling
 * staff member holds `SEND_TICKET_EMAIL` (admins/owners always pass). This
 * spec pins the OFF side of that gate: the staff member seeded below holds
 * only `APPOINTMENTS`, so no e-mail should go out. `send-ticket-email.spec.mjs`
 * and `settlement-auto-ticket-email.spec.mjs` pin the ON side — a staff
 * member who does hold the permission gets an automatic send, with no
 * manual click needed.
 *
 * The once-per-till-close batch sender stays permanently removed
 * (`reservation-ticket-at-close-contracts.test.js` pins that), and the ticket
 * PDF itself still never reaches the client by self-service download — only
 * the automatic/manual e-mail sends changed.
 *
 * tests/critical/counter-adjustment-documents.test.js pins the source-level
 * half of this contract. It cannot tell whether a real settlement, run
 * through the real dashboard, actually stays silent for a no-permission staff
 * member — which is the only thing a customer would ever notice. This asks a
 * running server and a real inbox.
 */

const APPOINTMENTS_PAGE = "/dashboard/appointments";
const MY_RESERVATIONS = "/mes-reservations";
const TICKET_SUBJECT = /ticket/i;
const PDF = /^application\/pdf/;

function rowFor(page, customerName) {
  return page.locator("tr").filter({ hasText: customerName }).first();
}

test.describe("settling a balance e-mails the client a ticket only when the acting staff holds SEND_TICKET_EMAIL", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a STAFF/animator session without SEND_TICKET_EMAIL completes an on-site balance and records the money, but no ticket e-mail goes out", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    await requireMailpit();

    // The exact concern this spec exists for: not an admin session, but the
    // STAFF/animator role — the one that walks a client through the counter
    // day to day. STAFF is scoped to their own book (see
    // appointment-completion-guards.spec.mjs's "a staff member's book is
    // their own"), so this appointment has to belong to the staff member who
    // then logs in and completes it themselves. Deliberately no
    // SEND_TICKET_EMAIL here — that's the whole point of this spec.
    const admin = await seedAdmin({ label: "ticketmail" });
    const staff = await seedStaff({ label: "ticketmail-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "ticketmail" });

    // A deposit paid online, a balance to collect at the counter — exactly
    // the shape that used to trigger the "Votre ticket — solde réglé" e-mail.
    const { appointment } = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: -2,
      status: "CONFIRMED",
      payment: "balanceDue",
      price: 60,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, staff.credentials);
    await page.goto(APPOINTMENTS_PAGE);

    // A freshly seeded STAFF account (unlike the admin persona the other
    // scenario in this file uses) is nagged once with a full-screen "Connect
    // Stripe" onboarding modal (components/dashboard/onboarding/
    // OnboardingModal.jsx) — dismissible, but it sits at z-[9999] and blocks
    // every click underneath until it's closed. It renders after an
    // onboarding-status fetch, not on first paint, so this waits rather than
    // checking visibility instantaneously — an immediate check races the
    // fetch and misses a nag that appears a moment later.
    try {
      await page.getByRole("button", { name: /plus tard/i }).click({ timeout: 8_000 });
    } catch {
      // No nag this time — nothing to dismiss.
    }

    // The dev database carries hundreds of appointments from earlier e2e
    // runs; the list's own client-side filter only ever sees what the server
    // handed it on load, so a search that also submits (the box sits in a
    // <form>) is what actually re-queries the server for this brand-new row.
    // Exact text: the page header also carries a global search box whose
    // placeholder starts the same way ("Rechercher un client, une
    // commande...").
    const search = page.getByPlaceholder("Rechercher un client…");
    await search.fill(customer.email);
    await search.press("Enter");

    const row = rowFor(page, customer.fullName);
    await expect(row, "the newly seeded appointment never showed up in the search").toBeVisible({
      timeout: 20_000,
    });

    // Row actions live behind a menu now, not an inline button (merged since
    // this spec was first written — see tests/critical's own "match
    // appointments contract test to merged dropdown-menu shape").
    await row.getByRole("button", { name: /actions du rendez-vous/i }).click();
    await row.getByRole("menuitem", { name: /^terminer$/i }).click();

    const dialog = page.getByRole("dialog");
    const confirmButton = dialog.getByRole("button", { name: /encaisser et terminer/i });
    await expect(confirmButton).toBeVisible();

    // Card only as EXTERNAL_TERMINAL, with its receipt reference — same
    // guard as every other on-site collection in this suite.
    await dialog.getByRole("combobox").selectOption("EXTERNAL_TERMINAL");
    await dialog.getByLabel(/référence du ticket du terminal/i).fill("E2E-TERM-NOTICKET");
    await dialog.getByRole("checkbox").check();
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible({ timeout: 20_000 });

    // ── The money really was recorded — this is not passing by accident ───
    const after = await expect
      .poll(
        async () =>
          prisma.appointment.findUnique({
            where: { id: appointment.id },
            select: { status: true, payment: { select: { status: true, remainingAmount: true } } },
          }),
        { message: "the balance was never recorded", timeout: 20_000 },
      )
      .not.toBeNull()
      .then(() =>
        prisma.appointment.findUnique({
          where: { id: appointment.id },
          select: { status: true, payment: { select: { status: true, remainingAmount: true } } },
        }),
      );
    expect(after.status).toBe("COMPLETED");
    expect(after.payment.status).toBe("PAID");
    expect(Number(after.payment.remainingAmount)).toBeCloseTo(0, 2);

    const settlement = await prisma.transaction.findFirst({
      where: { payment: { appointmentId: appointment.id }, transactionType: "FINAL_PAYMENT", isDeleted: false },
    });
    expect(settlement, "the balance shows PAID but left no FINAL_PAYMENT transaction").not.toBeNull();

    // ── And yet nothing was e-mailed to the customer ───────────────────────
    // A generous window: the send used to be effectively synchronous with
    // the settlement above, so several seconds of silence on a "ticket"
    // subject is meaningful, not merely "checked too soon".
    await assertNoEmail({ to: customer.email, subject: TICKET_SUBJECT, timeout: 10_000 });

    await context.close();
  });
});

test.describe("the ticket PDF stays behind for staff, and off the client's own reach", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("staff can still reprint it; the reservation's own owner cannot fetch or see it any more", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    const admin = await seedAdmin({ label: "ticketaccess" });
    const staff = await seedStaff({ label: "ticketaccess-staff", permissions: ["APPOINTMENTS"] });
    const customer = await seedCustomer({ label: "ticketaccess" });

    // Already paid in full — a Payment with a real collection, the shape the
    // reprint route is built to serve staff from. Future rather than past so
    // it is guaranteed to show up on the customer's own reservations page,
    // same as customer-self-service.spec.mjs's own scenarios.
    const { payment } = await seedAppointment({
      staff: staff.staff,
      customer,
      createdByUserId: admin.user.id,
      hoursFromNow: 24,
      status: "CONFIRMED",
      payment: "paid",
      price: 60,
    });

    // STAFF, not admin: canAccessDashboard gates this route on role alone, so
    // the persona that matters to prove is the one this whole change is
    // about — a STAFF/animator session, not just an admin's.
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await loginAs(staffPage, staff.credentials);

    const customerContext = await browser.newContext();
    const customerPage = await customerContext.newPage();
    await loginAs(customerPage, customerCredentials(customer));

    // ── Staff/dashboard reprint still works ────────────────────────────────
    // A generous timeout on this first call only: react-pdf renders through a
    // Next dev route that has to compile on its first hit, which can outrun
    // the config's default 15s action timeout.
    const staffResponse = await staffPage.request.get(`/api/payments/${payment.id}/ticket`, { timeout: 60_000 });
    expect(staffResponse.status()).toBe(200);
    expect(staffResponse.headers()["content-type"]).toMatch(PDF);
    expect((await staffResponse.body()).subarray(0, 4).toString()).toBe("%PDF");

    // ── The reservation's own owner is refused — the one thing that changed ─
    const ownerResponse = await customerPage.request.get(`/api/payments/${payment.id}/ticket`);
    expect(ownerResponse.status(), "a client could still download their own ticket").toBe(403);

    // ── An anonymous request is refused before anything is looked up ──────
    // The bare `request` fixture, not a logged-in context's — it carries no
    // session cookie at all.
    const anonResponse = await request.get(`/api/payments/${payment.id}/ticket`);
    expect(anonResponse.status()).toBe(401);

    // ── And the download link itself is gone from the customer's own page ──
    await customerPage.goto(MY_RESERVATIONS);
    // Sanity: the settled appointment is actually on the page (the card
    // names the staff member, not the customer's own name) — otherwise the
    // link assertion below would trivially pass on an empty/broken page.
    await expect(customerPage.getByText(staff.user.fullName).first()).toBeVisible({ timeout: 20_000 });
    await expect(
      customerPage.getByRole("link", { name: /télécharger le ticket de caisse/i }),
      "the client's own reservations page still offers a ticket download",
    ).toHaveCount(0);

    await staffContext.close();
    await customerContext.close();
  });
});
