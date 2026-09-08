import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const results = source("components/dashboard/boutique/counter/CounterResults.jsx");

// 8 Sep 2026: searchCounter fans one query out to bookings, services,
// sessions and products and returns them as one flat, undifferentiated
// list — a staff member could not tell "this row opens something that
// already exists" from "this row starts a brand-new sale" without reading
// each row's own sub-text. Grouped into labeled sections instead, without
// giving the omnibar a second search mode to choose between first.
describe("counter search results are grouped by staff intent, not one flat list", () => {
  test("bookings (already exists) are their own section, separate from anything sellable", () => {
    expect(results).toContain('rows.filter((row) => row.type === "BOOKING")');
    expect(results).toContain("Réservations existantes");
  });

  test("a service and a session share one 'start a new sale' section", () => {
    expect(results).toContain('rows.filter((row) => row.type === "SERVICE" || row.type === "SESSION")');
    expect(results).toContain("Vendre / créer une réservation");
  });

  test("products stay their own section, not folded into the sellable one", () => {
    expect(results).toContain('rows.filter((row) => row.type === "PRODUCT")');
    expect(results).toContain("Produits en boutique");
  });

  test("a section with no rows renders nothing — no empty labeled box", () => {
    const start = results.indexOf("function ResultSection(");
    const block = results.slice(start, start + 200);
    expect(block).toContain("if (rows.length === 0) return null;");
  });

  test("grouping is purely a display re-sort — selecting a row still calls the same onSelect", () => {
    // Every row, whatever section it lands in, must still reach CounterSurface's
    // selectResult the same way — grouping must not fork the click handler
    // per section into a different callback.
    const occurrences = results.split("onClick={() => onSelect(row)}").length - 1;
    expect(occurrences).toBe(1);
  });
});
