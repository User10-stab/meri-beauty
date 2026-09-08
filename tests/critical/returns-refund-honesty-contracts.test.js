import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * What the returns screen tells staff has to match what the server does.
 *
 * The confirmed policy (2026-09-02) is that this application never calls
 * Stripe to refund: an OWNER/ADMIN performs every card refund by hand, and
 * `completeReturnRequest` records the debt with `queueManualRefund`. The
 * screen said the opposite — "Le remboursement sera envoyé automatiquement
 * via Stripe" — on the branch a normal online purchase takes.
 *
 * The consequence is not a confused user. It is a customer who is never
 * refunded, because staff read that Stripe had handled it and the debt sat
 * in the worklist with nobody looking for it.
 *
 * These are prose assertions, which is unusual here and deliberate: no
 * behavioural test can catch a screen making a false promise about behaviour
 * that is itself correct.
 */
describe("the returns screen does not promise a refund nobody makes", () => {
  const client = source("components/dashboard/boutique/ReturnsPageClient.jsx");
  const returns = source("actions/boutique/returns.js");

  test("completing a return queues a manual refund and never calls Stripe", () => {
    expect(returns).toContain("queueManualRefund");
    // The premise of everything below. If this ever stops being true the
    // screen's wording has to be revisited, not this test deleted.
    expect(returns).not.toMatch(/stripe\.refunds\.create/);
  });

  test("the online-payment branch no longer claims Stripe sends it automatically", () => {
    // isManualOrderRefund(payment) is `method !== "ONLINE"`, so an ordinary
    // card-paid boutique order takes the else branch — the one that lied.
    //
    // This negative assertion is only sound because the source file
    // paraphrases the old wording instead of quoting it. A comment
    // explaining the bug is indistinguishable from the bug to a grep (T4 in
    // E2E_FINDINGS.md, which this test tripped over on its first run), so
    // the positive assertions below carry most of the weight.
    expect(client).not.toContain("envoyé automatiquement via Stripe");
  });

  test("it says the refund waits for a human, and where it waits", () => {
    expect(client).toContain("mis en attente");
    // Naming the worklist is the part that makes it actionable rather than
    // merely accurate.
    expect(client).toContain("Remboursements dus");
  });

  test("the rest of the app still says the same thing", () => {
    // OrderDetailClient was already correct and is what showed this was a
    // slip on one screen rather than a misunderstanding of the policy.
    expect(source("components/dashboard/boutique/OrderDetailClient.jsx")).toContain(
      "Aucun argent ne sera envoyé automatiquement",
    );
  });
});

/**
 * B6, now fixed.
 *
 * `completeReturnRequest` used to refuse outright when the order's payment
 * carried no invoice — and an invoice is only ever issued to a buyer with a
 * validated VAT number (`fulfill-order-payment.js` gates on
 * `hasInvoiceableVatIdentity`), which a particulier never has. The statutory
 * 14-day right of withdrawal, a *consumer* right, was therefore exercisable
 * only by companies.
 *
 * Worse than unreachable: nothing earlier in the flow gated on an invoice, so
 * the customer requested, staff approved, the goods came back and were
 * inspected — and only then did the button fail, with the salon holding both
 * the goods and the money.
 *
 * The fix is the idiom the rest of the codebase already uses: issue the
 * credit note only when there is an invoice to correct, and let
 * `queueManualRefund` apply the real rule, which is that only a *business*
 * refund requires one.
 *
 * These stay prose assertions for the same reason as the block above: the
 * failure was a document policy, not arithmetic.
 */
