import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * "Annuler et rembourser" (CancelAndRefundDialog -> cancelAndRefund) cancels
 * the underlying order/booking, releases stock or seats, and issues the
 * credit note — all correctly, in one transaction. But it was reachable from
 * nowhere in the live UI: InvoiceRowActions always renders "Voir / gérer" on
 * the Transactions tab (opening this drawer instead), and the drawer itself
 * had no cancellation action of any kind. These tests pin the fix so it
 * cannot silently regress back into being dead code.
 */
describe("the transaction detail drawer can actually cancel and refund", () => {
  test("the drawer imports and mounts CancelAndRefundDialog", () => {
    const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");
    expect(drawer).toContain('import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog"');
    expect(drawer).toContain("<CancelAndRefundDialog");
  });

  test("the cancel-and-refund gate matches InvoiceRowActions' formula exactly", () => {
    const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");
    const rowActions = source("components/dashboard/operations/InvoiceRowActions.jsx");

    // Both must key off DEPOSIT/FINAL_PAYMENT (a collection event, not yet a
    // refund) so the button never disagrees depending on which door an admin
    // walked through to reach the same payment.
    expect(drawer).toContain('["DEPOSIT", "FINAL_PAYMENT"].includes(');
    expect(rowActions).toContain('["DEPOSIT", "FINAL_PAYMENT"].includes(');

    expect(drawer).toContain("canCancelAndRefund");
    expect(drawer).toContain("remainingRefundable) > 0.01");
    expect(drawer).toContain("fullyCredited");
  });

  test("refreshDetail runs after closing the cancel-and-refund dialog, so the gate re-evaluates", () => {
    const drawer = source("components/dashboard/operations/TransactionDetailDrawer.jsx");
    const dialogIdx = drawer.indexOf("<CancelAndRefundDialog");
    expect(dialogIdx).toBeGreaterThan(-1);
    const dialogBlock = drawer.slice(dialogIdx, drawer.indexOf("/>", dialogIdx));
    expect(dialogBlock).toContain("refreshDetail()");
  });

  test("getTransactionDetail selects the invoice's credit notes and computes refundState", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    const fnIdx = actions.indexOf("export async function getTransactionDetail");
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));

    // Needed for summarizeRefundState to compute fullyCredited correctly
    // when several partial notes already exist against the invoice.
    expect(fn).toContain("creditNotes: { select: { id: true, totalInclVat: true } }");
    expect(fn).toContain("summarizeRefundState({");
    expect(fn).toContain("remainingRefundable: refundState.remainingRefundable");
    expect(fn).toContain("fullyCredited: refundState.fullyCredited");
  });
});
