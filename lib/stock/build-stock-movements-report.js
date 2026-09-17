/**
 * The "mouvements de stock" ledger: every InventoryMovement across every
 * variant over an arbitrary date range, optionally narrowed to one type —
 * this is where an ADJUSTMENT now becomes visible outside the single-variant
 * history drawer. Most-recent-first, like the drawer, since there is no
 * cross-variant running balance the way the Livre de recettes has one.
 *
 * Kept out of any "use server" module so it can be unit-tested against a
 * plain mocked client — see actions/boutique/stock.js for the auth-gated
 * wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ from?: string, to?: string, type?: string }} [params]
 */

import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, MAX_MOVEMENTS_ROWS, normalizeStockMovementsParams } from "./filters";

export async function buildStockMovementsReport(client, params = {}) {
  const normalized = normalizeStockMovementsParams(params);
  const { fromDate, toDate, type } = normalized;

  const found = await client.inventoryMovement.findMany({
    where: {
      createdAt: { gte: fromDate, lte: toDate },
      ...(type !== "ALL" ? { type } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: MAX_MOVEMENTS_ROWS + 1,
    include: {
      variant: { select: { name: true, sku: true, product: { select: { name: true } } } },
      createdBy: { select: { fullName: true } },
    },
  });

  const truncated = found.length > MAX_MOVEMENTS_ROWS;
  const movements = truncated ? found.slice(0, MAX_MOVEMENTS_ROWS) : found;

  const stockTotals = await computeStockTotals(client, { fromDate, toDate });

  const byType = Object.fromEntries(MOVEMENT_TYPES.map((t) => [t, 0]));
  const rows = movements.map((m) => {
    byType[m.type] = (byType[m.type] ?? 0) + 1;
    return {
      id: m.id,
      createdAt: m.createdAt,
      productName: m.variant?.product?.name ?? "—",
      variantName: m.variant?.name ?? "—",
      sku: m.variant?.sku ?? "—",
      type: m.type,
      typeLabel: MOVEMENT_TYPE_LABELS[m.type] ?? m.type,
      quantity: m.quantity,
      previousStock: m.previousStock,
      newStock: m.newStock,
      reason: m.reason,
      createdByName: m.createdBy?.fullName ?? null,
    };
  });

  return {
    filters: {
      from: normalized.from,
      to: normalized.to,
      type,
      typeLabel: type === "ALL" ? "Tous les types" : MOVEMENT_TYPE_LABELS[type] ?? type,
    },
    generatedAt: new Date(),
    truncated,
    rows,
    summary: {
      count: rows.length,
      byType: MOVEMENT_TYPES.map((t) => ({ type: t, label: MOVEMENT_TYPE_LABELS[t], count: byType[t] })),
      stock: stockTotals,
    },
  };
}

// Same scope as the État du stock (build-inventory-snapshot.js): live
// variants of live products, so both printouts agree on "total stock".
const ACTIVE_VARIANT = { variant: { isDeleted: false, product: { isDeleted: false } } };

/**
 * Units on hand across the whole catalogue at the start and end of the
 * period, plus every unit that entered/left in between — ALWAYS over every
 * movement type, even when the ledger itself is filtered to one type, so
 * début + entrées − sorties = fin holds on paper for a controller.
 *
 * Works back from today's stockQuantity: InventoryMovement.quantity is signed
 * and SUM(quantity) reconciles to stockQuantity (see the schema comment), so
 * end = now − movements after the period, start = end − the period's net.
 */
export async function computeStockTotals(client, { fromDate, toDate }) {
  const [current, after, unitsIn, unitsOut] = await Promise.all([
    client.productVariant.aggregate({
      where: { isDeleted: false, product: { isDeleted: false } },
      _sum: { stockQuantity: true },
    }),
    client.inventoryMovement.aggregate({
      where: { ...ACTIVE_VARIANT, createdAt: { gt: toDate } },
      _sum: { quantity: true },
    }),
    client.inventoryMovement.aggregate({
      where: { ...ACTIVE_VARIANT, createdAt: { gte: fromDate, lte: toDate }, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    client.inventoryMovement.aggregate({
      where: { ...ACTIVE_VARIANT, createdAt: { gte: fromDate, lte: toDate }, quantity: { lt: 0 } },
      _sum: { quantity: true },
    }),
  ]);

  const entered = unitsIn._sum.quantity ?? 0;
  const left = Math.abs(unitsOut._sum.quantity ?? 0);
  const atEnd = (current._sum.stockQuantity ?? 0) - (after._sum.quantity ?? 0);
  return {
    atStart: atEnd - entered + left,
    unitsIn: entered,
    unitsOut: left,
    atEnd,
  };
}
