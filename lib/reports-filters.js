/**
 * Payment-method vocabulary shared by the dashboard figures and the livre de
 * recettes. Plain constants, so never in a "use server" file.
 */

/**
 * Which side of the reconciliation each payment method lands on: the drawer,
 * or the bank statement. This is the "liquide vs banque" split — a card
 * payment and a Stripe payment are both money the salon has to find on a bank
 * statement, however differently they were taken.
 */
export const CASH_METHODS = ["CASH"];
export const BANK_METHODS = ["CARD", "ONLINE", "TRANSFER"];

export const METHOD_LABELS = {
  CASH: "Espèces",
  CARD: "Carte (terminal)",
  ONLINE: "En ligne (Stripe)",
  TRANSFER: "Virement bancaire",
};
