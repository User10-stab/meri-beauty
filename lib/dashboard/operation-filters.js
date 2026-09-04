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

// ─── Unified operations view (the merged Transactions tab) ─────────────────
//
// Two independent axes, where a single "status" slot used to conflate two
// unrelated questions: "what kind of money event is this" vs. "where is
// this order/booking in its own lifecycle" — two enums that don't overlap
// in vocabulary and can't be one filter on a merged row list.

// Flat, not per-source — every row (order, atelier, formation) can carry a
// DEPOSIT/FINAL_PAYMENT/REFUND event, so this filter is meaningful
// everywhere, not just on one tab.
export const PAYMENT_EVENT_FILTERS = Object.freeze(["DEPOSIT", "FINAL_PAYMENT", "REFUND"]);

export const PAYMENT_EVENT_LABELS = Object.freeze({
  DEPOSIT: "Acompte",
  FINAL_PAYMENT: "Solde",
  REFUND: "Remboursement",
});

// The entity's OWN status, one vocabulary per source, values in the exact
// casing Prisma stores, plus a deduplicated "all" list for the unrestricted
// unified view. CANCELLED/COMPLETED are spelled identically across
// OrderStatus and WorkshopReservationStatus/FormationReservationStatus —
// deduping them here is intentional: filtering by "Annulée" on the merged
// view means exactly what it says regardless of source.
const ORDER_LIFECYCLE_STATUSES = Object.freeze([
  "PENDING_PAYMENT",
  "PENDING_PICKUP",
  "PAID",
  "PROCESSING",
  "READY_FOR_PICKUP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);
const RESERVATION_LIFECYCLE_STATUSES = Object.freeze(["PENDING_DEPOSIT", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]);

export const LIFECYCLE_STATUS_FILTERS = Object.freeze({
  orders: ORDER_LIFECYCLE_STATUSES,
  workshops: RESERVATION_LIFECYCLE_STATUSES,
  formations: RESERVATION_LIFECYCLE_STATUSES,
  all: Object.freeze([...new Set([...ORDER_LIFECYCLE_STATUSES, ...RESERVATION_LIFECYCLE_STATUSES])]),
});

export const LIFECYCLE_STATUS_LABELS = Object.freeze({
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

// What "Commandes / Ateliers / Formations" mean under the unified view: a
// restriction on sourceType over the SAME query, never a different one.
export const OPERATION_PRESETS = Object.freeze({
  transactions: Object.freeze({ label: "Transactions", sourceTypes: null }),
  orders: Object.freeze({ label: "Commandes", sourceTypes: Object.freeze(["ORDER"]) }),
  workshops: Object.freeze({ label: "Ateliers & événements", sourceTypes: Object.freeze(["WORKSHOP"]) }),
  formations: Object.freeze({ label: "Formations", sourceTypes: Object.freeze(["FORMATION"]) }),
});
