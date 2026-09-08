import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedFormationSession } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { taggedEmail, getRunId } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStaff, createStaffService, tagPhone } from "./fixtures/seed-dashboard.mjs";

/**
 * The unified counter, end to end: one search box that finds an existing
 * booking, or starts a brand-new sale, for a customer who may not exist yet.
 *
 * Everything under tests/critical/counter-*-contracts.test.js already pins
 * the source text of every rule these two scenarios exercise — this file
 * exists because a contract test proves the rule is written down, not that
 * clicking through a real page actually reaches it. Two things in
 * particular cannot be proven any other way:
 *
 *   1. The composer only ever appears because CounterSurface routed a real
 *      search result into its pendingService/pendingSession prop — nothing
 *      here opens it directly.
 *   2. The B2B address requirement (trap #10 of the unified-counter plan,
 *      and the bug fixed the same day this spec was written) is asserted
 *      against the actual rendered form, not against the composer's source.
 *
 * WORKSHOP is deliberately not exercised here — scripts/purge-e2e-dashboard-
 * data.mjs says outright it "does not understand workshop reservations and
 * would delete their customers out from under them if the database let it."
 * FORMATION and WORKSHOP share the exact same composer code path
 * (COUNTER_CREATE_KINDS in actions/counter/create-reservation.js), so
 * FORMATION alone proves the SESSION half without writing rows this suite's
 * own cleanup script cannot see.
 *
 * Both scenarios pay by EXTERNAL_TERMINAL, never CASH — CASH hard-blocks
 * without an open till session, and opening one here would mean either
 * leaving a real closed session in the cash-book history (see
 * caisse-till-session.spec.mjs's own note on why that cost is unavoidable
 * there) or touching a colleague's open one. The formation scenario also
 * stays on DEPOSIT rather than FULL payment: a full payment from a
 * VAT-validated customer issues a real, gapless-numbered invoice, and
 * proving invoice issuance itself is already tests/critical's job — this
 * spec only needs to prove the sale and the address requirement reached the
 * database, not consume a legal invoice number to do it.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";

/**
 * The "Pointage & encaissement" section — everything from the omnibar down
 * through the results and the composer. Scoping every locator to it (rather
 * than the whole page) is not optional: CounterCart, the retail till right
 * below in the DOM, reuses the exact same CounterBuyerForm component for its
 * own buyer capture, so "Nom complet" / "E-mail pour le reçu" / "Téléphone"
 * exist twice on this page — once here, once in the till. An unscoped
 * locator resolves to both and Playwright's strict mode refuses to guess.
 */
function counterSection(page) {
  return page.locator("section").filter({ hasText: /pointage/i });
}

