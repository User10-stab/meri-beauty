import { test, expect } from "@playwright/test";
import { prisma, disconnect } from "../e2e-money/fixtures/db.mjs";
import { loginAs } from "../e2e-money/fixtures/auth.mjs";
import { seedAdmin, seedStaff, seedStockedVariant, readStock } from "./fixtures/seed-dashboard.mjs";

/**
 * Who may move stock, and by how much.
 *
 * `recordStockMovement` lets a STAFF session record exactly one kind of
 * movement — SALON_USAGE, "I took this off the shelf for a treatment" — and
 * refuses RESTOCK, LOSS and ADJUSTMENT outright. That is a real
 * authorisation boundary: those three let somebody move stock in any
 * direction for any stated reason, which is how inventory theft is covered
 * up, so they belong to an admin.
 *
 * The guard was correct. What was missing was any test that the two halves
 * agree — the action's own comment asserted "the UI only ever offers
 * SALON_USAGE to a STAFF user" and the dialog offered all four to everyone,
 * defaulting to RESTOCK (B9).
 *
 * So these scenarios check the pair: that staff are offered only what they
 * may do, that doing it actually moves the stock and is attributed to them,
 * and that an admin still has the full set. The server-side refusal itself
 * cannot be driven from a browser — the UI no longer offers the forbidden
 * types to staff, which is the point — so it stays a contract assertion.
 */

const START_STOCK = 20;

test.describe("stock movements are limited by who is making them", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("a staff member is offered only what the server will accept", async ({ browser }) => {
    const staff = await seedStaff({ label: "stock-staff", permissions: ["BOUTIQUE_STOCK"] });
    const { variant } = await seedStockedVariant({ label: "stock-staff", stockQuantity: START_STOCK });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, staff.credentials);
    await page.goto(`/dashboard/boutique/stock?search=${encodeURIComponent(variant.sku)}`);

    const row = page.getByRole("row").filter({ hasText: variant.sku });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole("button", { name: /^ajuster$/i }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: /ajuster le stock/i }).first();
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The whole point of B9: offering a staff member "Réapprovisionnement"
    // as the default meant filling the form in and being told "Accès non
    // autorisé", with nothing on screen saying which option was allowed.
    //
    // Counted as radios rather than matched as text — the type list is a
    // radio group, and a count is the honest way to say "one option, and it
    // is the right one" without four separate negative assertions that each
    // pass for their own reasons.
    const options = dialog.getByRole("radio");
    await expect(options, "staff are still offered types the server refuses").toHaveCount(1);
    await expect(options).toBeChecked();
    await expect(dialog.getByText(/utilisation en prestation/i)).toBeVisible();

    await dialog.getByRole("spinbutton").fill("3");
    await dialog.getByRole("button", { name: /^confirmer$/i }).click();

    // Polled on the stock itself rather than on a toast. The toast carries
    // the *action's* message ("Mouvement de stock enregistré."), not the
    // page-level string — asserting the wrong one passes only by timing out
    // against a movement that in fact succeeded, which is how this first
    // failed. And the dialog closes and refreshes on success, so the toast
    // is gone by the time a slow assertion looks for it.
    //
    // The stock figure is the outcome under test and it only changes after
    // the action returns, which is the property T6 actually asks for.
    await expect
      .poll(() => readStock(variant.id).then((s) => s.stock), {
        message: "the salon-usage movement did not reach the stock",
        timeout: 15_000,
      })
      .toBe(START_STOCK - 3);

    expect(await readStock(variant.id)).toEqual({ stock: START_STOCK - 3, reserved: 0 });

    // Attributed, not anonymous. A stock movement nobody owns is exactly the
    // record that makes a discrepancy unresolvable later.
    const movement = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id },
      orderBy: { createdAt: "desc" },
      select: { type: true, quantity: true, createdById: true },
    });
    expect(movement.type).toBe("SALON_USAGE");
    expect(movement.quantity).toBe(-3);
    expect(movement.createdById, "the movement was not attributed to the staff member").toBe(staff.user.id);

    await context.close();
  });

  test("an admin keeps the full set, and a restock adds", async ({ browser }) => {
    const admin = await seedAdmin({ label: "stock" });
    const { variant } = await seedStockedVariant({ label: "stock-admin", stockQuantity: START_STOCK });

    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAs(page, admin.credentials);
    await page.goto(`/dashboard/boutique/stock?search=${encodeURIComponent(variant.sku)}`);

    const row = page.getByRole("row").filter({ hasText: variant.sku });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole("button", { name: /^ajuster$/i }).click();

    const dialog = page.getByRole("dialog").filter({ hasText: /ajuster le stock/i }).first();
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The control for the test above: narrowing staff to a single option
    // would be just as satisfied by a dialog that shows nobody anything.
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    await expect(dialog.getByText(/réapprovisionnement/i).first()).toBeVisible();

    // RESTOCK is already the default for an admin; selecting it explicitly
    // keeps the test honest about which movement it is making.
    await dialog.getByRole("radio").first().check();
    await dialog.getByRole("spinbutton").fill("5");
    await dialog.getByRole("button", { name: /^confirmer$/i }).click();

    // Positive direction: RESTOCK is the only additive type, and getting the
    // sign wrong here would silently invent inventory.
    await expect
      .poll(() => readStock(variant.id).then((s) => s.stock), {
        message: "the restock did not reach the stock",
        timeout: 15_000,
      })
      .toBe(START_STOCK + 5);

    expect(await readStock(variant.id)).toEqual({ stock: START_STOCK + 5, reserved: 0 });

    const movement = await prisma.inventoryMovement.findFirst({
      where: { variantId: variant.id },
      orderBy: { createdAt: "desc" },
      select: { type: true, quantity: true },
    });
    expect(movement.type).toBe("RESTOCK");
    expect(movement.quantity).toBe(5);

    await context.close();
  });
});
