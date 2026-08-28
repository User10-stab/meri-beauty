"use server";

import { prisma } from "@/lib/prisma";
import { cataloguePriceExclVat } from "@/lib/tax-policy";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";

/**
 * Inventory reports for Marie's annual accounting requirements
 * - Stock on hand (with value)
 * - Breakage/loss tracking (LOSS movements)
 * - Total cost of goods sold vs remaining inventory value
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

/**
 * Generate annual inventory report
 * Returns comprehensive data for accounting/yearly stock review
 */
export async function generateAnnualInventoryReport(year) {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  const targetYear = year || new Date().getFullYear();
  const startDate = new Date(targetYear, 0, 1); // Jan 1
  const endDate = new Date(targetYear, 11, 31, 23, 59, 59); // Dec 31

  try {
    // Get all variants with current stock
    const variants = await prisma.productVariant.findMany({
      where: { isDeleted: false, isActive: true },
      include: {
        product: {
          select: {
            name: true,
            subcategory: {
              select: {
                category: {
                  select: {
                    brand: { select: { name: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Get all inventory movements for the year
    const movements = await prisma.inventoryMovement.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate }
      },
      include: {
        variant: {
          include: {
            product: {
              include: {
                subcategory: {
                  include: {
                    category: {
                      include: {
                        brand: {
                          select: { name: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        createdBy: {
          select: { fullName: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Calculate stock value and breakage/loss by category
    const stockByBrand = {};
    let totalCurrentValue = 0;
    let totalCostValue = 0;
    let totalBreakageValue = 0;
    let totalLossValue = 0;

    // Current stock valuation
    for (const variant of variants) {
      const brandName = variant.product.subcategory?.category?.brand?.name || "Sans marque";
      // Retail prices are stored TTC; stock value/profit must compare their HT
      // base with the supplier cost, which is also HT.
      const currentValue = cataloguePriceExclVat(variant.price) * variant.stockQuantity;
      const costValue = Number(variant.costPrice) * variant.stockQuantity;

      if (!stockByBrand[brandName]) {
        stockByBrand[brandName] = {
          brand: brandName,
          itemCount: 0,
          totalUnits: 0,
          currentStockValue: 0,
          costValue: 0,
          potentialProfit: 0
        };
      }

      stockByBrand[brandName].itemCount++;
      stockByBrand[brandName].totalUnits += variant.stockQuantity;
      stockByBrand[brandName].currentStockValue += currentValue;
      stockByBrand[brandName].costValue += costValue;
      stockByBrand[brandName].potentialProfit += (currentValue - costValue);

      totalCurrentValue += currentValue;
      totalCostValue += costValue;
    }

    // Breakage and loss analysis
    const lossMovements = movements.filter(m => m.type === 'LOSS');
    const breakageByReason = {};
    const breakageByBrand = {};

    for (const movement of lossMovements) {
      const lossValue = Math.abs(movement.quantity) * Number(movement.variant.costPrice);
      const reason = movement.reason || 'Non spécifié';
      const brandName = movement.variant.product.subcategory?.category?.brand?.name || "Sans marque";

      totalLossValue += lossValue;

      // Group by reason
      if (!breakageByReason[reason]) {
        breakageByReason[reason] = {
          reason,
          count: 0,
          totalUnits: 0,
          totalValue: 0
        };
      }
      breakageByReason[reason].count++;
      breakageByReason[reason].totalUnits += Math.abs(movement.quantity);
      breakageByReason[reason].totalValue += lossValue;

      // Group by brand
      if (!breakageByBrand[brandName]) {
        breakageByBrand[brandName] = {
          brand: brandName,
          count: 0,
          totalUnits: 0,
          totalValue: 0
        };
      }
      breakageByBrand[brandName].count++;
      breakageByBrand[brandName].totalUnits += Math.abs(movement.quantity);
      breakageByBrand[brandName].totalValue += lossValue;
    }

    // Movement summary by type
    const movementSummary = movements.reduce((summary, m) => {
      const key = m.type === 'SALE' ? 'SALES' : m.type === 'RETURN' ? 'RETURNS' : m.type;
      summary[key] = (summary[key] || 0) + 1;
      return summary;
    }, { SALES: 0, RESTOCK: 0, RETURNS: 0, LOSS: 0, ADJUSTMENT: 0, SALON_USAGE: 0 });

    // Low stock items
    const lowStockItems = variants.filter(v => {
      const available = v.stockQuantity - v.reservedQuantity;
      return available <= v.lowStockThreshold;
    }).map(v => ({
      sku: v.sku,
      productName: v.product.name,
      variantName: v.name,
      availableStock: v.stockQuantity - v.reservedQuantity,
      lowStockThreshold: v.lowStockThreshold,
      brand: v.product.subcategory?.category?.brand?.name || "Sans marque"
    }));

    return {
      success: true,
      data: {
        year: targetYear,
        reportGenerated: new Date(),
        summary: {
          totalCurrentValue,
          totalCostValue,
          totalPotentialProfit: totalCurrentValue - totalCostValue,
          totalLossValue,
          totalVariants: variants.length,
          totalMovements: movements.length
        },
        stockByBrand: Object.values(stockByBrand).sort((a, b) => b.currentStockValue - a.currentStockValue),
        breakageByReason: Object.values(breakageByReason).sort((a, b) => b.totalValue - a.totalValue),
        breakageByBrand: Object.values(breakageByBrand).sort((a, b) => b.totalValue - a.totalValue),
        movementSummary,
        lowStockItems,
        recentLossMovements: lossMovements.slice(-10).reverse() // Last 10 losses
      }
    };
  } catch (error) {
    console.error("[generateAnnualInventoryReport]", error);
    return { success: false, message: "Impossible de générer le rapport d'inventaire." };
  }
}

/**
 * Get simplified inventory overview for dashboard
 */
export async function getInventoryOverview() {
  const guard = await requireAdmin();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const totalVariants = await prisma.productVariant.count({
      where: { isDeleted: false, isActive: true }
    });

    const outOfStockCount = await prisma.productVariant.count({
      where: {
        isDeleted: false,
        isActive: true,
        stockQuantity: 0
      }
    });

    // Fetched once and reused for both the low-stock count and the stock value
    // totals below. Low stock is available stock (stockQuantity - reservedQuantity)
    // at or under the threshold — the same definition generateAnnualInventoryReport
    // uses — computed in JS since Prisma can't compare two columns in a `where` filter.
    const variants = await prisma.productVariant.findMany({
      where: { isDeleted: false, isActive: true },
      select: { price: true, costPrice: true, stockQuantity: true, reservedQuantity: true, lowStockThreshold: true }
    });

    const lowStockCount = variants.filter(v =>
      (v.stockQuantity - v.reservedQuantity) <= v.lowStockThreshold
    ).length;

    const totalStockValue = variants.reduce((sum, v) =>
      sum + Number(v.price) * v.stockQuantity, 0
    );

    const totalCostValue = variants.reduce((sum, v) =>
      sum + Number(v.costPrice) * v.stockQuantity, 0
    );

    // Recent loss movements
    const recentLosses = await prisma.inventoryMovement.findMany({
      where: { type: 'LOSS' },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        variant: {
          include: {
            product: { select: { name: true } }
          }
        }
      }
    });

    return {
      success: true,
      data: {
        totalVariants,
        lowStockCount,
        outOfStockCount,
        totalStockValue,
        totalCostValue,
        totalPotentialProfit: totalStockValue - totalCostValue,
        recentLosses: recentLosses.map(m => ({
          productName: m.variant.product.name,
          quantity: Math.abs(m.quantity),
          reason: m.reason,
          date: m.createdAt
        }))
      }
    };
  } catch (error) {
    console.error("[getInventoryOverview]", error);
    return { success: false, message: "Impossible de charger l'aperçu de l'inventaire." };
  }
}
