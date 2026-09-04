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
    expect(settle).toContain("const increment = stripe?.amount != null ? Number(stripe.amount) : plannedAmount");
    // The ledger row carries the money that moved in THIS event, never the
    // running total, or a second partial refund double-counts the first.
    expect(settle).toContain("amount: increment,");
  });

  test("a mismatch is surfaced rather than smoothed over", () => {
    expect(settle).toContain("const underRefunded = shortfall > REFUND_EPSILON");
    expect(settle).toContain("const overRefunded = cumulative - plannedAmount > REFUND_EPSILON");
    expect(settle).toContain("settledAmount: mismatched ? cumulative : null");
    expect(settle).toContain("il reste");
  });

  // The defect the live audit caught: charge.refunds is NOT expanded on a
  // charge.refunded payload, so reading only charge.refunds.data meant the
  // "amount unknown" fallback ran every single time — the mismatch guard was
  // dead code and every refund was recorded at its planned figure.
  test("the webhook never assumes the planned amount when Stripe's payload omits the refund list", () => {
    const webhook = source("app/api/webhooks/stripe/route.js");
    // Fetches the list rather than giving up on it...
    expect(webhook).toContain("stripe.refunds.list(");
    expect(webhook).toContain("{ charge: charge.id, limit: 10 }");
    // ...and if even that fails, derives from amount_refunded, which is
    // always present, minus what the ledger already holds.
    expect(webhook).toContain("const chargeRefundedTotal = round2((charge.amount_refunded ?? 0) / 100)");
    expect(webhook).toContain("amount = round2(chargeRefundedTotal - Number(recorded._sum.amount ?? 0))");
  });
});

describe("a rendez-vous refund is a Connect charge, not a platform one", () => {
  // Appointments are Stripe Connect DIRECT charges on the staff member's own
  // account. Any Stripe call made while handling their events, and any
  // dashboard link built for them, has to name that account or it silently
  // addresses the platform account instead — where the payment does not exist.
  const webhook = source("app/api/webhooks/stripe/route.js");

  test("charge.refunded carries the connected account through", () => {
    expect(webhook).toContain("handleChargeRefunded(event.data.object, event.account ?? null)");
    expect(webhook).toContain("async function handleChargeRefunded(charge, connectedAccountId = null)");
    expect(webhook).toContain("async function settleOwnRefundLegs(charge, connectedAccountId = null)");
    expect(webhook).toContain("connectedAccountId ? { stripeAccount: connectedAccountId } : undefined");
  });

  test("the worklist links to the staff member's own Stripe dashboard", () => {
    const action = source("actions/dashboard/cancel-and-refund.js");
    expect(action).toContain("connectedAccountId: staff?.stripeAccountId ?? null");

    const panel = source("components/dashboard/operations/OutstandingRefunds.jsx");
    expect(panel).toContain("`https://dashboard.stripe.com/${account}/payments/${paymentIntentId}`");
    // And says so, so an admin who lands on an empty page knows why.
    expect(panel).toContain("il n&apos;apparaît pas");
  });
});

describe("an under-refund cannot be mistaken for a completed one", () => {
  // Live audit: an admin refunded 50 € against a 75 € leg. The operation went
  // COMPLETED and the customer was told 75 € had been returned. Real money
  // moved, so the leg must stay SUCCEEDED (a redelivered webhook must not
  // record the 50 € twice) — but nothing downstream may treat it as settled.
  test("operation status only counts a leg whose settled amount covers what was owed", () => {
    const status = source("lib/refunds/operation-status.js");
    expect(status).toContain("leg.settledAmount == null || Number(leg.settledAmount) + EPSILON >= Number(leg.amount)");
    expect(status).toContain("const succeeded = legs.filter(isFullySettled).length");
  });

  test("the manual B2C confirmation holds a short leg as outstanding", () => {
    const notify = source("lib/refunds/send-b2c-refund-confirmation.js");
    expect(notify).toContain("leg.settledAmount != null && Number(leg.settledAmount) + 0.01 < Number(leg.amount)");
    // And announces what actually went back, not what was planned.
    expect(notify).toContain("const settledOf = (leg) => Number(leg.settledAmount ?? leg.amount)");
  });

  test("the worklist keeps a short leg visible and asks only for the remainder", () => {
    const action = source("actions/dashboard/cancel-and-refund.js");
    expect(action).toContain('{ status: "SUCCEEDED", settledAmount: { not: null } }');

    const panel = source("components/dashboard/operations/OutstandingRefunds.jsx");
    expect(panel).toContain("const amountDue = isPartial ? shortfall : Number(leg.amount)");
    expect(panel).toContain("Déjà remboursé");
  });
});

