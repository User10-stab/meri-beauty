import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";

import {
  COUNTER_SELLABLE_CATALOGUE_STATUSES,
  isCounterSellableCatalogueStatus,
} from "../../lib/counter/catalogue-availability.js";

function source(relativePath) {
  // Normalised: these assertions are about the code, not about whether the
  // checkout landed CRLF (core.autocrlf=true) or LF.
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8").replace(/\r\n/g, "\n");
}

const search = source("actions/counter/search.js");
const createReservation = source("actions/counter/create-reservation.js");
const walkInService = source("actions/counter/walk-in-service.js");
const results = source("components/dashboard/boutique/counter/CounterResults.jsx");

// 21 Sep 2026: publication status was gating the till. A brouillon or
// archivé atelier/formation was invisible to the counter's omnibar and
// refused by createCounterReservation, and a prestation désactivée was
// equally unreachable — staff had to publish/reactivate a catalogue entry on
// the public site just to cash in what was happening in front of them. The
// counter now sells what the salon runs; only a CANCELLED event stays out.
describe("the counter sells off-catalogue entries — brouillon, archivé, désactivée", () => {
  test("the sellable allow-list is exactly DRAFT/PUBLISHED/ARCHIVED — CANCELLED is never sellable", () => {
    expect([...COUNTER_SELLABLE_CATALOGUE_STATUSES].sort()).toEqual(["ARCHIVED", "DRAFT", "PUBLISHED"]);
    expect(isCounterSellableCatalogueStatus("DRAFT")).toBe(true);
    expect(isCounterSellableCatalogueStatus("ARCHIVED")).toBe(true);
    expect(isCounterSellableCatalogueStatus("CANCELLED")).toBe(false);
  });

  test("the omnibar searches sessions on that allow-list, not on PUBLISHED alone", () => {
    expect(search).toContain('import { COUNTER_SELLABLE_CATALOGUE_STATUSES } from "@/lib/counter/catalogue-availability"');
    expect(search).not.toContain('status: "PUBLISHED"');
    expect(search.match(/status: \{ in: COUNTER_SELLABLE_CATALOGUE_STATUSES \}/g)).toHaveLength(2);
  });

  test("each session row carries its catalogue status so the cashier is told what they picked", () => {
    expect(search).toContain("catalogueStatus: session.workshop.status");
    expect(search).toContain("catalogueStatus: session.formation.status");
    expect(results).toContain('const CATALOGUE_STATUS_LABEL = { DRAFT: "Brouillon", ARCHIVED: "Archivé" }');
    expect(results).toContain("<OffCatalogueBadge label={CATALOGUE_STATUS_LABEL[row.catalogueStatus]} />");
    expect(results).toContain('<OffCatalogueBadge label={row.isActive === false ? "Désactivée" : null} />');
  });

  // The search filter alone would be a UI-only rule: the transaction
  // re-reads the session FOR UPDATE and decides for itself.
  test("cashing a seat re-checks the same allow-list inside the transaction", () => {
    expect(createReservation).toContain(
      'import { isCounterSellableCatalogueStatus } from "@/lib/counter/catalogue-availability"'
    );
    expect(createReservation).toContain(
      'if (session.status !== "SCHEDULED" || !isCounterSellableCatalogueStatus(catalogue.status)) {'
    );
  });

  test("a deactivated prestation is searchable and sellable, but a deleted one never is", () => {
    expect(walkInService).not.toContain("isActive: true,\n        isDeleted: false,");
    expect(walkInService.match(/isDeleted: false,/g).length).toBeGreaterThanOrEqual(2);
    expect(walkInService).toContain("staff: { isActive: true, isDeleted: false }");
    expect(walkInService).toContain("isActive: row.isActive");
  });
});
