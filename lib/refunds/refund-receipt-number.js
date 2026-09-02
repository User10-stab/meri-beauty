/**
 * Numbering for the B2C "justificatif de remboursement".
 *
 * A particulier without a validated VAT identity never receives an Invoice
 * (lib/tax-policy.js#hasInvoiceableVatIdentity), and Belgian law does not
 * require one for them. That is exactly why the old button was wrong to
 * demand an invoice before it would do anything: for most of the salon's
 * customers there is nothing to credit, yet the money still has to go back
 * and the movement still has to be justifiable to an inspector.
 *
 * So this series is NOT a credit note and must never be presented as one —
 * it carries no VAT correction. It is an internal receipt proving that a
 * specific sum went back to a specific customer on a specific date, under a
 * specific RefundOperation.
 *
 * Same gapless mechanism as Invoice/CreditNote numbering, and the same
 * hard rule: call it only from inside the transaction that writes the row,
 * so a rollback never burns a number.
 */

/**
 * The Brussels calendar year, not the process-local one — deploy hosts, CI
 * and cron workers all run UTC, so a receipt issued at 00:30 Brussels on
 * 1 January would otherwise be numbered into the year that just ended.
 * Identical reasoning to lib/cash-book/piece-number.js#cashBookYear.
 */
function brusselsYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Brussels", year: "numeric" }).format(now));
}

/**
 * Claims the next receipt number. The INSERT ... ON CONFLICT DO UPDATE is a
 * single statement, so concurrent callers serialize on the row lock instead
 * of racing a read-then-write.
 *
 * @param {import("@prisma/client").Prisma.TransactionClient} tx
 * @returns {Promise<string>} e.g. "RB2026-000001"
 */
export async function allocateRefundReceiptNumber(tx, now = new Date()) {
  const year = brusselsYear(now);
  const rows = await tx.$queryRaw`
    INSERT INTO "NumberingCounter" ("key", "lastNumber") VALUES (${`refundreceipt-${year}`}, 1)
    ON CONFLICT ("key") DO UPDATE SET "lastNumber" = "NumberingCounter"."lastNumber" + 1
    RETURNING "lastNumber"
  `;
  return `RB${year}-${String(Number(rows[0].lastNumber)).padStart(6, "0")}`;
}
