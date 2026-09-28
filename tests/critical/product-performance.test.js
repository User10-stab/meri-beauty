import { describe, expect, it, vi } from "vitest";
import {
  assignAbcClasses,
  buildCustomWindow,
  buildPerformanceWindow,
  buildProductPerformance,
  decideVerdict,
  resolvePerformanceWindow,
} from "@/lib/stock/build-product-performance";
import {
  EMPTY_VIEW_FILTERS,
  filterProducts,
  nextSort,
  normalizePerformanceMonths,
  readViewFilters,
  sortProducts,
  writeViewFilters,
} from "@/lib/stock/performance-filters";

const NOW = new Date("2026-09-28T15:00:00");
const OLD = new Date("2025-01-01T10:00:00");

function variant(id, productId, productName, { stock = 0, cost = "10.00", createdAt = OLD } = {}) {
  return {
    id,
    name: "Standard",
    sku: id.toUpperCase(),
    costPrice: cost,
    price: "30.25",
    stockQuantity: stock,
    isActive: true,
    product: { id: productId, name: productName, status: "ACTIVE", createdAt },
  };
}

function movement(variantId, type, quantity, previousStock, createdAt) {
  return { variantId, type, quantity, previousStock, createdAt: new Date(createdAt) };
}

function mockClient({ variants, movements = [], orderItems = [], lastSales = [] }) {
  return {
    productVariant: { findMany: vi.fn().mockResolvedValue(variants) },
    inventoryMovement: { findMany: vi.fn().mockResolvedValue(movements) },
    orderItem: { findMany: vi.fn().mockResolvedValue(orderItems) },
    $queryRaw: vi.fn().mockResolvedValue(lastSales),
  };
}

/**
 * 28 Sep 2026: « mouvement de stock sur une période » — per-product
 * performance over 3/6/12 months so Marie can decide to keep or remove a
 * product, next to the day-by-day movement ledger.
 */
