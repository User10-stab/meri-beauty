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
      group = { key, date: row.date, rows: [], totalEntrees: 0, totalSorties: 0, totalHt: 0, totalVat: 0, closingBalance: 0 };
      map.set(key, group);
    }
    group.rows.push(row);
    // OPENING ("Solde initial") rows are excluded from the day's own
    // Entrées/Sorties sum for the same reason buildCashBookLedger excludes
    // them from the period-wide totals: the float is that session's
    // starting point, not a transaction that happened that day. Without
    // this, a day whose till simply carried forward a large balance would
    // show that balance as if it were income earned that day.
    if (row.kind !== "OPENING") {
      group.totalEntrees = roundMoney(group.totalEntrees + (row.entree ?? 0));
      group.totalSorties = roundMoney(group.totalSorties + (row.sortie ?? 0));
    }
    // Only sales/refunds carry VAT — drawer movements (apport, dépense,
    // transfert) and the float have no amountHt/amountVat at all.
    if (row.amountVat != null) {
      group.totalHt = roundMoney(group.totalHt + row.amountHt);
      group.totalVat = roundMoney(group.totalVat + row.amountVat);
    }
    group.closingBalance = row.solde;
  }
  return [...map.values()];
}

/** Period-wide HT/TVA over the ledger's sales and refunds, net of refunds. */
export function sumLedgerVat(rows) {
  let ht = 0;
  let vat = 0;
  for (const row of rows) {
    if (row.amountVat == null) continue;
    ht = roundMoney(ht + row.amountHt);
    vat = roundMoney(vat + row.amountVat);
  }
  return { ht, vat };
}
