/**
 * Groups a Livre de caisse ledger's rows by Brussels-local calendar day,
 * with each day's Entrées/Sorties totals and closing balance — same
 * collapsible-day-group pattern as lib/livre-de-recettes/day-groups.js, kept
 * as its own copy since the two journals' row shapes differ (entree/sortie/
 * solde here, HT/TVA/TTC there) and are read by unrelated pages.
 *
 * Pure and framework-free (no "use client"/"use server") so it renders
 * identically on screen and on the printed page.
 */

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sortable, timezone-stable "YYYY-MM-DD" grouping key for a row's date. */
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

/** Groups the already-sorted ledger rows by Brussels-local calendar day, one bucket per day. */
export function groupLedgerRowsByDay(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = dayKeyFor(row.date);
    let group = map.get(key);
    if (!group) {
      group = { key, date: row.date, rows: [], totalEntrees: 0, totalSorties: 0, closingBalance: 0 };
      map.set(key, group);
    }
    group.rows.push(row);
    group.totalEntrees = roundMoney(group.totalEntrees + (row.entree ?? 0));
    group.totalSorties = roundMoney(group.totalSorties + (row.sortie ?? 0));
    group.closingBalance = row.solde;
  }
  return [...map.values()];
}
