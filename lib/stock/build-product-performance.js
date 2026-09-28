/**
 * "Performance par produit" — how each product did over a rolling window
 * (3, 6 or 12 months) or a hand-picked « du … au … » range, so Marie can decide whether to keep it, stop
 * reordering it, or take it off the shelf. Where the Mouvements de stock
 * ledger lists movements one by one, this rolls them up per product.
 *
 * Two sources, each used for what it is authoritative on:
 *   - InventoryMovement for units: sales, returns, salon usage, losses,
 *     restocks, and the stock on hand at the start of the window.
 *   - OrderItem for money: what was actually charged (till discounts
 *     included), from orders that really sold — never a cancelled, expired,
 *     not-yet-paid or SETTLED_AT_COUNTER order (its items are counted once,
 *     on the counter sale that replaced it).
 *
 * Pure and framework-free (no "use server") so it can be unit-tested against
 * a plain mocked client — see actions/boutique/stock.js for the auth-gated
 * wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * Search, verdict chips and column sorting are applied in the browser on the
 * returned rows, never here: the ABC split and the verdicts are always
 * computed against the whole catalogue, so narrowing the list does not turn
 * its weakest product into a « Meilleures ventes ».
 *
 * @param {{ months?: number|string, from?: string, to?: string, now?: Date }} [params]
 */

import { cataloguePriceExclVat, roundMoney } from "@/lib/tax-policy";
import {
  ABC_A_SHARE,
  ABC_B_SHARE,
  NEW_PRODUCT_DAYS,
  OVERSTOCK_MONTHS,
  normalizePerformanceMonths,
} from "./performance-filters";
import { MAX_RANGE_DAYS } from "./filters";

const DAY_MS = 24 * 60 * 60 * 1000;
const AVG_MONTH_DAYS = 30.44;

export const SOLD_ORDER_STATUSES = ["PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"];

function addMonths(date, delta) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + delta);
  return result;
}

/**
 * The window ends at the end of today and starts N months earlier, cut into
 * N equal-ish monthly slices (each ending on the same day-of-month as today)
 * — calendar months would make the first and last bars partial and read as
 * a false dip on the trend.
 */
export function buildPerformanceWindow(months, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toDate = new Date(startOfToday);
  toDate.setHours(23, 59, 59, 999);
  const endExclusive = new Date(startOfToday.getTime() + DAY_MS);

  const slices = [];
  for (let k = months; k >= 1; k -= 1) {
    const start = addMonths(endExclusive, -k);
    const end = addMonths(endExclusive, -(k - 1));
    slices.push({
      start,
      end,
      label: new Date(end.getTime() - DAY_MS).toLocaleDateString("fr-BE", { month: "short" }),
    });
  }

  return { fromDate: slices[0].start, toDate, slices };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value) {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) return null;
  return date;
}

/**
 * A hand-picked « du … au … » window. Invalid, reversed or future-only input
 * yields null (the caller falls back to the preset); an over-long range is
 * clamped to MAX_RANGE_DAYS like the movement journal. Cut into equal slices:
 * weeks under 8 weeks, otherwise one slice per ~month (at most 12), so the
 * sparkline always has a handful of comparable bars.
 */
export function buildCustomWindow(from, to, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let fromDate = parseDateOnly(from);
  let lastDay = parseDateOnly(to);
  if (!fromDate || !lastDay) return null;
  if (lastDay > startOfToday) lastDay = startOfToday;
  if (fromDate > lastDay) return null;
  if ((lastDay - fromDate) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    fromDate = new Date(lastDay);
    fromDate.setDate(fromDate.getDate() - (MAX_RANGE_DAYS - 1));
  }

  const endExclusive = new Date(lastDay);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const toDate = new Date(endExclusive.getTime() - 1);
  const days = Math.round((endExclusive - fromDate) / DAY_MS);

  const weekly = days < 56;
  const count = weekly ? Math.max(1, Math.ceil(days / 7)) : Math.min(12, Math.max(2, Math.round(days / AVG_MONTH_DAYS)));
  const span = (endExclusive - fromDate) / count;
  const slices = Array.from({ length: count }, (_, i) => {
    const start = new Date(fromDate.getTime() + span * i);
    const end = i === count - 1 ? endExclusive : new Date(fromDate.getTime() + span * (i + 1));
    const label = weekly
      ? start.toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit" })
      : new Date(end.getTime() - 1).toLocaleDateString("fr-BE", { month: "short" });
    return { start, end, label };
  });

  return { fromDate, toDate, slices, days };
}

