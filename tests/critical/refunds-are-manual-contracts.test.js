import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Confirmed policy, 2026-09-02: this application never refunds anyone.
 *
 * An OWNER/ADMIN performs every card refund by hand in the Stripe dashboard
 * and hands cash back at the counter. The cancel-and-refund flow cancels the
 * booking, releases the seat or stock, issues the accounting document and
 * tells the admin exactly what to pay back — and stops there.
 *
 * These are the tests that keep that true. A future change that reintroduces
 * an automatic refund into this flow should fail here loudly rather than
 * quietly start moving customers' money again.
 */

describe("the cancel-and-refund flow moves no money", () => {
  const refundLibFiles = readdirSync(`${root}lib/refunds`).filter((name) => name.endsWith(".js"));

  test("no module under lib/refunds/ calls Stripe at all", () => {
    for (const file of refundLibFiles) {
      const content = source(`lib/refunds/${file}`);
      // Strip block comments: the modules explain at length WHY they do not
      // call Stripe, and those sentences must not trip the check.
      const code = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `lib/refunds/${file} must not call stripe.refunds.create`).not.toContain(
        "refunds.create",
      );
      expect(code, `lib/refunds/${file} must not import the Stripe client`).not.toMatch(
        /import\s*\{[^}]*\bstripe\b[^}]*\}\s*from\s*["']@\/lib\/stripe["']/,
      );
    }
  });

  test("the module that used to call Stripe is gone, not merely unused", () => {
    expect(existsSync(`${root}lib/refunds/execute-online-legs.js`)).toBe(false);
  });

  test("the server action does not call Stripe either", () => {
    const action = source("actions/dashboard/cancel-and-refund.js").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(action).not.toContain("refunds.create");
    expect(action).not.toContain("executeOnlineLegs");
  });

  test("no idempotency key is minted for a call that is never made", () => {
    const open = source("lib/refunds/open-refund-operation.js");
    expect(open).toContain("stripeIdempotencyKey: null");
    expect(open).not.toContain("randomUUID()");
  });
});

describe("the admin is told exactly what to refund", () => {
  const panel = source("components/dashboard/operations/OutstandingRefunds.jsx");
  const dialog = source("components/dashboard/operations/CancelAndRefundDialog.jsx");

  // The mixed-payment trap, in its human form: the invoice says 21 € but
  // Stripe only ever took the 10,50 € acompte. Refunding the invoice total
  // by hand would over-refund by the cash half.
  test("the Stripe row insists on the leg amount, not the invoice total", () => {
    expect(panel).toContain("pas le total de la facture");
    expect(panel).toContain("exactement");
  });

  test("the Stripe row prints the payment_intent and links to it", () => {
    expect(panel).toContain("https://dashboard.stripe.com/payments/");
    expect(panel).toContain("stripePaymentIntentId");
  });

  test("a Stripe leg offers no confirm button — the webhook is the evidence", () => {
    const stripeRow = panel.slice(panel.indexOf("function StripeLegRow"), panel.indexOf("function InPersonLegRow"));
    expect(stripeRow).not.toContain("confirmManualRefundLeg");
    expect(stripeRow).toContain("enregistrée automatiquement dès que Stripe le signale");
  });

  test("cash and terminal legs still require a human attestation", () => {
    const inPerson = panel.slice(panel.indexOf("function InPersonLegRow"));
    expect(inPerson).toContain("confirmManualRefundLeg");
    expect(inPerson).toContain("Référence du ticket du terminal");
    expect(inPerson).toContain("avoir remis");
  });

  test("the dialog never claims anything is refunded automatically", () => {
    expect(dialog).not.toContain("Remboursement Stripe automatique");
    expect(dialog).toContain("Cette action ne rembourse rien");
    expect(dialog).toContain("À rembourser dans Stripe (manuellement)");
  });
});

