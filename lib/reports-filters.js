/**
 * Report filter vocabulary, shared by the server action and the filter bar.
 *
 * Deliberately NOT in the "use server" action file: Next.js requires every
 * export of such a module to be an async function, and exporting a plain
 * constant there silently drops ALL of that module's exports at build time
 * (same trap as lib/reservation-errors.js).
 */

/** Selectable report windows, in months back from the current one. */
export const REPORT_PERIODS = [1, 2, 3, 6, 12];

export const DEFAULT_REPORT_MONTHS = 6;

export const PERIOD_LABELS = {
  1: "Ce mois-ci",
  2: "2 derniers mois",
  3: "3 derniers mois",
  6: "6 derniers mois",
  12: "12 derniers mois",
};

/**
 * Which side of the reconciliation each payment method lands on: the drawer,
 * or the bank statement. This is the "liquide vs banque" split — a card
 * payment and a Stripe payment are both money the salon has to find on a bank
 * statement, however differently they were taken.
 */
export const CASH_METHODS = ["CASH"];
export const BANK_METHODS = ["CARD", "ONLINE"];

export const METHOD_LABELS = {
  CASH: "Espèces",
  CARD: "Carte (terminal)",
  ONLINE: "En ligne (Stripe)",
};

/** Coerces a query-string value to a valid window, never widening it silently. */
export function normalizeReportMonths(value) {
  const months = Number(value);
  return REPORT_PERIODS.includes(months) ? months : DEFAULT_REPORT_MONTHS;
}
