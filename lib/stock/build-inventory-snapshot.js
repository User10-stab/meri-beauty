/**
 * Current inventory snapshot — every active variant's stock/réservé/disponible
 * right now, for the printable "état du stock" a controller can check against
 * a physical count. Unlike the movements report this normally carries no date
 * range: it is a snapshot of the present moment, not a period.
 *
 * Passing `asOf` (a "YYYY-MM-DD" string) switches to a *historical*
 * reconstruction — "what was on hand at close of that day" — read back from
 * InventoryMovement.newStock, the same ledger the mouvements report uses.
 * Réservé/disponible have no historical record (reservations are never
 * logged as movements — see the ProductVariant schema comment), so those
 * columns are meaningless for a past date and come back null; only the
 * on-hand quantity and the low-stock flag are reconstructed.
 *
 * Pure and framework-free (no "use server") so it runs identically wherever
 * called; see actions/boutique/stock.js for the auth-gated wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ asOf?: string }} [params]
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseAsOf(asOf) {
  if (typeof asOf !== "string" || !DATE_ONLY.test(asOf)) return null;
  const [year, month, day] = asOf.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1) return null;

  // A date that resolves to today (or later, from a hand-edited query
  // string) is just "now" — fall back to the live, non-reconstructed path
  // rather than paying for a movement scan that would return the same
  // numbers anyway.
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() >= startOfToday.getTime()) return null;

  date.setHours(23, 59, 59, 999);
  return date;
}

export async function buildInventorySnapshot(client, { asOf } = {}) {
  const asOfEnd = parseAsOf(asOf);

  const variants = await client.productVariant.findMany({
    where: { isDeleted: false, product: { isDeleted: false } },
    orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      stockQuantity: true,
      reservedQuantity: true,
      lowStockThreshold: true,
      product: { select: { name: true } },
    },
  });

  if (!asOfEnd) {
    const rows = variants.map((v) => {
      const availableQuantity = v.stockQuantity - v.reservedQuantity;
      return {
        id: v.id,
        productName: v.product.name,
        variantName: v.name,
        sku: v.sku,
        barcode: v.barcode,
        stockQuantity: v.stockQuantity,
        reservedQuantity: v.reservedQuantity,
        availableQuantity,
        lowStockThreshold: v.lowStockThreshold,
        isLowStock: availableQuantity <= v.lowStockThreshold,
      };
    });

    return {
      generatedAt: new Date(),
      asOf: null,
      isHistorical: false,
      rows,
      summary: {
        totalVariants: rows.length,
        lowStockCount: rows.filter((r) => r.isLowStock).length,
        totalUnits: rows.reduce((sum, r) => sum + r.stockQuantity, 0),
      },
    };
  }

  // Two DISTINCT ON scans, same recipe as fetchLatestMovementsByVariant in
  // actions/boutique/stock.js: the latest movement at-or-before the cutoff
  // gives "what it was after that day's last change"; the earliest movement
  // overall is the fallback for a variant whose first-ever movement happened
  // after the cutoff, in which case previousStock on that first row is what
  // was on hand at the cutoff (nothing moved before it).
  const [atCutoff, earliestEver] = await Promise.all([
    client.$queryRaw`
      SELECT DISTINCT ON (m."variantId") m."variantId", m."newStock"
      FROM "InventoryMovement" m
      WHERE m."createdAt" <= ${asOfEnd}
      ORDER BY m."variantId", m."createdAt" DESC
    `,
    client.$queryRaw`
      SELECT DISTINCT ON (m."variantId") m."variantId", m."previousStock", m."createdAt"
      FROM "InventoryMovement" m
      ORDER BY m."variantId", m."createdAt" ASC
    `,
  ]);

  const atCutoffByVariant = Object.fromEntries(atCutoff.map((r) => [r.variantId, r.newStock]));
  const earliestByVariant = Object.fromEntries(earliestEver.map((r) => [r.variantId, r.previousStock]));

  const rows = variants.map((v) => {
    let stockQuantity;
    if (v.id in atCutoffByVariant) {
      stockQuantity = atCutoffByVariant[v.id];
    } else if (v.id in earliestByVariant) {
      // Every recorded movement for this variant happened after the cutoff —
      // the level just before the first of them is what stood at the cutoff.
      stockQuantity = earliestByVariant[v.id];
    } else {
      // No movement ever recorded for this variant: its stock has never
      // changed, so the current figure is also the historical one.
      stockQuantity = v.stockQuantity;
    }

    return {
      id: v.id,
      productName: v.product.name,
      variantName: v.name,
      sku: v.sku,
      barcode: v.barcode,
      stockQuantity,
      reservedQuantity: null,
      availableQuantity: null,
      lowStockThreshold: v.lowStockThreshold,
      isLowStock: stockQuantity <= v.lowStockThreshold,
    };
  });

  return {
    generatedAt: new Date(),
    asOf: asOfEnd,
    isHistorical: true,
    rows,
    summary: {
      totalVariants: rows.length,
      lowStockCount: rows.filter((r) => r.isLowStock).length,
      totalUnits: rows.reduce((sum, r) => sum + r.stockQuantity, 0),
    },
  };
}
