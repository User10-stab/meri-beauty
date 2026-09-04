import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TYPE_FILTERS } from "@/lib/dashboard/operation-filters";

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

  test("an unrecognised type, lifecycle status or payment event falls back to no filter, never reaches SQL", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    expect(actions).toContain('TYPE_FILTERS[tab]?.includes(params.type) ? params.type : "ALL"');
    expect(actions).toContain('lifecycleOptions.includes(params.lifecycleStatus) ? params.lifecycleStatus : "ALL"');
    expect(actions).toContain('PAYMENT_EVENT_FILTERS.includes(params.paymentEvent) ? params.paymentEvent : "ALL"');
  });

  test("the type filter narrows through the workshop/formation join, not a top-level column", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // WorkshopReservation/FormationReservation have no type column of their
    // own — it lives on the Activity/Formation the raw-SQL arm joins in.
    // Cast to text: WorkshopType/FormationType are enums, and the filter
    // value arrives as a bound text parameter.
    expect(actions).toContain('w."type"::text = ${type}');
    expect(actions).toContain('f."type"::text = ${type}');
  });

  test("the count and the page always come from the same unioned query", () => {
    const actions = source("actions/dashboard/admin-operations.js");
    // Both queries interpolate the SAME `unioned` fragment built once from
    // the active arms — unlike separate where-clauses, there is no way for
    // the total to disagree with what's actually filtered on the page.
    const fnIdx = actions.indexOf("async function listUnifiedOperationIds");
    const fn = actions.slice(fnIdx, actions.indexOf("\n}\n", fnIdx));
    expect(fn).toContain("const unioned = Prisma.join(arms,");
    expect(fn).toContain("FROM (${unioned}) AS combined\n      ORDER BY");
    expect(fn).toContain("FROM (${unioned}) AS combined`");
  });

  test("switching tab resets the filters instead of carrying a stale one across", () => {
    const client = source("components/dashboard/operations/AdminOperationsClient.jsx");
    expect(client).toContain('nextType = tab === nextTab ? type : "ALL"');
    expect(client).toContain('nextLifecycleStatus = tab === nextTab ? lifecycleStatus : "ALL"');
    expect(client).toContain('nextPaymentEvent = tab === nextTab ? paymentEvent : "ALL"');
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

  test("the search page threads type/lifecycleStatus/paymentEvent through to the server action", () => {
    const page = source("app/dashboard/operations/page.jsx");
    expect(page).toContain("type: params?.type");
    expect(page).toContain("lifecycleStatus: params?.lifecycleStatus");
    expect(page).toContain("paymentEvent: params?.paymentEvent");
  });
});