/** Preset (3/6/12 months back from today) unless a valid custom range is given. */
export function resolvePerformanceWindow({ months, from, to } = {}, now = new Date()) {
  const custom = buildCustomWindow(from, to, now);
  if (custom) return { mode: "custom", months: null, ...custom };

  const presetMonths = normalizePerformanceMonths(months);
  const preset = buildPerformanceWindow(presetMonths, now);
  const days = Math.round((preset.toDate.getTime() + 1 - preset.fromDate.getTime()) / DAY_MS);
  return { mode: "preset", months: presetMonths, ...preset, days };
}

function sliceIndex(slices, date) {
  const time = new Date(date).getTime();
  for (let i = 0; i < slices.length; i += 1) {
    if (time >= slices[i].start.getTime() && time < slices[i].end.getTime()) return i;
  }
  return -1;
}

function emptyTotals(sliceCount) {
  return {
    unitsSold: 0,
    unitsReturned: 0,
    salonUsage: 0,
    losses: 0,
    restocked: 0,
    adjustments: 0,
    revenueTtc: 0,
    revenueHt: 0,
    costOfSales: 0,
    stockStart: 0,
    stockNow: 0,
    stockValueAtCost: 0,
    monthly: Array.from({ length: sliceCount }, () => 0),
  };
}

/**
 * Keep/remove verdict for one product. Order matters: a product too new to
 * judge is never told to go, a product with no sales is split on whether the
 * salon still uses it in treatments, and a large stock only overrides the
 * ABC class when the product is not a best-seller (a best-seller with a big
 * delivery on the shelf is not a problem).
 */
export function decideVerdict({ ageDays, netSold, salonUsage, coverageMonths, abcClass }, newThresholdDays = NEW_PRODUCT_DAYS) {
  if (ageDays < newThresholdDays) return "NEW";
  if (netSold <= 0) return salonUsage > 0 ? "SALON_ONLY" : "REMOVE";
  if (abcClass !== "A" && coverageMonths !== null && coverageMonths > OVERSTOCK_MONTHS) return "OVERSTOCK";
  if (abcClass === "A") return "STAR";
  if (abcClass === "B") return "KEEP";
  return "WATCH";
}

/**
 * Pareto split on revenue (net units when nothing carries a price, e.g. a
 * catalogue sold only through zero-priced lines). Products with no sales are
 * left out — they get no class at all.
 */
export function assignAbcClasses(products) {
  const sellers = products.filter((p) => p.netSold > 0);
  const useRevenue = sellers.some((p) => p.revenueTtc > 0);
  const weight = (p) => (useRevenue ? p.revenueTtc : p.netSold);
  const total = sellers.reduce((sum, p) => sum + weight(p), 0);
  const classes = new Map();
  if (total <= 0) return classes;

  let cumulativeBefore = 0;
  for (const p of [...sellers].sort((a, b) => weight(b) - weight(a))) {
    // Classified on the share reached *before* this product, so the product
    // that crosses the 80 % line is still an A — otherwise a catalogue whose
    // single best-seller makes 85 % of revenue would have no A at all.
    const shareBefore = cumulativeBefore / total;
    classes.set(p.id, shareBefore < ABC_A_SHARE ? "A" : shareBefore < ABC_B_SHARE ? "B" : "C");
    cumulativeBefore += weight(p);
  }
  return classes;
}