describe("product performance", () => {
  it("only accepts the offered windows, defaulting to 6 months", () => {
    expect(normalizePerformanceMonths("3")).toBe(3);
    expect(normalizePerformanceMonths(12)).toBe(12);
    expect(normalizePerformanceMonths("24")).toBe(6);
    expect(normalizePerformanceMonths(undefined)).toBe(6);
  });

  it("cuts the window into N back-to-back monthly slices ending today", () => {
    const { fromDate, toDate, slices } = buildPerformanceWindow(6, NOW);
    expect(slices).toHaveLength(6);
    expect(fromDate).toEqual(new Date("2026-03-29T00:00:00"));
    expect(toDate).toEqual(new Date("2026-09-28T23:59:59.999"));
    for (let i = 1; i < slices.length; i += 1) expect(slices[i].start).toEqual(slices[i - 1].end);
    expect(slices.at(-1).end).toEqual(new Date("2026-09-29T00:00:00"));
  });

  it("verdicts: new first, then no-sale split on salon usage, overstock only below A", () => {
    const base = { ageDays: 400, netSold: 10, salonUsage: 0, coverageMonths: 2, abcClass: "B" };
    expect(decideVerdict({ ...base, ageDays: 20, netSold: 0 })).toBe("NEW");
    expect(decideVerdict({ ...base, netSold: 0 })).toBe("REMOVE");
    expect(decideVerdict({ ...base, netSold: 0, salonUsage: 3 })).toBe("SALON_ONLY");
    expect(decideVerdict({ ...base, coverageMonths: 20 })).toBe("OVERSTOCK");
    expect(decideVerdict({ ...base, abcClass: "A", coverageMonths: 20 })).toBe("STAR");
    expect(decideVerdict(base)).toBe("KEEP");
    expect(decideVerdict({ ...base, abcClass: "C" })).toBe("WATCH");
  });

  it("ABC: the product crossing 80 % is still an A, non-sellers get no class", () => {
    const classes = assignAbcClasses([
      { id: "big", netSold: 5, revenueTtc: 850 },
      { id: "mid", netSold: 5, revenueTtc: 120 },
      { id: "small", netSold: 1, revenueTtc: 30 },
      { id: "none", netSold: 0, revenueTtc: 0 },
    ]);
    expect(classes.get("big")).toBe("A");
    expect(classes.get("mid")).toBe("B");
    expect(classes.get("small")).toBe("C");
    expect(classes.has("none")).toBe(false);
  });

  it("rolls movements and order lines up per product, with returns netted and quarantine not drifting stock", async () => {
    const client = mockClient({
      variants: [
        variant("v1", "p1", "Sérum", { stock: 4, cost: "10.00" }),
        variant("v2", "p1", "Sérum", { stock: 0, cost: "10.00" }),
        variant("v3", "p2", "Crème oubliée", { stock: 7, cost: "5.00" }),
        variant("v4", "p3", "Huile de soin", { stock: 2 }),
      ],
      movements: [
        movement("v1", "SALE", -3, 10, "2026-05-02T10:00:00"),
        movement("v1", "RESTOCK", 5, 7, "2026-06-01T10:00:00"),
        movement("v1", "SALE", -8, 12, "2026-09-10T10:00:00"),
        movement("v1", "RETURN_QUARANTINE", 1, 4, "2026-09-12T10:00:00"),
        movement("v2", "SALE", -2, 2, "2026-07-15T10:00:00"),
        movement("v4", "SALON_USAGE", -1, 3, "2026-08-01T10:00:00"),
      ],
      orderItems: [
        { variantId: "v1", unitPrice: "30.25", quantity: 11 },
        { variantId: "v2", unitPrice: "24.20", quantity: 2 },
      ],
      lastSales: [
        { variantId: "v1", createdAt: new Date("2026-09-10T10:00:00") },
        { variantId: "v3", createdAt: new Date("2025-11-03T10:00:00") },
      ],
    });

    const report = await buildProductPerformance(client, { months: 6, now: NOW });
    const byName = Object.fromEntries(report.products.map((p) => [p.name, p]));

    const serum = byName["Sérum"];
    expect(serum.unitsSold).toBe(13);
    expect(serum.unitsReturned).toBe(1);
    expect(serum.netSold).toBe(12);
    expect(serum.stockStart).toBe(12); // v1 opened at 10, v2 at 2
    expect(serum.stockNow).toBe(4);
    expect(serum.restocked).toBe(5);
    expect(serum.revenueTtc).toBe(381.15);
    expect(serum.revenueHt).toBe(315);
    expect(serum.costOfSales).toBe(130);
    expect(serum.marginHt).toBe(185);
    expect(serum.avgPerMonth).toBe(2);
    expect(serum.coverageMonths).toBe(2);
    expect(serum.monthly).toEqual([0, 3, 0, 2, 0, 7]);
    expect(serum.trend).toBe("UP");
    expect(serum.variants).toHaveLength(2);
    expect(serum.verdict).toBe("STAR");
    expect(serum.lastSaleAt).toEqual(new Date("2026-09-10T10:00:00"));

    const forgotten = byName["Crème oubliée"];
    expect(forgotten.netSold).toBe(0);
    expect(forgotten.coverageMonths).toBeNull();
    expect(forgotten.stockValueAtCost).toBe(35);
    expect(forgotten.verdict).toBe("REMOVE");
    expect(forgotten.lastSaleAt).toEqual(new Date("2025-11-03T10:00:00"));

    expect(byName["Huile de soin"].verdict).toBe("SALON_ONLY");

    expect(report.summary.byVerdict.REMOVE).toEqual({ count: 1, revenueTtc: 0, stockValueAtCost: 35 });
    expect(report.products[0].name).toBe("Sérum");
  });

  it("only counts revenue from orders that actually sold", async () => {
    const client = mockClient({ variants: [variant("v1", "p1", "Sérum")] });
    await buildProductPerformance(client, { months: 3, now: NOW });

    const { where } = client.orderItem.findMany.mock.calls[0][0];
    expect(where.order.status.in).toEqual(["PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"]);
    for (const excluded of ["CANCELLED", "EXPIRED", "PENDING_PAYMENT", "PENDING_PICKUP", "SETTLED_AT_COUNTER"]) {
      expect(where.order.status.in).not.toContain(excluded);
    }
  });

  it("a product added mid-window is judged on its own time on sale, and a brand-new one is never told to go", async () => {
    const client = mockClient({
      variants: [
        variant("v1", "p1", "Nouveauté", { stock: 10, createdAt: new Date("2026-09-01T10:00:00") }),
        variant("v2", "p2", "Arrivé en juillet", { stock: 6, createdAt: new Date("2026-07-29T10:00:00") }),
      ],
      movements: [movement("v2", "SALE", -4, 10, "2026-08-15T10:00:00")],
    });

    const report = await buildProductPerformance(client, { months: 6, now: NOW });
    const byName = Object.fromEntries(report.products.map((p) => [p.name, p]));

    expect(byName["Nouveauté"].verdict).toBe("NEW");
    // 61 days on sale ≈ 2 months, not 6: 4 sold → 2/month, 6 in stock → 3 months.
    expect(byName["Arrivé en juillet"].avgPerMonth).toBe(2);
    expect(byName["Arrivé en juillet"].coverageMonths).toBe(3);
  });

  it("on a young catalogue, « Nouveau » is relative to the history — not the whole launch import", async () => {
    // The real dev data on 28 Sep 2026: the whole catalogue imported ~46 days
    // earlier. A flat 60-day rule labelled every product « Nouveau ».
    const launch = new Date("2026-08-13T10:00:00");
    const client = mockClient({
      variants: [
        variant("v1", "p1", "Au lancement, vendu", { stock: 3, createdAt: launch }),
        variant("v2", "p2", "Au lancement, jamais vendu", { stock: 5, createdAt: launch }),
        variant("v3", "p3", "Ajouté la semaine passée", { stock: 5, createdAt: new Date("2026-09-20T10:00:00") }),
      ],
      movements: [movement("v1", "SALE", -2, 5, "2026-09-01T10:00:00")],
    });

    const report = await buildProductPerformance(client, { months: 6, now: NOW });
    const byName = Object.fromEntries(report.products.map((p) => [p.name, p]));

    expect(report.history).toEqual({ since: "2026-08-13", coveredDays: 46 });
    expect(report.filters).toEqual({ mode: "preset", months: 6, days: 184, from: "2026-03-29", to: "2026-09-28" });
    expect(report.newThresholdDays).toBe(23);
    expect(byName["Au lancement, vendu"].verdict).toBe("STAR");
    expect(byName["Au lancement, jamais vendu"].verdict).toBe("REMOVE");
    expect(byName["Ajouté la semaine passée"].verdict).toBe("NEW");
  });

  it("no history banner once the data covers the whole window", async () => {
    const report = await buildProductPerformance(mockClient({ variants: [variant("v1", "p1", "Sérum")] }), { months: 6, now: NOW });
    expect(report.history).toBeNull();
    expect(report.newThresholdDays).toBe(60);
  });
});

