import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { seedCustomer } from "../e2e-money/fixtures/seed-money.mjs";
import { seedStockedVariant, seedOrder } from "./fixtures/seed-dashboard.mjs";
import { loginAsAdmin } from "../e2e-money/fixtures/auth.mjs";

/**
 * The Belgian/EU 14-day right of withdrawal, driven end to end.
 *
 * `PROJECT_REQUIREMENTS.md` §2 records this as the requirement that had to
 * *correct* the client — "no refunds after delivery" was explicitly illegal
 * for EU distance selling and could not be built as asked. It is therefore
 * the single most consequential rule in the boutique, and until now nothing
 * exercised it: there are zero `ReturnRequest` rows in the dev database, and
 * the existing contract tests assert that the guards exist rather than that
 * a customer can actually get their money back.
 *
 * The distinction these scenarios are really about is the one the law makes
 * and a naive implementation does not: **the 14-day clock governs a change
 * of mind and nothing else.** A defective or wrong item is not rétractation
 * and is not time-barred by it. `requestReturn` is the authoritative gate;
 * `getReturnableOrder` only reports the window so the page can steer.
 *
 * No Stripe here on purpose. Everything these tests assert happens before a
 * single euro actually moves: the request, the approval, and the completion
 * that records what is owed. This application never calls
 * stripe.refunds.create — an OWNER/ADMIN performs the card refund by hand and
 * the charge.refunded webhook settles it — so "the refund happened" here
 * means a RefundOperation exists for the right amount against the right
 * payment intent, which is exactly what an admin acts on.
 */

const PRICE = 26;
const WITHDRAWAL_DAYS = 14;
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** A delivered, paid, consumer purchase — the only state a return starts from. */
async function seedCollectedOrder({ label, collectedDaysAgo, quantity = 1 }) {
  const customer = await seedCustomer({ label });
  const { variant } = await seedStockedVariant({ label, stockQuantity: 10, price: PRICE });
  const order = await seedOrder({
    variant,
    customer,
    status: "COMPLETED",
    fulfilmentMode: "PICKUP_PREPAID",
    quantity,
    payment: "paid",
    // withdrawalWindow() reads pickedUpAt ?? collectedAt. Without one there
    // is no window at all and these tests would be exercising a different
    // branch than they claim to.
    pickedUpAt: daysAgo(collectedDaysAgo),
  });
  return { customer, variant, order };
}

/**
 * The reason dropdown, scoped to the page body.
 *
 * The public header carries its own language <select>, so a bare
 * getByRole("combobox") is a strict-mode violation rather than the form
 * control — which is how this spec failed on its first run.
 */
const reasonSelect = (page) => page.getByRole("main").getByRole("combobox");

/**
 * Both public entry points are rate limited, and hitting the limit looks
 * exactly like the feature being broken: the request simply is not recorded,
 * and a database assertion fails with "expected 1, received 0".
 *
 * The ceilings are low because they should be — this is an unauthenticated
 * endpoint that reveals whether an order number and e-mail go together:
 *
 *   lookup   10 per IP / 5 min,  10 per order number / 15 min
 *   request   5 per IP / 10 min
 *
 * Three scenarios make four requests, so one run fits and a second run
 * inside ten minutes does not. Rather than let that surface as a false
 * failure, it is detected and the test skips saying so. The limiter is
 * in-memory (lib/rate-limit.js), so restarting the dev server also clears it.
 */
const RATE_LIMITED = /trop de tentatives/i;

async function skipIfRateLimited(page, what) {
  const toast = page.locator("[data-sonner-toast]");
  const text = await toast.first().innerText().catch(() => "");
  if (RATE_LIMITED.test(text)) {
    test.skip(
      true,
      `Rate limited on ${what}. This is the production guard doing its job, not a defect: ` +
        "the public returns endpoints allow 5 requests per IP per 10 minutes. Wait for the window " +
        "to clear, or restart the dev server — the limiter is in-memory.",
    );
  }
}

