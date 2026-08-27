import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TYPE_FILTERS, STATUS_FILTERS } from "@/lib/dashboard/operation-filters";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * The operations ledger mixed rows that read as identical until you opened
 * one — an atelier and an événement in the same table, a private and a
 * public formation, every order status lumped together. These filters let
 * staff tell them apart without an unbounded free-text search.
 */
describe("operations filters", () => {
  test("only WORKSHOP/EVENT and PRIVATE/PUBLIC are ever accepted as a type filter", () => {
    expect(TYPE_FILTERS.workshops).toEqual(["WORKSHOP", "EVENT"]);
    expect(TYPE_FILTERS.formations).toEqual(["PRIVATE", "PUBLIC"]);
    // Commandes has no type axis of its own — its status list already does
    // the equivalent job a type+status split does on the other two tabs.
    expect(TYPE_FILTERS.orders).toBeUndefined();
  });

  test("an unrecognised type or status falls back to no filter, never reaches Prisma", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    expect(actions).toContain('TYPE_FILTERS[tab]?.includes(params.type) ? params.type : "ALL"');
    expect(actions).toContain('STATUS_FILTERS[tab]?.includes(params.status) ? params.status : "ALL"');
  });

  test("the type filter narrows through the session relation, not a top-level column", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // WorkshopReservation/FormationReservation have no type column of their
    // own — it lives on the Activity/Formation reached through `session`.
    expect(actions).toContain("session: { workshop: { type } }");
    expect(actions).toContain("session: { formation: { type } }");
  });

  test("count() and findMany() are never allowed to disagree on the filter", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // Every filtered tab must build one `where` and pass it to BOTH calls —
    // a paginator whose total count ignores the filter shows the wrong page
    // count and a "Suivant" link that leads to an empty page.
    for (const [countCall, findCall] of [
      ["prisma.transaction.count({ where })", "prisma.transaction.findMany({\n          where,"],
      ["prisma.order.count({ where })", "prisma.order.findMany({\n          where,"],
      ["prisma.workshopReservation.count({ where })", "prisma.workshopReservation.findMany({\n          where,"],
      ["prisma.formationReservation.count({ where })", "prisma.formationReservation.findMany({\n          where,"],
    ]) {
      expect(actions, `missing "${countCall}"`).toContain(countCall);
      expect(actions, `missing "${findCall}"`).toContain(findCall);
    }
  });

  test("switching tab resets the filters instead of carrying a stale one across", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain('nextType = tab === nextTab ? type : "ALL"');
    expect(client).toContain('nextStatus = tab === nextTab ? status : "ALL"');
  });

  test("changing a filter resets to page 1", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    // href()'s nextPage default is 1, and every FilterPills link only ever
    // overrides nextType/nextStatus — it never passes nextPage.
    expect(client).toContain("nextPage = 1");
    expect(client).not.toMatch(/buildHref=.*nextPage/);
  });

  test("filters are links, not client-side-only state — they survive a reload", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    const filterPills = client.slice(client.indexOf("function FilterPills"), client.indexOf("export function AdminOperationsClient"));
    expect(filterPills).toContain("<Link");
    expect(filterPills).not.toContain("onClick");
  });

  test("the search page threads type/status through to the server action", () => {
    const page = source("app/dashboard/operations/page.jsx");
    expect(page).toContain("type: params?.type");
    expect(page).toContain("status: params?.status");
  });
});
