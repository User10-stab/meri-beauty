/**
 * Filter vocabulary for the Mouvements de stock ledger, shared by the page,
 * the client filter bar and the server action/builder.
 *
 * Kept separate from build-stock-movements-report.js (same reasoning as
 * lib/livre-de-recettes/filters.js vs. build-recettes-journal.js): the
 * client-side filter bar only needs these constants, not the Prisma-querying
 * builder — importing the builder here too would pull it into the browser
 * bundle for no reason.
 */

export const MOVEMENT_TYPES = ["SALE", "RESTOCK", "RETURN", "LOSS", "ADJUSTMENT", "SALON_USAGE"];

export const MOVEMENT_TYPE_LABELS = {
  SALE: "Vente",
  RESTOCK: "Réapprovisionnement",
  RETURN: "Retour client",
  LOSS: "Perte / casse",
  ADJUSTMENT: "Correction manuelle",
  SALON_USAGE: "Utilisation en prestation",
};

// A single load has to stay bounded — past this many rows the builder stops
// and the screen/PDF say so, same guard as MAX_JOURNAL_ROWS on the recettes
// journal.
export const MAX_MOVEMENTS_ROWS = 5000;

/** Longest window the report will query, in days. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) return null;
  return date;
}

function toDateOnlyString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Coerces raw query-string values to a safe, bounded window and a
 * whitelisted type. A hand-edited URL can never widen the scan: an invalid
 * or missing range falls back to the current calendar month, and an
 * over-long range is clamped to MAX_RANGE_DAYS.
 */
export function normalizeStockMovementsParams({ from, to, type } = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let fromDate = parseDateOnly(from) ?? defaultFrom;
  let toDate = parseDateOnly(to) ?? defaultTo;

  if (toDate.getTime() < fromDate.getTime()) {
    fromDate = defaultFrom;
    toDate = defaultTo;
  }

  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    fromDate = new Date(toDate.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  const toEndOfDay = new Date(toDate);
  toEndOfDay.setHours(23, 59, 59, 999);

  return {
    from: toDateOnlyString(fromDate),
    to: toDateOnlyString(toDate),
    fromDate,
    toDate: toEndOfDay,
    type: MOVEMENT_TYPES.includes(type) ? type : "ALL",
  };
}
