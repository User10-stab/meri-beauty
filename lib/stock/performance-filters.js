/**
 * Vocabulary for the "Performance par produit" view of the Mouvements de
 * stock — shared by the page, the client table and the builder. Kept apart
 * from build-product-performance.js for the same reason filters.js is kept
 * apart from build-stock-movements-report.js: the client only needs these
 * constants, not the Prisma-querying builder.
 */

/** Rolling windows offered, in months. The default answers "sur 6 mois". */
export const PERFORMANCE_PERIODS = [3, 6, 12];
export const DEFAULT_PERFORMANCE_MONTHS = 6;

/**
 * A product younger than this has not had a fair chance yet — it gets
 * « Trop récent » instead of a keep/remove verdict. An upper bound: on a
 * young history the builder lowers it to half the days actually covered.
 */
export const NEW_PRODUCT_DAYS = 60;

/**
 * Past this many months of stock at the current selling pace, a product that
 * is not a best-seller is flagged as overstocked: stop reordering it.
 */
export const OVERSTOCK_MONTHS = 12;

/**
 * ABC (Pareto) split on revenue: the products that together make the first
 * 80 % of the period's revenue are A, the next 15 % B, the last 5 % C.
 */
export const ABC_A_SHARE = 0.8;
export const ABC_B_SHARE = 0.95;

export const VERDICTS = ["STAR", "KEEP", "WATCH", "OVERSTOCK", "SALON_ONLY", "REMOVE", "NEW"];

export const VERDICT_META = {
  STAR: {
    label: "Top vente — garder",
    short: "Top vente",
    help: "Fait partie des produits qui réalisent 80 % du chiffre d'affaires de la période.",
    tone: "emerald",
  },
  KEEP: {
    label: "Correct — garder",
    short: "Correct",
    help: "Se vend régulièrement, sans être parmi les meilleurs.",
    tone: "sky",
  },
  WATCH: {
    label: "Faible — à surveiller",
    short: "Faible",
    help: "Se vend, mais pèse très peu dans le chiffre d'affaires (les derniers 5 %).",
    tone: "amber",
  },
  OVERSTOCK: {
    label: "Surstock — ne pas recommander",
    short: "Surstock",
    help: `Au rythme actuel, le stock en rayon couvre plus de ${OVERSTOCK_MONTHS} mois de ventes.`,
    tone: "orange",
  },
  SALON_ONLY: {
    label: "Prestations uniquement",
    short: "Prestations",
    help: "Aucune vente, mais utilisé en prestation au salon — à garder si les soins en ont besoin.",
    tone: "violet",
  },
  REMOVE: {
    label: "Aucune vente — à retirer ?",
    short: "À retirer ?",
    help: "Aucune vente (nette des retours) ni utilisation en prestation sur toute la période.",
    tone: "red",
  },
  NEW: {
    label: "Trop récent pour juger",
    short: "Nouveau",
    help: "Ajouté trop récemment pour être comparé au reste du catalogue.",
    tone: "gray",
  },
};

export function normalizePerformanceMonths(value) {
  const months = Number(value);
  return PERFORMANCE_PERIODS.includes(months) ? months : DEFAULT_PERFORMANCE_MONTHS;
}

// ── View state (applied in the browser on the builder's rows) ────────────────

/**
 * Sortable table columns. `value` gives a number (or string) where a higher
 * number is better for numbers marked best: "desc", lower is better for
 * best: "asc". The first click on a header always puts the *best* products
 * on top; a second click flips to the worst first.
 *
 * Missing values are mapped to the worst end on purpose — a product with no
 * sale has no coverage and no sell-through, and must sink with « meilleurs
 * d'abord » rather than float to the top as a 0 or a null would.
 */
const VERDICT_RANK = { STAR: 0, KEEP: 1, WATCH: 2, OVERSTOCK: 3, SALON_ONLY: 4, NEW: 5, REMOVE: 6 };

function trendScore(monthly) {
  const half = Math.floor(monthly.length / 2);
  const first = monthly.slice(0, half).reduce((a, b) => a + b, 0);
  const second = monthly.slice(monthly.length - half).reduce((a, b) => a + b, 0);
  return second - first;
}

export const SORT_COLUMNS = {
  name: { label: "Produit", best: "asc", value: (p) => p.name },
  verdict: { label: "Verdict", best: "asc", value: (p) => VERDICT_RANK[p.verdict] ?? 99 },
  sold: { label: "Vendus", best: "desc", value: (p) => p.netSold },
  trend: { label: "Évolution", best: "desc", value: (p) => trendScore(p.monthly) },
  revenue: { label: "CA TTC", best: "desc", value: (p) => p.revenueTtc },
  margin: { label: "Marge HT", best: "desc", value: (p) => p.marginHt },
  stock: { label: "Stock", best: "desc", value: (p) => p.stockNow },
  // Fewest months of stock = sells fastest relative to what's on the shelf.
  coverage: { label: "Mois de stock", best: "asc", value: (p) => (p.coverageMonths === null ? Infinity : p.coverageMonths) },
  sellThrough: { label: "Écoulement", best: "desc", value: (p) => p.sellThrough ?? -1 },
  lastSale: { label: "Dernière vente", best: "desc", value: (p) => (p.lastSaleAt ? new Date(p.lastSaleAt).getTime() : 0) },
};

