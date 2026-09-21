/**
 * Limits shared by the manual-invoice screen (client) and its validation
 * schema (server) — a plain module so the browser bundle never pulls in zod
 * or the VAT validation code just to read a number.
 */

export const MANUAL_INVOICE_METHODS = ["CASH", "CARD", "TRANSFER"];
export const MANUAL_INVOICE_NOTES_MAX = 1000;
export const MANUAL_INVOICE_MAX_LINES = 50;

// Belgian law caps a cash payment at 3 000 € (loi du 18 septembre 2017,
// art. 67). Only a warning on screen — the admin may be recording cash
// legitimately split across several payments.
export const CASH_PAYMENT_LEGAL_LIMIT = 3000;