/**
 * 28 Sep 2026, follow-up: « better date filters » — a hand-picked du/au range
 * (plus month pickers and year shortcuts on the page) alongside 3/6/12 months.
 */
describe("product performance — custom date range", () => {
  it("falls back to the preset when the range is missing, reversed or malformed", () => {
    expect(resolvePerformanceWindow({ months: "3" }, NOW)).toMatchObject({ mode: "preset", months: 3 });
    expect(resolvePerformanceWindow({ from: "2026-09-10", to: "2026-09-01" }, NOW).mode).toBe("preset");
    expect(resolvePerformanceWindow({ from: "2026-02-30", to: "2026-03-10" }, NOW).mode).toBe("preset");
    expect(resolvePerformanceWindow({ from: "hier", to: "2026-03-10" }, NOW).mode).toBe("preset");
  });

  it("takes whole days, clamps the end to today and the length to 366 days", () => {
    const w = buildCustomWindow("2026-08-01", "2026-12-31", NOW);
    expect(w.fromDate).toEqual(new Date("2026-08-01T00:00:00"));
    expect(w.toDate).toEqual(new Date("2026-09-28T23:59:59.999"));
    expect(w.days).toBe(59);

    const long = buildCustomWindow("2020-01-01", "2026-09-28", NOW);
    expect(long.days).toBe(366);
    expect(long.fromDate).toEqual(new Date("2025-09-28T00:00:00"));
  });

  it("cuts short ranges into weeks and long ones into ~months, back to back", () => {
    const short = buildCustomWindow("2026-09-01", "2026-09-28", NOW);
    expect(short.slices).toHaveLength(4);
    const year = buildCustomWindow("2025-10-01", "2026-09-28", NOW);
    expect(year.slices).toHaveLength(12);
    for (const w of [short, year]) {
      expect(w.slices[0].start).toEqual(w.fromDate);
      expect(w.slices.at(-1).end.getTime()).toBe(w.toDate.getTime() + 1);
      for (let i = 1; i < w.slices.length; i += 1) expect(w.slices[i].start).toEqual(w.slices[i - 1].end);
    }
  });

  it("a past range counts only its own sales, opens on the right stock, and ignores products created later", async () => {
    const client = mockClient({
      variants: [variant("v1", "p1", "Sérum", { stock: 2 })],
      movements: [
        movement("v1", "SALE", -3, 10, "2026-06-10T10:00:00"),
        movement("v1", "SALE", -5, 7, "2026-08-20T10:00:00"), // after the range
      ],
    });

    const report = await buildProductPerformance(client, { from: "2026-06-01", to: "2026-06-30", now: NOW });

    expect(report.filters).toMatchObject({ mode: "custom", months: null, from: "2026-06-01", to: "2026-06-30", days: 30 });
    expect(report.products[0].netSold).toBe(3);
    expect(report.products[0].stockStart).toBe(10);
    const { where } = client.productVariant.findMany.mock.calls[0][0];
    expect(where.product.createdAt).toEqual({ lte: new Date("2026-06-30T23:59:59.999") });
  });
});