export const DEFAULT_SORT = "revenue";

/** Sorted copy; ties fall back to the name so the order never jitters. */
export function sortProducts(products, key, dir) {
  const column = SORT_COLUMNS[key] ?? SORT_COLUMNS[DEFAULT_SORT];
  const sign = dir === "asc" ? 1 : -1;
  return [...products].sort((a, b) => {
    const va = column.value(a);
    const vb = column.value(b);
    let diff;
    if (typeof va === "string") diff = va.localeCompare(vb, "fr");
    else if (va === vb) diff = 0;
    else diff = va < vb ? -1 : 1;
    return diff * sign || a.name.localeCompare(b.name, "fr");
  });
}

/** Header click: a new column starts on its « best first » direction, the same column flips. */
export function nextSort(current, key) {
  if (current.sort === key) return { sort: key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: key, dir: SORT_COLUMNS[key].best };
}

export const EMPTY_VIEW_FILTERS = {
  q: "",
  verdicts: [],
  sort: DEFAULT_SORT,
  dir: SORT_COLUMNS[DEFAULT_SORT].best,
};

// URL key ↔ state key. French keys, like ?mois= and the journal's filters.
const URL_KEYS = { q: "q", verdicts: "verdict", sort: "tri", dir: "ordre" };

/** Reads the view state back from a URLSearchParams, dropping anything unknown. */
export function readViewFilters(searchParams) {
  const get = (key) => searchParams?.get(URL_KEYS[key]) ?? "";
  const sort = SORT_COLUMNS[get("sort")] ? get("sort") : DEFAULT_SORT;
  const dir = ["asc", "desc"].includes(get("dir")) ? get("dir") : SORT_COLUMNS[sort].best;
  return {
    q: get("q"),
    verdicts: get("verdicts")
      .split(",")
      .filter((v) => VERDICTS.includes(v)),
    sort,
    dir,
  };
}

/** Writes the view state onto a copy of `searchParams`, leaving the period keys alone. */
export function writeViewFilters(searchParams, view) {
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  const isDefaultSort = view.sort === DEFAULT_SORT && view.dir === SORT_COLUMNS[DEFAULT_SORT].best;
  const values = {
    q: view.q.trim(),
    verdicts: view.verdicts.join(","),
    sort: isDefaultSort ? "" : view.sort,
    dir: isDefaultSort ? "" : view.dir,
  };
  for (const [key, urlKey] of Object.entries(URL_KEYS)) {
    if (values[key]) params.set(urlKey, values[key]);
    else params.delete(urlKey);
  }
  return params;
}

function matchesSearch(p, needle) {
  return (
    !needle ||
    p.name.toLowerCase().includes(needle) ||
    p.variants.some((v) => v.sku?.toLowerCase().includes(needle) || v.name.toLowerCase().includes(needle))
  );
}

/** Search only — the verdict chips count within it. */
export function searchProducts(products, q) {
  const needle = q.trim().toLowerCase();
  return products.filter((p) => matchesSearch(p, needle));
}

export function filterProducts(products, view) {
  const found = searchProducts(products, view.q);
  return view.verdicts.length === 0 ? found : found.filter((p) => view.verdicts.includes(p.verdict));
}

/** Totals over whatever is currently shown, so the cards follow the filters. */
export function summarizeProducts(products) {
  const round = (value) => Math.round(value * 100) / 100;
  const byVerdict = {};
  let revenueTtc = 0;
  let marginHt = 0;
  let unitsSold = 0;
  let stockValueAtCost = 0;
  for (const p of products) {
    revenueTtc += p.revenueTtc;
    marginHt += p.marginHt;
    unitsSold += p.netSold;
    stockValueAtCost += p.stockValueAtCost;
    const bucket = (byVerdict[p.verdict] ??= { count: 0, stockValueAtCost: 0 });
    bucket.count += 1;
    bucket.stockValueAtCost += p.stockValueAtCost;
  }
  for (const bucket of Object.values(byVerdict)) bucket.stockValueAtCost = round(bucket.stockValueAtCost);
  return {
    productCount: products.length,
    revenueTtc: round(revenueTtc),
    marginHt: round(marginHt),
    unitsSold,
    stockValueAtCost: round(stockValueAtCost),
    byVerdict,
  };
}