async function lookUpOrder(page, order, customer) {
  await page.goto("/boutique/returns");
  const cookieBanner = page.getByRole("button", { name: /^j'accepte$/i });
  if (await cookieBanner.isVisible().catch(() => false)) await cookieBanner.click();

  await page.getByPlaceholder(/numéro de commande/i).fill(String(order.orderNumber));
  await page.getByPlaceholder(/email utilisé/i).fill(customer.email);
  await page.getByRole("button", { name: /retrouver ma commande/i }).click();
  await skipIfRateLimited(page, "the order lookup");
}

/** Fills the reason and submits, then distinguishes a refusal from a throttle. */
async function submitReturn(page, { reason, text }) {
  await reasonSelect(page).selectOption(reason);
  await page.getByPlaceholder(/expliquez brièvement/i).fill(text);
  await page.getByRole("button", { name: /envoyer la demande de retour/i }).click();
  await skipIfRateLimited(page, "the return request");
}

test.describe("the 14-day right of withdrawal", () => {
  // Serial: the three scenarios share one IP rate-limit budget, so a
  // parallel run would throttle itself and report the feature as broken.
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await disconnect();
  });

  test("a consumer inside the window can request a return without an account", async ({ page }) => {
    test.setTimeout(120_000);
    const { customer, order } = await seedCollectedOrder({ label: "return-inside", collectedDaysAgo: 2 });

    // No login anywhere in this test. The lookup is deliberately public —
    // order number plus the e-mail it was placed with — because a guest
    // checkout has no account to sign into, and a consumer right that
    // required one would not be exercisable by half the buyers.
    await lookUpOrder(page, order, customer);

    await expect(page.getByRole("heading", { name: /motif du retour/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("main").getByRole("checkbox").first().check();
    await submitReturn(page, { reason: "CHANGED_MIND", text: "Test e2e — changement d'avis dans le délai légal." });

    // The database, not the page: a confirmation screen proves the button
    // worked, not that a claim was recorded against the right order.
    await expect
      .poll(() => prisma.returnRequest.count({ where: { orderId: order.id } }), {
        message: "no ReturnRequest was created for this order",
        timeout: 20_000,
      })
      .toBe(1);

    const request = await prisma.returnRequest.findFirst({
      where: { orderId: order.id },
      include: { items: true },
    });
    expect(request.status).toBe("REQUESTED");
    expect(request.reasonCategory).toBe("CHANGED_MIND");
    expect(request.items).toHaveLength(1);
  });

  test("past the window a change of mind is refused, but a defect is not", async ({ page }) => {
    test.setTimeout(120_000);
    const { customer, order } = await seedCollectedOrder({
      label: "return-outside",
      collectedDaysAgo: WITHDRAWAL_DAYS + 6,
    });

    await lookUpOrder(page, order, customer);
    await expect(page.getByRole("heading", { name: /motif du retour/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("main").getByRole("checkbox").first().check();
    await submitReturn(page, { reason: "CHANGED_MIND", text: "Test e2e — hors délai, doit être refusé." });

    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /rétractation/i }),
      "an out-of-window change of mind was not refused",
    ).toBeVisible({ timeout: 15_000 });
    expect(
      await prisma.returnRequest.count({ where: { orderId: order.id } }),
      "an out-of-window change of mind was accepted",
    ).toBe(0);

    // The half a naive implementation gets wrong. A defective product is not
    // rétractation: the 14-day clock has nothing to do with it, and refusing
    // it on those grounds would deny a separate statutory right — the exact
    // conflation actions/boutique/returns.js calls out at requestReturn.
    await submitReturn(page, { reason: "DEFECTIVE", text: "Test e2e — produit défectueux, hors délai de rétractation." });

    await expect
      .poll(() => prisma.returnRequest.count({ where: { orderId: order.id, reasonCategory: "DEFECTIVE" } }), {
        message: "a defect claim was time-barred by the withdrawal window, which does not govern it",
        timeout: 20_000,
      })
      .toBe(1);
  });

  test("staff approve it and the consumer's refund is actually recorded — B6", async ({ page }) => {
    test.setTimeout(180_000);
    const { customer, order, variant } = await seedCollectedOrder({ label: "return-approve", collectedDaysAgo: 3 });

    // Snapshot the legal sequence before anything runs. Credit-note numbers
    // are gapless and global, so "no credit note was issued" has to be
    // asserted as a count that did not move — a findFirst scoped to this
    // order would pass just as happily if one were issued against somebody
    // else's invoice.
    const creditNotesBefore = await prisma.creditNote.count();

    await lookUpOrder(page, order, customer);
    await expect(page.getByRole("heading", { name: /motif du retour/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("main").getByRole("checkbox").first().check();
    await submitReturn(page, { reason: "CHANGED_MIND", text: "Test e2e — parcours complet jusqu'au remboursement." });

    await expect
      .poll(() => prisma.returnRequest.count({ where: { orderId: order.id } }), { timeout: 20_000 })
      .toBe(1);

    await loginAsAdmin(page);
    await page.goto("/dashboard/boutique/returns");

    const row = page.getByRole("row").filter({ hasText: customer.email });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.click();

    await page.getByRole("button", { name: /^approuver$/i }).click();

    await expect
      .poll(
        async () => (await prisma.returnRequest.findFirst({ where: { orderId: order.id } }))?.status,
        { message: "the return was not approved", timeout: 20_000 },
      )
      .toBe("APPROVED");

    // ── This customer has no invoice, and must not need one ───────────────
    //
    // B6 was that completeReturnRequest refused outright without one, while
    // an invoice is only ever issued to a buyer with a validated VAT number.
    // A particulier never has one, so the statutory right belonged to
    // companies only. The premise is re-asserted rather than assumed: if a
    // particulier ever starts receiving invoices, this scenario would be
    // silently testing the B2B path and proving nothing about the consumer
    // one.
    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id },
      select: { id: true, paidAmount: true, invoice: { select: { number: true } } },
    });
    expect(
      payment.invoice,
      "a particulier's order now carries an invoice — this scenario is no longer testing the consumer path",
    ).toBeNull();

    // The drawer closes on every successful action (run() calls onClose), so
    // approving dismissed it — the completion step needs it reopened.
    //
    // But not until the list has caught up. The per-item condition selects
    // only render while the row's status is APPROVED, and the row handed
    // back by a click is whatever the last refetch put in client state.
    // Reopening too early gives a drawer still holding the REQUESTED row,
    // with no condition selects in it at all — which fails as "the select
    // never appeared" rather than "the click was early". Wait for the row
    // itself to say it is approved.
    await expect(row).toContainText(/approuvée/i, { timeout: 20_000 });
    await row.click();

    // Identified by the options it contains rather than by position. "The
    // last select on the page" picked up the status filter instead, and the
    // failure that produced ("did not find some options") describes the
    // symptom rather than the mistake.
    await page.locator('select:has(option[value="SEALED_RESELLABLE"])').selectOption("SEALED_RESELLABLE");
    await page.getByRole("button", { name: /confirmer réception .* rembourser/i }).click();

    // Matched by content across all toasts, not "the toast". The approval
    // toast from a moment ago is still on screen, and asserting on the first
    // element found simply re-reads that one until it times out.
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: /remboursements dus|retour finalisé/i }),
      "completion did not report a queued refund",
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(
        async () => (await prisma.returnRequest.findFirst({ where: { orderId: order.id } }))?.status,
        { message: "the consumer's return still did not complete", timeout: 20_000 },
      )
      .toBe("COMPLETED");

    // ── What the admin will actually act on ───────────────────────────────
    //
    // The order was paid ONLINE, so no money moves here by design: the debt
    // is recorded as a RefundOperation with a PENDING leg carrying the
    // payment intent, and Operations shows it until a human has refunded it
    // in Stripe.
    const operation = await prisma.refundOperation.findFirst({
      where: { paymentId: payment.id },
      include: { legs: true },
    });
    expect(operation, "the consumer's refund was never queued for anyone to pay").not.toBeNull();
    expect(Number(operation.totalAmount)).toBeCloseTo(Number(payment.paidAmount), 2);
    expect(operation.trigger).toBe("SHOP_RETURN");
    expect(operation.status).toBe("PENDING");
    expect(operation.legs).toHaveLength(1);
    expect(operation.legs[0].method).toBe("ONLINE");
    expect(operation.legs[0].status).toBe("PENDING");

    // The leg has to point back at the collection it reverses, and carry
    // that collection's payment intent forward — that pair is what the
    // Operations panel prints so an admin refunds the right charge for the
    // right amount.
    //
    // Asserted as propagation rather than as a non-null id on purpose. This
    // suite never touches Stripe, so its fixture's collection has no real
    // intent to carry; demanding a truthy one here would only be asserting
    // that the seed invented a plausible pi_ — and a plausible pi_ sitting
    // in the dev database is exactly the kind of thing a reconciliation job
    // would later try to look up. A real intent surviving this path is
    // covered where a real charge exists: e2e-money/boutique-order-online-
    // refund.spec.mjs.
    const collection = await prisma.transaction.findFirst({
      where: { paymentId: payment.id, transactionType: "FINAL_PAYMENT", isDeleted: false },
      select: { id: true, stripePaymentIntentId: true },
    });
    expect(operation.legs[0].sourceTransactionId, "the leg reverses no particular collection").toBe(
      collection.id,
    );
    expect(
      operation.legs[0].stripePaymentIntentId,
      "the collection's payment intent did not survive onto the refund leg",
    ).toBe(collection.stripePaymentIntentId);

    // ── And no financial document was invented to make it possible ────────
    //
    // The fix had one way to go wrong that would look identical from the
    // customer's side: issuing an invoice or a credit note for a B2C sale so
    // the old code path could still run. Both burn a number from a gapless
    // legal sequence for a document that references nothing.
    expect(operation.creditNoteId, "a credit note was issued with no invoice to correct").toBeNull();
    expect(operation.invoiceId, "a refund was attached to an invoice this order never had").toBeNull();
    expect(
      (await prisma.returnRequest.findFirst({ where: { orderId: order.id } })).creditNoteId,
    ).toBeNull();
    expect(
      await prisma.creditNote.count(),
      "the credit-note sequence advanced for a sale that was never invoiced",
    ).toBe(creditNotesBefore);
    // Re-read after completion, not just before it: the failure mode this
    // guards against is the fix quietly issuing the invoice it used to
    // demand. Invoice owns the relation, so this reads through it.
    expect(
      (await prisma.payment.findFirst({
        where: { orderId: order.id },
        select: { invoice: { select: { number: true } } },
      })).invoice,
      "an invoice was issued retroactively to a particulier",
    ).toBeNull();

    // ── The goods came back too ───────────────────────────────────────────
    // SEALED_RESELLABLE is the one condition that returns stock to the
    // shelf; anything else is received into quarantine.
    const movement = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id, type: "RETURN" },
      orderBy: { createdAt: "desc" },
    });
    expect(movement, "a sealed, resalable return never went back into stock").not.toBeNull();
    expect(movement.newStock).toBe(movement.previousStock + 1);
  });
});