describe("B6 — a consumer can be refunded without an invoice", () => {
  const returns = source("actions/boutique/returns.js");
  const fulfil = source("lib/orders/fulfill-order-payment.js");

  test("the blocking guard is gone", () => {
    expect(returns).not.toContain("Aucune facture n'est associée à cette commande");
    expect(returns).not.toContain("if (!rr.order.payment?.invoice) {");
  });

  test("a particulier's order still never carries an invoice", () => {
    // The fix deliberately does not touch this. A B2C buyer is not entitled
    // to an invoice number, and issueInvoice throws B2C_INVOICE_NOT_ALLOWED
    // to keep a future call site from consuming one.
    expect(fulfil).toContain("hasInvoiceableVatIdentity(invoiceCustomerUser)");
    expect(source("lib/invoicing.js")).toContain("B2C_INVOICE_NOT_ALLOWED");
  });

  test("so the credit note is issued only when there is an invoice to correct", () => {
    expect(returns).toContain("let creditNote = null;");
    expect(returns).toContain("if (rr.order.payment.invoice) {");
  });

  test("and every downstream use of it tolerates its absence", () => {
    // Transaction.creditNoteId, RefundOperation.creditNoteId and
    // ReturnRequest.creditNoteId are all nullable columns, so this is a code
    // rule rather than a schema one and is worth pinning.
    expect(returns).toContain("creditNoteId: creditNote?.id ?? null");
    expect(returns).toContain("invoiceId: rr.order.payment.invoice?.id ?? null");
    // Exactly one unguarded `creditNote.id` survives: the returnRequest
    // update that runs *inside* `if (rr.order.payment.invoice)`. A second
    // occurrence would mean a call site slipped back outside the guard.
    expect(
      returns.split("creditNoteId: creditNote.id").length - 1,
      "an unguarded creditNote.id reappeared outside the invoice branch",
    ).toBe(1);
  });

  test("the real rule lives in queueManualRefund, and is about B2B only", () => {
    expect(source("lib/refunds/queue-manual-refund.js")).toContain(
      'if (!creditNoteId && customerIsBusiness) {',
    );
    expect(returns).toContain("customerIsBusiness: isBusinessRefundCustomer(rr.order.user)");
  });

  test("this matches what the other refund paths already did", () => {
    // Not a new decision: ateliers and formations have issued B2C refunds
    // with no credit note since before this fix.
    for (const path of [
      "actions/workshops/manage-reservation.js",
      "actions/formations/manage-reservation.js",
    ]) {
      expect(source(path), path).toContain("if (payment.invoice) {");
    }
  });

  test("and the e-mail no longer promises an attachment that is not there", () => {
    const templates = source("lib/email-templates.js");
    expect(templates).toContain("creditNoteAttached = false,");
    expect(templates).toContain("const creditNoteLine = creditNoteAttached");
    // The sentence must exist only behind that flag — a bare occurrence in
    // the body would put it on every particulier's message again.
    expect(
      templates.match(/Vous trouverez la note de crédit correspondante en pièce jointe/g),
      "the credit-note sentence appears somewhere other than behind creditNoteAttached",
    ).toHaveLength(1);
    expect(returns).toContain("creditNoteAttached: Boolean(creditNotePdf)");
  });

  test("the requirement that demanded this is satisfied rather than contradicted", () => {
    // PROJECT_REQUIREMENTS.md §2 records the 14-day withdrawal as the
    // requirement that had to *correct* the client's instinct, "no refunds
    // after delivery" being explicitly illegal for EU distance selling.
    expect(source("PROJECT_REQUIREMENTS.md")).toContain("14-day right-of-withdrawal");
  });
});

/**
 * The same defect, found later in a second place (B8).
 *
 * `CancelReservationDialog` is shared by ateliers and formations, and it told
 * the admin the money would be "remboursé via Stripe" while both
 * cancellation actions call `queueManualRefund`. Worse than the returns
 * screen, because this is the dialog where an admin *decides* to grant an
 * exceptional refund — so the customer being compensated out of goodwill is
 * the one who never gets paid.
 */
describe("the cancel dialog does not promise a refund nobody makes", () => {
  const dialog = source("components/dashboard/workshops/CancelReservationDialog.jsx");

  test("neither cancellation action calls Stripe", () => {
    for (const path of [
      "actions/workshops/manage-reservation.js",
      "actions/formations/manage-reservation.js",
    ]) {
      const action = source(path);
      expect(action, path).toContain("queueManualRefund");
      expect(action, path).not.toMatch(/stripe\.refunds\.create/);
    }
  });

  test("so the dialog says the refund waits for a human, and where", () => {
    expect(dialog).toContain("mis en attente de remboursement");
    expect(dialog).toContain("Remboursements dus");
  });

  test("the default remains that nothing is refunded at all", () => {
    // Both a formation deposit and an atelier acompte are non-refundable by
    // default; the checkbox is the documented exception, not the norm.
    expect(dialog).toContain("ne sera pas remboursé");
    expect(dialog).toContain("à titre exceptionnel");
  });
});

/**
 * The refund the app never arranged.
 *
 * `returnCompletedEmail` chooses between three sentences. Two are honest: a
 * queued online refund says a human is on it, a counter hand-over says the
 * money already moved. The third is reached only when the refund was NOT
 * queued — `refundPending` is `!manualRefund && refundQueued`, so failing both
 * means an online return whose refund never entered the ledger.
 *
 * `completeReturnRequest` treats that exact condition as an inconsistency: it
 * e-mails the salon "⚠️ Remboursement à vérifier", and its comment says the
 * alert exists rather than "silently telling the customer it's handled". The
 * customer e-mail did precisely that — "le remboursement apparaîtra sur votre
 * compte sous quelques jours" — for money nothing was scheduled to pay.
 *
 * Same failure as a screen promising a Stripe refund the app never sends,
 * except this one goes to the customer and sets a clock running.
 */
describe("an unqueued refund is not announced as if it were handled", () => {
  const templates = source("lib/email-templates.js");
  const returns = source("actions/boutique/returns.js");

  test("the fallback no longer promises the money will just turn up", () => {
    expect(templates).not.toContain("Le remboursement apparaîtra sur votre compte");
  });

  test("it says a person has to finish it, and gives the customer a lever", () => {
    // Without a way to chase it, an unqueued refund is only recoverable if the
    // salon happens to read its own alert.
    expect(templates).toContain("Notre équipe organise votre remboursement et vous recontactera.");
    expect(templates).toMatch(/répondez à cet e-mail/i);
  });

  test("the two honest branches are untouched", () => {
    expect(templates).toContain("Le remboursement est en cours de traitement par notre équipe");
    expect(templates).toContain("Le remboursement a été effectué directement en boutique.");
  });

  test("and the salon is still told, so the two halves agree", () => {
    expect(returns).toContain("Remboursement à vérifier");
    expect(returns).toContain("!manualRefund && !refundQueued");
  });
});