export async function buildProductPerformance(client, params = {}) {
  const now = params.now ?? new Date();
  const period = resolvePerformanceWindow(params, now);
  const { fromDate, toDate, slices } = period;
  const months = period.days / AVG_MONTH_DAYS;
  // Ages are measured at the end of the window: on a past range, a product's
  // age is what it was then, not today.
  const ageRef = toDate < now ? toDate : now;

  const [variants, movements, orderItems, lastSales] = await Promise.all([
    client.productVariant.findMany({
      // A product created after the window closed did not exist in it — it
      // would otherwise read as « aucune vente, à retirer ».
      where: { isDeleted: false, product: { isDeleted: false, createdAt: { lte: toDate } } },
      orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
      select: {
        id: true,
        name: true,
        sku: true,
        costPrice: true,
        price: true,
        stockQuantity: true,
        isActive: true,
        product: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            subcategory: {
              select: {
                id: true,
                name: true,
                category: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    }),
    // From the window start up to now, not just to its end: on a past range,
    // the first movement after the start still tells the opening stock.
    client.inventoryMovement.findMany({
      where: { createdAt: { gte: fromDate }, variant: { isDeleted: false, product: { isDeleted: false } } },
      orderBy: [{ createdAt: "asc" }],
      select: { variantId: true, type: true, quantity: true, previousStock: true, createdAt: true },
    }),
    client.orderItem.findMany({
      where: {
        variantId: { not: null },
        order: { createdAt: { gte: fromDate, lte: toDate }, status: { in: SOLD_ORDER_STATUSES } },
      },
      select: { variantId: true, unitPrice: true, quantity: true },
    }),
    // The last sale ever, not just inside the window — "dernière vente il y a
    // 9 mois" is the most telling figure for a product with none in the window.
    client.$queryRaw`
      SELECT DISTINCT ON (m."variantId") m."variantId", m."createdAt"
      FROM "InventoryMovement" m
      WHERE m.type = 'SALE'
      ORDER BY m."variantId", m."createdAt" DESC
    `,
  ]);

  const lastSaleByVariant = new Map(lastSales.map((r) => [r.variantId, new Date(r.createdAt)]));

  const variantTotals = new Map();
  for (const v of variants) {
    const totals = emptyTotals(slices.length);
    totals.stockNow = v.stockQuantity;
    // No movement in the window → stock has not changed since it began.
    totals.stockStart = v.stockQuantity;
    totals.stockValueAtCost = v.stockQuantity * Number(v.costPrice);
    variantTotals.set(v.id, { variant: v, totals, seenFirstMovement: false });
  }

  for (const m of movements) {
    const entry = variantTotals.get(m.variantId);
    if (!entry) continue;
    const { totals } = entry;
    if (!entry.seenFirstMovement) {
      // Read the opening level off the first movement rather than summing
      // quantities back from today: RETURN_QUARANTINE carries a quantity but
      // never touches stockQuantity, so a sum would drift.
      totals.stockStart = m.previousStock;
      entry.seenFirstMovement = true;
    }
    if (new Date(m.createdAt) > toDate) continue;
    const units = Math.abs(m.quantity);
    const slice = sliceIndex(slices, m.createdAt);
    switch (m.type) {
      case "SALE":
        totals.unitsSold += units;
        if (slice >= 0) totals.monthly[slice] += units;
        break;
      case "RETURN":
      case "RETURN_QUARANTINE":
        totals.unitsReturned += units;
        if (slice >= 0) totals.monthly[slice] -= units;
        break;
      case "SALON_USAGE":
        totals.salonUsage += units;
        break;
      case "LOSS":
        totals.losses += units;
        break;
      case "RESTOCK":
        totals.restocked += units;
        break;
      case "ADJUSTMENT":
        totals.adjustments += m.quantity;
        break;
      default:
        break;
    }
  }

  for (const item of orderItems) {
    const entry = variantTotals.get(item.variantId);
    if (!entry) continue;
    const lineTtc = Number(item.unitPrice) * item.quantity;
    entry.totals.revenueTtc += lineTtc;
    entry.totals.revenueHt += cataloguePriceExclVat(lineTtc);
    entry.totals.costOfSales += Number(entry.variant.costPrice) * item.quantity;
  }

  // Roll variants up to their product — the keep/remove decision is about the
  // product on the shelf, the per-variant rows stay available underneath.
  const productMap = new Map();
  for (const { variant, totals } of variantTotals.values()) {
    const product = variant.product;
    let row = productMap.get(product.id);
    if (!row) {
      const subcategory = product.subcategory ?? null;
      const category = subcategory?.category ?? null;
      row = {
        id: product.id,
        name: product.name,
        status: product.status,
        createdAt: product.createdAt,
        brand: category?.brand ? { id: category.brand.id, name: category.brand.name } : null,
        category: category ? { id: category.id, name: category.name } : null,
        subcategory: subcategory ? { id: subcategory.id, name: subcategory.name } : null,
        lastSaleAt: null,
        variants: [],
        ...emptyTotals(slices.length),
      };
      productMap.set(product.id, row);
    }

    const lastSaleAt = lastSaleByVariant.get(variant.id) ?? null;
    if (lastSaleAt && (!row.lastSaleAt || lastSaleAt > row.lastSaleAt)) row.lastSaleAt = lastSaleAt;

    for (const key of ["unitsSold", "unitsReturned", "salonUsage", "losses", "restocked", "adjustments", "revenueTtc", "revenueHt", "costOfSales", "stockStart", "stockNow", "stockValueAtCost"]) {
      row[key] += totals[key];
    }
    totals.monthly.forEach((units, i) => {
      row.monthly[i] += units;
    });

    row.variants.push({
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      isActive: variant.isActive,
      lastSaleAt,
      ...finalizeMetrics(totals, { months, ageDays: daysBetween(product.createdAt, ageRef) }),
    });
  }

  const products = [...productMap.values()].map((row) => {
    const { variants: variantRows, id, name, status, createdAt, brand, category, subcategory, lastSaleAt, ...totals } = row;
    const ageDays = daysBetween(createdAt, ageRef);
    return {
      id,
      name,
      status,
      createdAt,
      brand,
      category,
      subcategory,
      ageDays,
      lastSaleAt,
      variants: variantRows,
      ...finalizeMetrics(totals, { months, ageDays }),
    };
  });

  // The catalogue was created in one go at launch (Wix import), so on a young
  // shop every product is "a few weeks old" — a flat 60-day grace period
  // would label the whole catalogue « Nouveauté » and answer nothing. A product
  // is new when it has had less than half the time the window actually
  // covers, capped at NEW_PRODUCT_DAYS once the history is long enough.
  const dataSince = variants.reduce((earliest, v) => {
    const created = new Date(v.product.createdAt);
    return !earliest || created < earliest ? created : earliest;
  }, null);
  const coveredFrom = dataSince && dataSince > fromDate ? dataSince : fromDate;
  const coveredDays = daysBetween(coveredFrom, ageRef);
  const newThresholdDays = Math.min(NEW_PRODUCT_DAYS, Math.floor(coveredDays / 2));

  const classes = assignAbcClasses(products);
  const totalRevenueTtc = products.reduce((sum, p) => sum + p.revenueTtc, 0);
  for (const p of products) {
    p.abcClass = classes.get(p.id) ?? null;
    p.revenueShare = totalRevenueTtc > 0 ? p.revenueTtc / totalRevenueTtc : 0;
    p.verdict = decideVerdict(p, newThresholdDays);
  }

  products.sort((a, b) => b.revenueTtc - a.revenueTtc || b.netSold - a.netSold || a.name.localeCompare(b.name, "fr"));

  const byVerdict = {};
  for (const p of products) {
    const bucket = (byVerdict[p.verdict] ??= { count: 0, revenueTtc: 0, stockValueAtCost: 0 });
    bucket.count += 1;
    bucket.revenueTtc += p.revenueTtc;
    bucket.stockValueAtCost += p.stockValueAtCost;
  }
  for (const bucket of Object.values(byVerdict)) {
    bucket.revenueTtc = roundMoney(bucket.revenueTtc);
    bucket.stockValueAtCost = roundMoney(bucket.stockValueAtCost);
  }

  return {
    generatedAt: new Date(),
    // Calendar dates as "YYYY-MM-DD", not Date instances: the window is cut
    // on the server's local calendar (same as filters.js), and re-formatting
    // an instant in the browser's time zone can shift it to the next day.
    filters: {
      mode: period.mode,
      months: period.months,
      days: period.days,
      from: toDateOnlyString(fromDate),
      to: toDateOnlyString(toDate),
    },
    // Set only when the window reaches back before the first product existed:
    // the page then says how many days the figures really cover.
    history: dataSince && dataSince > fromDate ? { since: toDateOnlyString(dataSince), coveredDays } : null,
    newThresholdDays,
    sliceLabels: slices.map((s) => s.label),
    products,
    summary: {
      productCount: products.length,
      revenueTtc: roundMoney(totalRevenueTtc),
      marginHt: roundMoney(products.reduce((sum, p) => sum + p.marginHt, 0)),
      unitsSold: products.reduce((sum, p) => sum + p.netSold, 0),
      stockValueAtCost: roundMoney(products.reduce((sum, p) => sum + p.stockValueAtCost, 0)),
      byVerdict,
    },
  };
}

function toDateOnlyString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetween(from, to) {
  return Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS);
}

/**
 * Derived figures from raw totals. The monthly pace is taken over the time
 * the product has actually been in the catalogue inside the window, so a
 * product added 2 months into a 6-month window is not judged on 6 months.
 */
function finalizeMetrics(totals, { months, ageDays }) {
  const netSold = totals.unitsSold - totals.unitsReturned;
  // Floored at one month (or the whole window, when it is shorter) so a
  // product a few days old is not credited with a wildly inflated pace.
  const monthsOnSale = Math.max(Math.min(1, months), Math.min(months, ageDays / AVG_MONTH_DAYS));
  const avgPerMonth = netSold > 0 ? netSold / monthsOnSale : 0;
  const coverageMonths = avgPerMonth > 0 ? totals.stockNow / avgPerMonth : null;
  const available = totals.stockStart + totals.restocked;
  const sellThrough = available > 0 ? Math.min(1, Math.max(0, netSold) / available) : null;
  const revenueHt = roundMoney(totals.revenueHt);
  const costOfSales = roundMoney(totals.costOfSales);
  const marginHt = roundMoney(revenueHt - costOfSales);

  // Trend: the second half of the window against the first half. Not shown
  // for tiny volumes, where one sale more or less swings the arrow.
  const half = Math.floor(totals.monthly.length / 2);
  const firstHalf = totals.monthly.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalf = totals.monthly.slice(totals.monthly.length - half).reduce((a, b) => a + b, 0);
  let trend = null;
  if (firstHalf + secondHalf >= 4) {
    if (secondHalf >= firstHalf * 1.25) trend = "UP";
    else if (secondHalf <= firstHalf * 0.75) trend = "DOWN";
    else trend = "FLAT";
  }

  return {
    unitsSold: totals.unitsSold,
    unitsReturned: totals.unitsReturned,
    netSold,
    salonUsage: totals.salonUsage,
    losses: totals.losses,
    restocked: totals.restocked,
    adjustments: totals.adjustments,
    revenueTtc: roundMoney(totals.revenueTtc),
    revenueHt,
    costOfSales,
    marginHt,
    marginRate: revenueHt > 0 ? marginHt / revenueHt : null,
    stockStart: totals.stockStart,
    stockNow: totals.stockNow,
    stockValueAtCost: roundMoney(totals.stockValueAtCost),
    avgPerMonth: Math.round(avgPerMonth * 10) / 10,
    coverageMonths: coverageMonths === null ? null : Math.round(coverageMonths * 10) / 10,
    sellThrough,
    trend,
    monthly: totals.monthly,
  };
}
