/**
 * Groups a stock movements report's rows by Brussels-local calendar day, with
 * each day's count-by-type — the stock equivalent of
 * lib/livre-de-recettes/day-groups.js, minus the running balance (there is no
 * single cumulative "stock total" across unrelated variants the way there is
 * a cumulative cash balance).
 *
 * Shared by the on-screen table (StockMovementsClient.jsx) and the printed
 * PDF (lib/pdf/StockMovementsDocument.jsx) so the two can never disagree on
 * what a given day contains.
 *
 * Pure and framework-free so it runs identically in the browser and in the
 * Node PDF-rendering route.
 */

import { dayKeyFor, formatDayLabel } from "@/lib/livre-de-recettes/day-groups";

export { dayKeyFor, formatDayLabel };

/** Groups the already-sorted rows by Brussels-local calendar day, one bucket per day. */
export function groupMovementsByDay(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = dayKeyFor(row.createdAt);
    let group = map.get(key);
    if (!group) {
      group = { key, date: row.createdAt, rows: [], countByType: {} };
      map.set(key, group);
    }
    group.rows.push(row);
    group.countByType[row.type] = (group.countByType[row.type] ?? 0) + 1;
  }
  return [...map.values()];
}
