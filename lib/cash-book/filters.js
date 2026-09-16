/**
 * Filter vocabulary for the Livre de caisse, shared by the page and the
 * server action.
 *
 * Deliberately NOT in a "use server" action file: Next.js requires every
 * export of such a module to be an async function, and exporting a plain
 * constant there silently drops ALL of that module's exports at build time
 * (same trap as lib/livre-de-recettes/filters.js, lib/reports-filters.js).
 */

/** A single ledger load is the whole range at once (running "Solde" column needs every prior row). */
export const MAX_JOURNAL_ROWS = 5000;

/** Longest window the ledger will query, in days. */
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
 * Coerces raw query-string values to a safe, bounded window. A hand-edited
 * URL can never widen the scan: an invalid or missing range falls back to
 * the current calendar month, and an over-long range is clamped to
 * MAX_RANGE_DAYS.
 *
 * @returns {{ from: string, to: string, fromDate: Date, toDate: Date }}
 */
export function normalizeCashBookParams({ from, to } = {}) {
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

  return { from: fromStr, to: toStr, fromDate, toDate: toEndOfDay };
}