describe("wording never claims money has moved when it has not", () => {
  test("the dialog header agrees with its own body", () => {
    const dialog = source("components/dashboard/operations/CancelAndRefundDialog.jsx");
    expect(dialog).not.toContain("crédite la facture et rembourse le client");
    expect(dialog).toContain("Elle ne rembourse rien elle-même");
  });

  test("approving an exceptional request does not announce a completed refund", () => {
    expect(source("actions/reservations/cancellation-request.js")).not.toContain("l'acompte est remboursé.");
    expect(source("actions/reservation/cancellation-exception-request.js")).not.toContain(
      "l'acompte est remboursé intégralement.",
    );
  });

  // The atelier e-mail had only two states, so "approved but not yet sent"
  // fell through to "not refundable" — telling a customer the opposite of the
  // decision just taken. That in-between state is now the normal one.
  test("the atelier cancellation e-mail has a pending-refund state and carries the admin's note", () => {
    const templates = source("lib/email-templates.js");
    expect(templates).toContain("refundPending = false");
    expect(templates).toContain("a été approuvé à titre exceptionnel et vous sera envoyé sous peu");
    expect(templates).toContain("Message de l'équipe");

    const workshop = source("actions/workshops/manage-reservation.js");
    expect(workshop).toContain("refundPending: refundQueued");
    expect(workshop).toContain("decisionNote: reason?.trim() || null");
  });
});

describe("completed services cannot be refunded through Operations", () => {
  test("the retired correction trigger is rejected and completed bookings remain protected", () => {
    const authorization = source("lib/refunds/authorize.js");
    expect(authorization).toContain('if (appointment.status === "COMPLETED")');
    expect(authorization).toContain("deny(REFUND_DENIAL.COMPLETED_NOT_REFUNDABLE)");
    expect(authorization).not.toContain("FINANCIAL_CORRECTION");

    const operation = source("lib/refunds/open-refund-operation.js");
    expect(operation).toContain("FINANCIAL_CORRECTION_RETIRED");
  });

  test("a refund ledger row never offers a second cancel/refund operation", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(rowActions).toContain('["DEPOSIT", "FINAL_PAYMENT"].includes(transaction?.transactionType)');
    expect(rowActions).not.toContain('transaction?.transactionType !== "DEPOSIT"');
  });

  test("a fully credited historical invoice cannot open another cancellation", () => {
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");
    expect(rowActions).toContain("const invoiceFullyCredited");
    expect(rowActions).toContain("!invoiceFullyCredited");
  });

  test("the operations dialog exposes no financial-correction choice or partial-amount input", () => {
    const dialog = source("components/dashboard/operations/CancelAndRefundDialog.jsx");
    expect(dialog).not.toContain('value: "FINANCIAL_CORRECTION"');
    expect(dialog).not.toContain("requestedAmount");
    expect(dialog).toContain("Annuler et rembourser");
  });

  test("a B2C confirmation is manual and carries no financial document", () => {
    const notify = source("lib/refunds/send-b2c-refund-confirmation.js");
    expect(notify).toContain("operation.status !== \"COMPLETED\"");
    expect(notify).toContain("Remboursement confirmé");
    expect(notify).not.toContain("attachments");
  });

  test("B2B customers require a credit note rather than B2C communication", () => {
    expect(source("lib/refunds/open-refund-operation.js")).toContain("B2B_INVOICE_REQUIRED");
    expect(source("lib/refunds/queue-manual-refund.js")).toContain("B2B_REFUND_REQUIRES_CREDIT_NOTE");
    expect(source("lib/refunds/send-b2c-refund-confirmation.js")).toContain("B2B_CREDIT_NOTE_REQUIRED");
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
    "actions/appointment/manage-appointment.js",
    "actions/boutique/returns.js",
    "lib/appointments/expire-stale-appointments.js",
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

  // Comments are stripped first. An earlier version of this test read the
  // raw file and was tripped by a comment that merely *named* the forbidden
  // flag while the code did the right thing — the assertion has to look at
  // what runs, not at prose about it.
  const code = (file) => source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  for (const file of ["actions/workshops/manage-reservation.js", "actions/formations/manage-reservation.js"]) {
    test(`${file} never tells the customer the money already moved`, () => {
      expect(code(file)).toContain("refunded: false");
      expect(code(file)).not.toContain("refunded: true");
      // A queued refund has to be announced as pending, otherwise the
      // template falls back to its default wording — which for a formation
      // is "l'acompte n'est pas remboursable", i.e. the exact opposite of
      // the decision an admin just took on an exceptional request.
      expect(code(file)).toContain("refundPending: refundQueued");
      // The admin's written reason reaches the person who asked for the
      // exception. The rejection path always sent it; approval dropped it.
      expect(code(file)).toContain("decisionNote:");
    });
  }

  test("the formation cancellation e-mail can say something other than 'non remboursable'", () => {
    const template = source("lib/email-templates.js");
    const start = template.indexOf("export function formationCancellationEmail");
    expect(start).toBeGreaterThan(-1);
    const body = template.slice(start, template.indexOf("\nexport ", start + 10));
    expect(body).toContain("refundPending");
    expect(body).toContain("decisionNote");
    // The old template hard-coded the refusal, with no branch around it.
    expect(body).toMatch(/refunded\s*\?/);
  });

  test("queueManualRefund itself cannot call Stripe", () => {
    const helper = source("lib/refunds/queue-manual-refund.js").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(helper).not.toContain("refunds.create");
    expect(helper).not.toContain("@/lib/stripe");
  });
});

describe("converted legacy cancellation paths", () => {
  for (const file of ["actions/boutique/orders.js", "actions/reservation/cancel-reservation.js"]) {
    test(`${file} queues online refunds instead of calling Stripe`, () => {
      const action = source(file);
      expect(action).not.toContain("refunds.create");
      expect(action).toContain("queueManualRefund(tx");
      expect(action).toContain("issueCreditNote(tx");
    });
  }
});
