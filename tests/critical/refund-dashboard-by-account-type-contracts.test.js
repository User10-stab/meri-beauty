import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Where an independent is sent to refund her own sale.
 *
 * Connect gives her one of two very different things, and the difference is
 * not cosmetic:
 *
 *   Standard — her own full Stripe dashboard, with a Refund button.
 *   Express  — a Stripe-hosted mini dashboard with NO refund control at all.
 *
 * The worklist used to assume Express for everyone. That was wrong in both
 * directions at once, and each direction failed silently:
 *
 *   it called `accounts.createLoginLink` — an Express-only API — for Standard
 *   holders, so Rose and Lyly, the two who actually CAN refund, got a raw
 *   "Erreur Stripe : …" toast instead of their dashboard;
 *
 *   it told Express holders to "rembourser depuis votre tableau de bord",
 *   which for Julie is an instruction with no button behind it. She cannot
 *   do it, nothing says so, and the refund stays owed indefinitely.
 *
 * Neither shows up in any other test: both render fine, and both leave a
 * PENDING leg that looks exactly like one nobody has got to yet.
 */
describe("the refund worklist sends her to the dashboard she actually has", () => {
  const panel = () => source("components/dashboard/operations/OutstandingRefunds.jsx");

  test("the account type reaches the panel at all", () => {
    const action = source("actions/dashboard/cancel-and-refund.js");
    // Read from the payee first — the appointment's practitioner is only the
    // fallback for rows written before payees existed.
    expect(action).toContain("payeeStaff: {");
    expect(action).toContain("stripeAccountType: true");
    expect(action).toContain("connectedAccountType: owner?.stripeAccountType ?? null");
  });

  test("Express is singled out, and only for an independent's own money", () => {
    expect(panel()).toContain('const expressPayee = independent && leg.connectedAccountType === "express";');
  });

  test("an Express payee is told the salon must do it, and is offered no dead-end button", () => {
    const code = panel();
    expect(code).toMatch(/Le salon doit effectuer ce remboursement pour vous/);
    // The button is suppressed rather than merely relabelled: a control that
    // leads nowhere reads as "already handled".
    expect(code).toContain("!expressPayee && <OwnStripeDashboardButton");
  });

  test("a Standard payee gets an account-scoped link to the payment itself", () => {
    const code = panel();
    const start = code.indexOf("function OwnStripeDashboardButton(");
    expect(start, "OwnStripeDashboardButton is gone — re-anchor this test").toBeGreaterThan(-1);
    const button = code.slice(start, code.indexOf("\nfunction ", start + 1));

    expect(button).toContain("https://dashboard.stripe.com/${accountId}/payments/${paymentIntentId}");
    // Scoped to HER account, checked inside this function only. An unscoped
    // /payments/<pi> resolves against the PLATFORM dashboard, where a direct
    // charge does not exist — it reads as "no such payment", which an admin
    // reasonably mistakes for "already refunded". The same file legitimately
    // builds the unscoped form elsewhere, for the salon's own platform
    // charges, so this cannot be asserted against the whole file.
    expect(button).not.toMatch(/dashboard\.stripe\.com\/payments\//);
  });

  test("the Express-only login link is never the path for a Standard account", () => {
    const code = panel();
    const linkCall = code.indexOf("await createLoginLink()");
    const standardBranch = code.indexOf("if (accountId && paymentIntentId)");
    expect(standardBranch).toBeGreaterThan(-1);
    // The Standard branch returns before the login-link path is ever reached.
    expect(standardBranch).toBeLessThan(linkCall);
  });

  test("the stale 'every independent is Express' claim is gone from the comment", () => {
    expect(panel()).not.toContain("An independent practitioner's own Stripe is an Express account");
  });
});
