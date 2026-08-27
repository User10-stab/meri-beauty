/**
 * The filter axes on the operations ledger (/dashboard/operations), shared
 * between the server action (`actions/dashboard/admin-operations.js`, whose
 * `"use server"` directive forbids exporting anything but async functions —
 * every other export from such a file must be an async server action) and
 * the client filter bar. One source of truth so a value the server accepts
 * and a value the UI offers can never drift apart.
 */

// The "type" axis worth separating within a tab that otherwise mixes rows
// that look the same until you read the title — an atelier and an événement
// share one table (WorkshopType), a formation is public or private
// (FormationType). No entry for a tab where nothing plays this role.
export const TYPE_FILTERS = Object.freeze({
  workshops: Object.freeze(["WORKSHOP", "EVENT"]),
  formations: Object.freeze(["PRIVATE", "PUBLIC"]),
});

export const TYPE_LABELS = Object.freeze({
  WORKSHOP: "Atelier",
  EVENT: "Événement",
  PRIVATE: "Privée",
  PUBLIC: "Publique",
});

// The "status" axis, one whitelist per tab, values in the exact casing
// Prisma stores. Transaction has no status column of its own — the slot
// doubles for transactionType there, which is what actually varies row to
// row on that tab.
export const STATUS_FILTERS = Object.freeze({
  transactions: Object.freeze(["DEPOSIT", "FINAL_PAYMENT", "REFUND"]),
  orders: Object.freeze([
    "PENDING_PAYMENT",
    "PENDING_PICKUP",
    "PAID",
    "PROCESSING",
    "READY_FOR_PICKUP",
    "SHIPPED",
    "COMPLETED",
    "CANCELLED",
    "EXPIRED",
  ]),
  workshops: Object.freeze(["PENDING_DEPOSIT", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]),
  formations: Object.freeze(["PENDING_DEPOSIT", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]),
});

export const STATUS_LABELS = Object.freeze({
  DEPOSIT: "Acompte",
  FINAL_PAYMENT: "Solde",
  REFUND: "Remboursement",
  PENDING_PAYMENT: "Paiement en attente",
  PENDING_PICKUP: "En attente de retrait",
  PAID: "Payée",
  PROCESSING: "En préparation",
  READY_FOR_PICKUP: "Prête pour retrait",
  SHIPPED: "Expédiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
  PENDING_DEPOSIT: "Acompte en attente",
  CONFIRMED: "Confirmée",
  NO_SHOW: "Absence",
});
