import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer, seedWorkshopSession, customerCredentials } from "../e2e-money/fixtures/seed-money.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";

/**
 * The queue for a full atelier.
 *
 * A waiting list is only worth anything if its order is trustworthy: the
 * whole promise to the customer is "you are third, and the two ahead of you
 * were there first". `joinWaitingList` assigns a position by reading the
 * current maximum and adding one, which is a read-then-write and therefore
 * only safe because the whole block runs inside a transaction serialised per
 * session. Nothing tested that the numbers actually come out distinct and in
 * order against a real database.
 *
 * The second scenario is the one that protects the first. Joining twice must
 * return the place already held rather than issuing a second one — otherwise
 * a customer who refreshes an impatient browser quietly moves themselves
 * down the queue they are already in, and everybody behind them is wrong too.
 *
 * `?waitingList=true` forces the form without having to fill the session
 * first: `showWaitingListForm` is `(isFull || wantsWaitingList) && !priorityValid`.
 * The queue logic is identical either way, and filling a session to reach it
 * would test capacity rather than ordering.
 */

async function joinTheQueue(page, { activityId, sessionId, customer }) {
  await loginAs(page, customerCredentials(customer));
  await page.goto(`/reservation-atelier?activity=${activityId}&session=${sessionId}&waitingList=true`);

  const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
  if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

  const phone = page.locator("#workshop-phone");
  if (await phone.isVisible().catch(() => false)) {
    // A seeded customer already has one, but the form re-collects it and
    // validateCustomerIdentity requires it server-side.
    await phone.fill(customer.phone ?? `04${String(Date.now()).slice(-8)}`);
  }

  await page
    .locator("label", { hasText: /j'ai lu et j'accepte/i })
    .locator('input[type="checkbox"]')
    .check();

  await page.getByRole("button", { name: /s'inscrire à la liste d'attente/i }).click();
}

test.describe("the waiting list keeps its order", () => {
  // Serial: both scenarios queue against the same seeded session, and the
  // second one's assertions are about positions the first one created.
  test.describe.configure({ mode: "serial" });

  let workshop;
  let first;
  let second;

  test.beforeAll(async () => {
    workshop = await seedWorkshopSession({ price: 55, capacity: 2 });
    first = await seedCustomer({ label: "waitlist-first" });
    second = await seedCustomer({ label: "waitlist-second" });
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test("two people joining get first and second place, in that order", async ({ browser }) => {
    test.setTimeout(180_000);

    for (const [index, customer] of [first, second].entries()) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await joinTheQueue(page, {
        activityId: workshop.activity.id,
        sessionId: workshop.session.id,
        customer,
      });

      await expect(
        page.getByRole("heading", { name: /vous êtes inscrit\(e\) sur la liste d'attente/i }),
        `customer ${index + 1} was not added to the queue`,
      ).toBeVisible({ timeout: 30_000 });

      await context.close();
    }

    const queue = await prisma.waitingListEntry.findMany({
      where: { sessionId: workshop.session.id },
      orderBy: { position: "asc" },
      select: { customerId: true, position: true, status: true, seatsRequested: true },
    });

    expect(queue, "the queue does not hold exactly the two people who joined").toHaveLength(2);
    expect(queue[0].customerId).toBe(first.id);
    expect(queue[1].customerId).toBe(second.id);

    // Distinct and contiguous, not merely sorted. Two entries both at
    // position 1 would still come back in an order, and the page would
    // cheerfully tell both customers they were first.
    expect(queue.map((entry) => entry.position)).toEqual([1, 2]);
    expect(queue.every((entry) => entry.status === "WAITING")).toBe(true);
  });

  test("joining again returns the place already held, not a new one", async ({ browser }) => {
    test.setTimeout(180_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    await joinTheQueue(page, {
      activityId: workshop.activity.id,
      sessionId: workshop.session.id,
      customer: first,
    });

    // The page says something different, which is the point: the customer is
    // reassured rather than silently re-queued.
    await expect(
      page.getByRole("heading", { name: /vous étiez déjà sur la liste d'attente/i }),
      "a second join was treated as a new registration",
    ).toBeVisible({ timeout: 30_000 });

    await context.close();

    const queue = await prisma.waitingListEntry.findMany({
      where: { sessionId: workshop.session.id },
      orderBy: { position: "asc" },
      select: { customerId: true, position: true },
    });

    // Still two entries, still in the same order. The failure this guards
    // against is not a duplicate row — it is the first customer being moved
    // to position 3 behind somebody who arrived after them.
    expect(queue).toHaveLength(2);
    expect(queue[0].customerId).toBe(first.id);
    expect(queue[0].position).toBe(1);
    expect(queue[1].customerId).toBe(second.id);
    expect(queue[1].position).toBe(2);
  });
});
