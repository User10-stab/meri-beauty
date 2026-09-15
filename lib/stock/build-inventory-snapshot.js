/**
 * Current inventory snapshot — every active variant's stock/réservé/disponible
 * right now, for the printable "état du stock" a controller can check against
 * a physical count. Unlike the movements report this carries no date range:
 * it is a snapshot of the present moment, not a period.
 *
 * Pure and framework-free (no "use server") so it runs identically wherever
 * called; see actions/boutique/stock.js for the auth-gated wrapper.
 *
 * @param {import("@prisma/client").PrismaClient} client
 */
export async function buildInventorySnapshot(client) {
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
    rows,
    summary: {
      totalVariants: rows.length,
      lowStockCount: rows.filter((r) => r.isLowStock).length,
      totalUnits: rows.reduce((sum, r) => sum + r.stockQuantity, 0),
    },
  };
}