/**
 * 28 Sep 2026, follow-up: the extra dropdown filters were dropped in favour
 * of clickable column headers — first click = best products first, second
 * click = worst first.
 */
describe("product performance — column sorting and view state", () => {
  const product = (name, extra = {}) => ({
    id: name,
    name,
    verdict: "KEEP",
    netSold: 1,
    revenueTtc: 10,
    marginHt: 5,
    stockNow: 1,
    coverageMonths: 1,
    sellThrough: 0.5,
    lastSaleAt: "2026-09-01T10:00:00.000Z",
    monthly: [0, 0, 1, 0],
    variants: [],
    ...extra,
  });
  const top = product("Top", { verdict: "STAR", netSold: 30, revenueTtc: 900, marginHt: 300, coverageMonths: 0.5, sellThrough: 0.9, lastSaleAt: "2026-09-27T10:00:00.000Z", monthly: [2, 3, 10, 15] });
  const mid = product("Moyen", { netSold: 5, revenueTtc: 100, marginHt: 40, coverageMonths: 4, sellThrough: 0.4 });
  const dead = product("Dormant", { verdict: "REMOVE", netSold: 0, revenueTtc: 0, marginHt: 0, stockNow: 9, coverageMonths: null, sellThrough: null, lastSaleAt: null, monthly: [0, 0, 0, 0] });
  const all = [dead, mid, top];
  const order = (key, dir) => sortProducts(all, key, dir).map((p) => p.name);

  it("the first click on any column puts the best products on top", () => {
    for (const key of ["verdict", "sold", "trend", "revenue", "margin", "coverage", "sellThrough", "lastSale"]) {
      const first = nextSort({ sort: "name", dir: "asc" }, key);
      expect(order(first.sort, first.dir)[0], key).toBe("Top");
      expect(order(first.sort, first.dir).at(-1), key).toBe("Dormant");
    }
  });

  it("months of stock is best when lowest, and « no sale » (∞) always sinks with best-first", () => {
    expect(nextSort({ sort: "revenue", dir: "desc" }, "coverage")).toEqual({ sort: "coverage", dir: "asc" });
    expect(order("coverage", "asc")).toEqual(["Top", "Moyen", "Dormant"]);
    expect(order("coverage", "desc")).toEqual(["Dormant", "Moyen", "Top"]);
  });

  it("a second click on the same column flips it", () => {
    expect(nextSort({ sort: "revenue", dir: "desc" }, "revenue")).toEqual({ sort: "revenue", dir: "asc" });
    expect(order("revenue", "asc")).toEqual(["Dormant", "Moyen", "Top"]);
  });

  it("search and several verdicts at once", () => {
    const f = (patch) => filterProducts(all, { ...EMPTY_VIEW_FILTERS, ...patch }).map((p) => p.name);
    expect(f({ q: "dorm" })).toEqual(["Dormant"]);
    expect(f({ verdicts: ["STAR", "REMOVE"] })).toEqual(["Dormant", "Top"]);
  });

  it("round-trips through the URL without touching the period keys, and drops junk", () => {
    const view = { ...EMPTY_VIEW_FILTERS, verdicts: ["REMOVE", "OVERSTOCK"], sort: "coverage", dir: "desc" };
    const params = writeViewFilters(new URLSearchParams("mois=12"), view);
    expect(params.get("mois")).toBe("12");
    expect(params.get("verdict")).toBe("REMOVE,OVERSTOCK");
    expect(params.get("tri")).toBe("coverage");
    expect(readViewFilters(params)).toEqual(view);
    // The default sort stays out of the URL.
    expect(writeViewFilters(new URLSearchParams(), EMPTY_VIEW_FILTERS).toString()).toBe("");
    expect(readViewFilters(new URLSearchParams("tri=HACK&ordre=sideways&verdict=NOPE"))).toEqual(EMPTY_VIEW_FILTERS);
  });
});
