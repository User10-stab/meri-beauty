import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildServiceInvoiceLines } from "../../lib/invoicing.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

const sum = (lines) =>
  Math.round(lines.reduce((total, line) => total + line.unitPrice * line.quantity, 0) * 100) / 100;

/**
 * What an invoice says when the price moved at the counter.
 *
 * `buildServiceInvoiceLines` never charges the amount it prints on the first
 * line: it prints a *reconstructed* gross and then subtracts the promo code,
 * so the lines add up to what was actually taken. That works while the promo
 * is the only thing between catalogue price and total.
 *
 * The counter price adjustment broke that assumption. A booking with a promo
 * code whose price was then changed at the till printed a first line at a
 * figure nobody was ever quoted, a "Code promotionnel" line, and nothing at
 * all about the adjustment — the total and the VAT were right, but the
 * document explained them with an invented number. That is the same failure
 * as a screen describing a refund the app never sends, except it is a legal
 * document and it is filed.
 */
describe("an invoice explains the price it charges", () => {
  test("with no discount and no adjustment it is still one plain line", () => {
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 60 });
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(60);
  });

  test("a promo code keeps its own negative line", () => {
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 50, discountAmount: 10 });
    expect(lines).toHaveLength(2);
    expect(lines[0].unitPrice).toBe(60);
    expect(lines[1]).toMatchObject({ description: "Code promotionnel", unitPrice: -10 });
    expect(sum(lines), "the lines no longer add up to what was charged").toBe(50);
  });

  test("a counter adjustment is named rather than folded into the price", () => {
    // €60 catalogue, €5 off at the till. Without the adjustment line the first
    // line would read €55 — a price that was never quoted and that no promo
    // explains.
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 55,
      adjustmentAmount: -5,
      adjustmentReason: "geste commercial",
    });
    expect(lines).toHaveLength(2);
    expect(lines[0].unitPrice, "the catalogue price was not restored").toBe(60);
    expect(lines[1]).toMatchObject({ description: "Ajustement — geste commercial", unitPrice: -5 });
    expect(sum(lines)).toBe(55);
  });

  test("promo and adjustment together — the case that was wrong", () => {
    // €60 catalogue, €10 promo (so €50 was quoted), then €5 off at the till.
    // Every line names something that really happened, and they sum to €45.
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 45,
      discountAmount: 10,
      adjustmentAmount: -5,
      adjustmentReason: "correction de tarif",
    });
    expect(lines).toHaveLength(3);
    expect(lines[0].unitPrice, "the catalogue price was not restored").toBe(60);
    expect(lines[1].unitPrice).toBe(-10);
    expect(lines[2].unitPrice).toBe(-5);
    expect(sum(lines), "the invoice does not add up to the amount collected").toBe(45);
  });

  test("an upward correction is signed the other way", () => {
    const lines = buildServiceInvoiceLines({
      description: "Coupe",
      totalAmount: 70,
      adjustmentAmount: 10,
      adjustmentReason: "supplément longueur",
    });
    expect(lines[0].unitPrice).toBe(60);
    expect(lines[1].unitPrice).toBe(10);
    expect(sum(lines)).toBe(70);
  });

  test("an adjustment with no reason still gets a line", () => {
    // A nameless line is worse than none only if it hides money. This one
    // shows the money and admits the reason is missing.
    const lines = buildServiceInvoiceLines({ description: "Coupe", totalAmount: 55, adjustmentAmount: -5 });
    expect(lines[1]).toMatchObject({ description: "Ajustement au comptoir", unitPrice: -5 });
    expect(sum(lines)).toBe(55);
  });

  test("both settlement paths pass the adjustment through", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).toContain("adjustmentAmount: priceAdjustment.changed");
      expect(code, path).toContain("adjustmentReason: priceAdjustment.reason");
    }
  });
});

/**
 * A settlement that committed must never be reported as a failure.
 *
 * The ticket is rendered and e-mailed *after* the transaction commits, and
 * `collectionTicketFields` throws rather than returning null — it sat outside
 * the `.catch()` that already wrapped `renderTicketPdf`. It cannot throw
 * today, because the branch above guarantees every precondition it checks.
 *
 * The reason this is worth a guard rather than a comment: the failure is no
 * longer cosmetic. `createCounterWalkInService` deletes the appointment it
 * just created whenever the settlement reports failure, so a post-commit
 * throw would ask it to unwind money that had really been taken. The delete
 * would then hit the Payment_exactly_one_source CHECK and fail silently —
 * safe by accident, which is not a property to rely on.
 */
describe("nothing after the commit can undo a collection", () => {
  test("the ticket step is wrapped so it cannot fail the settlement", () => {
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      expect(code, path).toContain("} catch (postCommitError) {");
      expect(code, path).toContain(
        "[POST_COMMIT] settlement succeeded but the ticket step failed:",
      );

      // The catch must swallow, not re-report. A `return { success: false }`
      // inside it would reinstate exactly the bug this guards against.
      // Scoped to the catch body itself. A fixed-size window runs past the
      // closing brace into the action's own error handler, which legitimately
      // rethrows — and then this assertion fails for the wrong reason.
      const catchAt = code.indexOf("} catch (postCommitError) {");
      const lineStart = code.lastIndexOf("\n", catchAt) + 1;
      const indent = code.slice(lineStart, catchAt);
      const closeAt = code.indexOf(`\n${indent}}`, catchAt);
      // Comment lines are stripped first. The block explains itself in prose
      // that necessarily uses the words being forbidden — the first version of
      // this assertion failed on its own explanation, which is a way of
      // testing the comment rather than the code.
      const catchBlock = code
        .slice(catchAt, closeAt)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(catchBlock, path).not.toContain("success: false");
      expect(catchBlock, path).not.toContain("throw ");
    }
  });

  test("the throwing call is the one inside the wrapper", () => {
    // If collectionTicketFields ever moves back above the try, the guard is
    // decorative. Assert the ordering rather than mere presence.
    for (const path of [
      "actions/appointment/manage-appointment.js",
      "lib/reservations/settle-reservation.js",
    ]) {
      const code = source(path);
      const tryAt = code.indexOf("try {\n", code.indexOf("balance > 0"));
      const ticketAt = code.indexOf("collectionTicketFields(", tryAt);
      const catchAt = code.indexOf("} catch (postCommitError) {");
      expect(tryAt, path).toBeGreaterThan(-1);
      expect(ticketAt, path).toBeGreaterThan(tryAt);
      expect(catchAt, path).toBeGreaterThan(ticketAt);
    }
  });
});
