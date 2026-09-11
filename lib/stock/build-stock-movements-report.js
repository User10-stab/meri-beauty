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
    },
  };
}