test.describe("the unified counter creates a sale from its one search box", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let admin;

  test.beforeAll(async ({ browser }) => {
    admin = await seedAdmin({ label: "counter" });
    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    await page?.close();
    await disconnect();
  });

  test("selling a new atelier/formation seat to a brand-new B2B client requires an address, and the booking is then findable as an existing one", async () => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const { formation, session, price, depositPercentage } = await seedFormationSession({
      price: 100,
      capacity: 5,
      depositPercentage: 50,
      daysAhead: 20,
    });
    const buyerEmail = taggedEmail("formation-buyer", runId);
    const buyerFullName = "Client Formation Automatise";
    const terminalRef = `E2E-${runId}-FORM`;

    await page.goto(POS_PAGE);
    const counter = counterSection(page);

    // ── Find the session through the one search box ──────────────────────
    await counter.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(formation.title);
    await counter.getByRole("button", { name: /^rechercher$/i }).click();

    // Grouped results: the session must land under "Vendre / créer", not
    // mixed in with existing bookings — the whole point of the grouping fix.
    await expect(counter.getByText(/vendre.*cr[ée]er une r[ée]servation/i)).toBeVisible({ timeout: 20_000 });
    const sessionRow = counter.getByRole("button").filter({ hasText: formation.title });
    await expect(sessionRow.first(), "the seeded formation session did not surface in search").toBeVisible();
    await sessionRow.first().click();

    // ── The composer opened itself, pre-filled — no button was clicked to open it ──
    await expect(counter.getByRole("heading", { name: /vendre une place d.atelier ou de formation/i })).toBeVisible({
      timeout: 20_000,
    });

    // ── A brand-new client, entered right here ────────────────────────────
    await counter.getByPlaceholder(/^nom complet$/i).fill(buyerFullName);
    await counter.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(buyerEmail);
    await counter.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:formation-buyer`));

    // ── Turning them B2B must demand an address — this is the bug that was
    //    just fixed: a VAT number with no address must never reach the server.
    await expect(counter.getByText(/adresse de facturation obligatoire/i)).toHaveCount(0);
    // A real Belgian VAT number (valid mod-97 checksum), not a French one —
    // a validated non-Belgian EU company is correctly repriced by
    // resolveServiceVatPolicy (reverse-charge strips the Belgian VAT out of
    // the TTC catalogue price), which is real, separate behaviour with its
    // own coverage; this test's numeric assertions below stay simple only
    // because staying in-country avoids that repricing branch entirely.
    await counter.getByPlaceholder(/BE0123456789/i).fill("BE1234567894");
    await expect(
      counter.getByText(/adresse de facturation obligatoire/i),
      "typing a VAT number did not reveal the address block",
    ).toBeVisible({ timeout: 10_000 });

    await counter.getByPlaceholder(/^rue et num[ée]ro$/i).fill("Rue de Test 99");
    await counter.getByPlaceholder(/^code postal$/i).fill("1000");
    await counter.getByPlaceholder(/^ville$/i).fill("Bruxelles");
    // Country defaults to BE — nothing to fill.

    // ── Deposit, by card — see the file header for why ────────────────────
    await counter.getByLabel(/carte.*terminal/i).check();
    await counter.getByLabel(/r[ée]f[ée]rence du ticket du terminal/i).fill(terminalRef);
    await counter.getByLabel(/j.?ai bien re[çc]u/i).check();

    await counter.getByRole("button", { name: /encaisser et r[ée]server/i }).click();

    // Playwright's click resolves as soon as the DOM event is dispatched,
    // not once the server action it triggers has finished — waiting for the
    // success toast is the honest signal that the whole action (including
    // its audit log write) has actually completed before anything below
    // queries the database for it.
    await expect(page.getByText(/r[ée]servation enregistr[ée]e/i)).toBeVisible({ timeout: 30_000 });

    // ── It reached the database ───────────────────────────────────────────
    await expect
      .poll(
        async () =>
          prisma.formationReservation.count({ where: { sessionId: session.id, customer: { email: buyerEmail } } }),
        { message: "no formation reservation was created for the new customer", timeout: 30_000 },
      )
      .toBe(1);

    const reservation = await prisma.formationReservation.findFirst({
      where: { sessionId: session.id, customer: { email: buyerEmail } },
      include: { customer: true, payment: { include: { transactions: true } } },
    });

    expect(reservation.status).toBe("CONFIRMED");
    expect(reservation.seatsCount).toBe(1);
    expect(Number(reservation.totalPrice)).toBeCloseTo(price, 2);
    const expectedDeposit = Number(((price * depositPercentage) / 100).toFixed(2));
    expect(Number(reservation.depositAmount)).toBeCloseTo(expectedDeposit, 2);
    expect(Number(reservation.balanceDue)).toBeCloseTo(price - expectedDeposit, 2);

    expect(reservation.payment.status).toBe("PARTIALLY_PAID");
    expect(reservation.payment.paymentType).toBe("DEPOSIT");
    expect(Number(reservation.payment.paidAmount)).toBeCloseTo(expectedDeposit, 2);
    expect(Number(reservation.payment.remainingAmount)).toBeCloseTo(price - expectedDeposit, 2);

    const transactions = reservation.payment.transactions.filter((t) => !t.isDeleted);
    expect(transactions, "no collection was recorded for the deposit").toHaveLength(1);
    expect(transactions[0].method).toBe("CARD");
    expect(transactions[0].transactionType).toBe("DEPOSIT");
    expect(transactions[0].manualReference).toBe(terminalRef);
    // No till session was open, and none needed to be — card never blocks.
    expect(transactions[0].pieceNumber).toBeNull();

    // ── The B2B identity actually reached the User row ────────────────────
    const buyer = reservation.customer;
    expect(buyer.role).toBe("CUSTOMER");
    expect(buyer.isCompany).toBe(true);
    expect(buyer.vatNumber).toBe("BE1234567894");
    expect(buyer.vatValidatedAt, "the VAT number was never validated (VIES bypass not active?)").not.toBeNull();
    expect(buyer.addressLine1).toBe("Rue de Test 99");
    expect(buyer.addressCity).toBe("Bruxelles");
    expect(buyer.addressPostalCode).toBe("1000");

    const log = await prisma.auditLog.findFirst({
      where: { action: "reservation.created_at_counter", entityType: "FormationReservation", entityId: reservation.id },
    });
    expect(log, "the counter sale left no audit trail").not.toBeNull();
    expect(log.actorId).toBe(admin.user.id);

    // ── And now findable again, as an existing booking, not a new sale ────
    await counter.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(buyerFullName);
    await counter.getByRole("button", { name: /^rechercher$/i }).click();

    await expect(counter.getByText(/r[ée]servations existantes/i)).toBeVisible({ timeout: 20_000 });
    const bookingRow = counter.getByRole("button").filter({ hasText: buyerFullName });
    await expect(bookingRow.first(), "the just-created reservation did not come back as an existing booking").toBeVisible();
    await bookingRow.first().click();

    // Scoped to the fiche's own markup (an <h2> title, a <dd> holder name)
    // rather than plain text — the results list a moment ago showed this
    // exact same text in a <p>, so an unscoped assertion here would pass
    // even if the click failed to actually replace the list with the fiche.
    await expect(counter.locator("h2", { hasText: formation.title }), "the fiche did not open").toBeVisible({
      timeout: 20_000,
    });
    await expect(counter.locator("dd", { hasText: buyerFullName })).toBeVisible();
  });

  test("selling a walk-in appointment to a brand-new, purely B2C client never asks for an address", async () => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const staffMember = await seedStaff({ label: "counterwalkin", permissions: [] });
    const { service, staffService } = await createStaffService({
      staff: staffMember.staff,
      createdByUserId: admin.user.id,
      price: 45,
    });

    const buyerEmail = taggedEmail("walkin-buyer", runId);
    const buyerFullName = "Client Prestation Automatise";
    const terminalRef = `E2E-${runId}-SVC`;

    await page.goto(POS_PAGE);
    const counter = counterSection(page);

    // Searching by the service name alone ("Pedicure", say) is not safe: the
    // dev database accumulates the same generic service on many leftover,
    // unpurged staff members from other e2e runs, and searchCounterServices
    // caps its results at 20 (actions/counter/walk-in-service.js) — this
    // scenario's own row can be crowded out entirely. The staff member's own
    // tagged name is unique enough to search by directly.
    await counter.getByPlaceholder(/nom pr[ée]nom|nom du client|nom du service/i).fill(staffMember.user.fullName);
    await counter.getByRole("button", { name: /^rechercher$/i }).click();
    await expect(counter.getByText(/vendre.*cr[ée]er une r[ée]servation/i)).toBeVisible({ timeout: 20_000 });
    const serviceRow = counter
      .getByRole("button")
      .filter({ hasText: service.name })
      .filter({ hasText: staffMember.user.fullName });
    await expect(serviceRow.first(), "the seeded service did not surface in search").toBeVisible();
    await serviceRow.first().click();

    await expect(counter.getByRole("heading", { name: /encaisser une prestation du catalogue/i })).toBeVisible({
      timeout: 20_000,
    });

    await counter.getByPlaceholder(/^nom complet$/i).fill(buyerFullName);
    await counter.getByPlaceholder(/e-?mail pour le re[çc]u/i).fill(buyerEmail);
    await counter.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:walkin-buyer`));

    // No VAT number typed at all — a plain B2C walk-in must never be asked
    // for an address (the till's blanket "no address on file" rule, which
    // the unified-counter plan calls out as trap #10, must not have leaked
    // in here).
    await expect(counter.getByText(/adresse de facturation obligatoire/i)).toHaveCount(0);

    await counter.getByLabel(/carte.*terminal/i).check();
    await counter.getByLabel(/r[ée]f[ée]rence du ticket du terminal/i).fill(terminalRef);
    await counter.getByLabel(/j.?ai bien re[çc]u/i).check();

    await counter.getByRole("button", { name: /encaisser et enregistrer/i }).click();

    // createCounterWalkInService creates the row CONFIRMED, completes it in a
    // second transaction, then writes the origin audit log as a third,
    // separate step — all three still inside the one server action call, but
    // Playwright's click resolves the instant the DOM event fires, not once
    // that whole call has returned. Waiting for the success toast is the
    // honest signal that every one of those steps has actually finished
    // before anything below queries the database for them.
    await expect(page.getByText(/prestation enregistr[ée]e et encaiss[ée]e/i)).toBeVisible({ timeout: 30_000 });

    const appointment = await prisma.appointment.findFirst({
      where: { staffServiceId: staffService.id, user: { email: buyerEmail } },
      include: { user: true, payment: { include: { transactions: true } } },
    });

    // createCounterWalkInService creates it CONFIRMED, then immediately
    // completes it — a walk-in service has already happened by definition.
    expect(appointment.status).toBe("COMPLETED");

    expect(appointment.payment.status).toBe("PAID");
    expect(appointment.payment.paymentType).toBe("ON_SITE");
    expect(Number(appointment.payment.paidAmount)).toBeCloseTo(45, 2);
    expect(Number(appointment.payment.remainingAmount)).toBeCloseTo(0, 2);

    const transactions = appointment.payment.transactions.filter((t) => !t.isDeleted);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].method).toBe("CARD");
    expect(transactions[0].transactionType).toBe("FINAL_PAYMENT");
    expect(transactions[0].manualReference).toBe(terminalRef);

    expect(appointment.user.role).toBe("CUSTOMER");
    expect(appointment.user.isCompany).toBe(false);
    expect(appointment.user.vatNumber).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { action: "reservation.created_at_counter", entityType: "Appointment", entityId: appointment.id },
    });
    expect(log, "the walk-in sale left no audit trail").not.toBeNull();
    expect(log.actorId).toBe(admin.user.id);
  });
});