describe("the worklist cannot be cleared without the money actually moving", () => {
  const action = source("actions/dashboard/cancel-and-refund.js");

  test("outstanding legs include the ones that failed, not just the untouched", () => {
    expect(action).toContain('status: { in: ["PENDING", "MANUAL_CONFIRMATION_REQUIRED", "FAILED"] }');
  });

  test("a leg leaves the list only via settleRefundLeg", () => {
    const settle = source("lib/refunds/settle-leg.js");
    expect(settle).toContain('status: "SUCCEEDED"');
    // And that only ever happens alongside a real ledger row.
    expect(settle).toContain("tx.transaction.create");
    expect(settle).toContain("refundTransactionId: refundTransaction.id");
  });
});

describe("a hand-typed Stripe amount is recorded as what it was", () => {
  const settle = source("lib/refunds/settle-leg.js");
  const schema = source("prisma/schema.prisma");

  test("the leg keeps both the planned and the settled figure", () => {
    expect(schema).toContain("settledAmount Decimal?   @db.Decimal(10, 2)");
  });

  test("the ledger records Stripe's amount, not the planned one", () => {
    expect(settle).toContain("const actualAmount = stripe?.amount != null ? Number(stripe.amount) : plannedAmount");
    expect(settle).toContain("amount: actualAmount");
  });

  test("a mismatch is surfaced rather than smoothed over", () => {
    expect(settle).toContain("const mismatched = Math.abs(actualAmount - plannedAmount) > REFUND_EPSILON");
    expect(settle).toContain("settledAmount: mismatched ? actualAmount : null");
    expect(settle).toContain("différent du montant prévu");
  });

  test("the webhook passes Stripe's own refund amount through", () => {
    const webhook = source("app/api/webhooks/stripe/route.js");
    expect(webhook).toContain("amount: round2((refund.amount ?? 0) / 100)");
    expect(webhook).toContain("amount: candidate.amount");
  });
});

describe("converting a legacy path redirects its refund, never just deletes it", () => {
  // The danger when removing a stripe.refunds.create call is doing only
  // that: the booking still cancels, the credit note still issues, and the
  // money silently never goes. Every converted path must therefore record
  // what is owed in the same transaction that cancels.
  const convertedSites = [
    "actions/workshops/manage-reservation.js",
    "actions/formations/manage-reservation.js",
  ];

  for (const file of convertedSites) {
    test(`${file} queues the refund it no longer makes`, () => {
      const content = source(file);
      expect(content).not.toContain("refunds.create");
      expect(content).toContain("queueManualRefund(tx");
      // In the caller's own transaction, so the debt cannot outlive a
      // rolled-back cancellation or vice versa.
      expect(content).toContain("issueCreditNote(tx");
    });
  }

  // Not asserted across every converted site: only the atelier e-mail
  // template takes a `refunded` flag. The formation one never mentions
  // money, so there is nothing there to get wrong.
  test("no converted path tells the customer the money already moved", () => {
    expect(source("actions/workshops/manage-reservation.js")).toContain("refunded: false");
    expect(source("actions/formations/manage-reservation.js")).not.toContain("refunded: true");
  });

  test("queueManualRefund itself cannot call Stripe", () => {
    const helper = source("lib/refunds/queue-manual-refund.js").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(helper).not.toContain("refunds.create");
    expect(helper).not.toContain("@/lib/stripe");
  });
});

describe("the not-yet-converted refund paths are still intact", () => {
  // These still refund automatically. Listed explicitly so that converting
  // one is a deliberate act with a test to update, not a silent side effect
  // of editing something nearby. Shrink this list as each is converted.
  const remainingAutoRefundSites = [
    "actions/appointment/manage-appointment.js",
    "actions/boutique/orders.js",
    "actions/boutique/returns.js",
    "lib/appointments/expire-stale-appointments.js",
    "lib/payments/retry-failed-refunds.js",
    // Deliberately permanent: customer self-cancel outside the 48h window
    // keeps its automatic refund by explicit decision (2026-09-02).
    "actions/reservation/cancel-reservation.js",
  ];

  for (const file of remainingAutoRefundSites) {
    test(`${file} still refunds automatically`, () => {
      expect(source(file)).toContain("refunds.create");
    });
  }
});
