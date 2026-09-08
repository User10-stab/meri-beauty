import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { getRunId, taggedEmail } from "../e2e-money/fixtures/run-id.mjs";
import { seedAdmin, seedStaff, createStaffService, tagPhone } from "./fixtures/seed-dashboard.mjs";

/**
 * The gap this closes, proven through a real browser click rather than at
 * source level only: a CASH walk-in sale used to be accepted with no till
 * session open, leaving a Transaction with a real piece number but
 * cashSessionId: null — permanently invisible from every Livre de caisse
 * (see R0001–R0003 in the dev database, discovered while investigating why
 * the rendez-vous series started at R0004). completeAppointment now refuses
 * that write; CashSessionGate.jsx is what stops staff from ever reaching the
 * refusal in the first place, by requiring a one-click "ouvrir la caisse"
 * inline before the button will even submit.
 *
 * Deliberately closes whatever till happens to be open when this spec starts
 * — there is exactly one CashSession system-wide (see
 * caisse-till-session.spec.mjs's own file doc), and this test cannot exercise
 * "no session open" without there being none. Closed properly, with a real
 * computed reconciliation (not a fabricated zero), the same way
 * closeCashSession itself would. A fresh session is left open behind it —
 * this spec never leaves the counter in a state nobody can sell from.
 */

const POS_PAGE = "/dashboard/boutique/point-of-sale";
const OPENING_FLOAT = 100;

function counterSection(page) {
  return page.locator("section").filter({ hasText: /pointage/i });
}

async function closeWhateverTillIsOpen(actorId) {
  const existing = await prisma.cashSession.findFirst({ where: { closedAt: null } });
  if (!existing) return null;

  const [cashInAgg, cashOutAgg, movements] = await Promise.all([
    prisma.transaction.aggregate({
      where: { cashSessionId: existing.id, method: "CASH", transactionType: { not: "REFUND" }, isDeleted: false },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { cashSessionId: existing.id, method: "CASH", transactionType: "REFUND", isDeleted: false },
      _sum: { amount: true },
    }),
    prisma.cashMovement.findMany({ where: { cashSessionId: existing.id }, select: { type: true, amount: true } }),
  ]);
  const movementsIn = movements.filter((m) => m.type === "CASH_IN").reduce((sum, m) => sum + Number(m.amount), 0);
  const movementsOut = movements.filter((m) => m.type !== "CASH_IN").reduce((sum, m) => sum + Number(m.amount), 0);
  const expectedCash =
    Number(existing.openingFloat) +
    Number(cashInAgg._sum.amount ?? 0) -
    Number(cashOutAgg._sum.amount ?? 0) +
    movementsIn -
    movementsOut;

  await prisma.cashSession.update({
    where: { id: existing.id },
    data: { closedAt: new Date(), closedById: actorId, expectedCash, countedCash: expectedCash, variance: 0 },
  });
  return existing.id;
}

test.describe("the inline cash-session gate", () => {
  test.describe.configure({ mode: "serial" });

  let page;
  let admin;

  test.beforeAll(async ({ browser }) => {
    admin = await seedAdmin({ label: "cashgate" });
    await closeWhateverTillIsOpen(admin.user.id);
    page = await browser.newPage();
    await loginAs(page, admin.credentials);
  });

  test.afterAll(async () => {
    // Left open on purpose — this spec closed whatever was open to run its
    // scenario, and must not leave the counter unable to sell anything.
    await page?.close();
    await disconnect();
  });

  test("a cash walk-in sale is blocked until the till is opened inline, then reaches the database with a real session attached", async () => {
    test.setTimeout(180_000);

    const runId = getRunId();
    const staffMember = await seedStaff({ label: "cashgatewalkin", permissions: [] });
    const { service, staffService } = await createStaffService({
      staff: staffMember.staff,
      createdByUserId: admin.user.id,
      price: 38,
    });

    const buyerEmail = taggedEmail("cashgate-buyer", runId);
    const buyerFullName = "Client Especes Automatise";

    await page.goto(POS_PAGE);
    const counter = counterSection(page);

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
    await counter.getByPlaceholder(/t[ée]l[ée]phone/i).fill(tagPhone(`${runId}:cashgate-buyer`));

    // Card is the default method — switch to cash, which is the one branch
    // with no till open right now (beforeAll just closed the only session).
    await counter.getByLabel(/esp[èe]ces/i).check();

    const submitButton = counter.getByRole("button", { name: /encaisser et enregistrer/i });

    // The gate, not a passive warning: visible, and the submit button
    // genuinely disabled rather than merely discouraged.
    await expect(counter.getByText(/aucune session de caisse n.est ouverte/i)).toBeVisible({ timeout: 10_000 });
    await expect(submitButton).toBeDisabled();

    await counter.getByLabel(/fond de caisse/i).fill(String(OPENING_FLOAT));
    await counter.getByRole("button", { name: /^ouvrir la caisse$/i }).click();

    // Resolved inline — the gate goes away and the same button, on the same
    // screen, becomes usable without a page navigation or a lost entry.
    await expect(page.getByText(/^caisse ouverte\.$/i)).toBeVisible({ timeout: 15_000 });
    await expect(counter.getByText(/aucune session de caisse n.est ouverte/i)).toHaveCount(0);

    await counter.getByLabel(/j.?ai bien re[çc]u/i).check();
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    await expect(page.getByText(/prestation enregistr[ée]e et encaiss[ée]e/i)).toBeVisible({ timeout: 30_000 });

    const newSession = await prisma.cashSession.findFirst({ where: { closedAt: null } });
    expect(newSession, "opening the till inline did not create a real session").not.toBeNull();
    expect(Number(newSession.openingFloat)).toBeCloseTo(OPENING_FLOAT, 2);

    const appointment = await prisma.appointment.findFirst({
      where: { staffServiceId: staffService.id, user: { email: buyerEmail } },
      include: { payment: { include: { transactions: true } } },
    });
    expect(appointment.status).toBe("COMPLETED");

    const transactions = appointment.payment.transactions.filter((t) => !t.isDeleted);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].method).toBe("CASH");
    // The whole point: a real session id, not null — and it's the one this
    // test just opened, not a stale reference to whatever was closed above.
    expect(transactions[0].cashSessionId).toBe(newSession.id);
    expect(transactions[0].pieceNumber, "no cash-book piece number was allocated").not.toBeNull();
    expect(transactions[0].pieceNumber).toMatch(/^R\d{4}$/);
  });
});
