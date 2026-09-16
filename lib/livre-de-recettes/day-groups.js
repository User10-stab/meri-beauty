/**
 * Groups a Livre de recettes journal's rows by Brussels-local calendar day,
 * with each day's HT/TVA/TTC totals.
 *
 * Shared by the on-screen table (RecettesJournalClient.jsx) and the printed
 * PDF (lib/pdf/RecettesJournalDocument.jsx) so the two can never disagree on
 * what a given day's totals are — one grouping algorithm, two renderers.
 *
 * Pure and framework-free (no "use client"/"use server") so it runs
 * identically in the browser and in the Node PDF-rendering route.
 */

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sortable, timezone-stable "YYYY-MM-DD" grouping key for a row's paidAt. */
export function dayKeyFor(value) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
}

export function formatDayLabel(value) {
  const label = new Date(value).toLocaleDateString("fr-BE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Groups the already-sorted rows by Brussels-local calendar day, one bucket per day. */
export function groupRowsByDay(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = dayKeyFor(row.paidAt);
    let group = map.get(key);
    if (!group) {
      group = { key, date: row.paidAt, rows: [], totalHt: 0, totalVat: 0, totalTtc: 0, closingBalance: 0 };
      map.set(key, group);
    }
    const sign = row.isRefund ? -1 : 1;
    group.rows.push(row);
    group.totalHt = roundMoney(group.totalHt + sign * row.amountHt);
    group.totalVat = roundMoney(group.totalVat + sign * row.amountVat);
    group.totalTtc = roundMoney(group.totalTtc + sign * row.amountTtc);
    group.closingBalance = row.runningTotal;
  }
  return [...map.values()];
}
