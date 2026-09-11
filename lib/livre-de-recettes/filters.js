/**
 * Filter vocabulary for the Livre de recettes, shared by the page, the
 * server action and the Excel route.
 *
 * Deliberately NOT in the "use server" action file: Next.js requires every
 * export of such a module to be an async function, and exporting a plain
 * constant there silently drops ALL of that module's exports at build time
 * (same trap as lib/reports-filters.js / lib/reservation-errors.js).
 */

import { METHOD_LABELS } from "@/lib/reports-filters";
import { PAYMENT_CATEGORY_LABELS } from "@/lib/payments/payment-category";

export { METHOD_LABELS };

/** The three ways money actually arrives — the `TransactionMethod` enum. */
export const RECETTES_METHODS = ["CASH", "CARD", "ONLINE"];

/** Revenue categories, matching categoryForPayment()'s return values. */
export const RECETTES_CATEGORIES = ["ORDER", "APPOINTMENT", "WORKSHOP", "EVENT", "FORMATION"];

export const RECETTES_CATEGORY_LABELS = {
  ...PAYMENT_CATEGORY_LABELS,
  OTHER: "Autres / non catégorisé",
};

/**
 * A single revenue journal load is the whole period at once (the running
 * "Solde cumulé" column needs every prior row), so the period has to be
 * bounded. Past this many rows the builder stops and the screen says so.
 */
export const MAX_JOURNAL_ROWS = 5000;

/** Longest window the journal will query, in days. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parses "YYYY-MM-DD" to a Brussels-local midnight Date, or null. */
function parseDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  // Process TZ is pinned to Europe/Brussels (instrumentation.js), so this is
  // a Brussels-local midnight.
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
 * Coerces raw query-string values to a safe, bounded window and the two
 * whitelisted filters. A hand-edited URL can never widen the scan: an
 * invalid or missing range falls back to the current calendar month, and an
 * over-long range is clamped to MAX_RANGE_DAYS.
 *
 * `staffId` is carried through untouched (validated — existence + not
 * deleted — by the action, not here) so a dashboard revenue card can
 * deep-link one member's appointment transactions.
 *
 * @returns {{ from: string, to: string, fromDate: Date, toDate: Date,
 *   method: "ALL"|"CASH"|"CARD"|"ONLINE", category: "ALL"|string,
 *   staffId: string }}
 */
export function normalizeRecettesParams({ from, to, method, category, staffId } = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let fromDate = parseDateOnly(from) ?? defaultFrom;
  let toDate = parseDateOnly(to) ?? defaultTo;

  // An inverted or zero-width range is meaningless — reset both ends.
  if (toDate.getTime() < fromDate.getTime()) {
    fromDate = defaultFrom;
    toDate = defaultTo;
  }

  // Clamp an over-long window from the start, keeping the end the user asked for.
  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    fromDate = new Date(toDate.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  const fromStr = toDateOnlyString(fromDate);
  const toStr = toDateOnlyString(toDate);

  // "to 31 March" means through the whole 31st; midnight would drop that day.
  const toEndOfDay = new Date(toDate);
  toEndOfDay.setHours(23, 59, 59, 999);

  return {
    from: fromStr,
    to: toStr,
    fromDate,
    toDate: toEndOfDay,
    method: RECETTES_METHODS.includes(method) ? method : "ALL",
    category: RECETTES_CATEGORIES.includes(category) ? category : "ALL",
    staffId: typeof staffId === "string" ? staffId : "",
  };
}
