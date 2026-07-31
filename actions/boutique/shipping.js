"use server";

import { getOrCreateActiveCart } from "@/actions/boutique/cart";
import { prisma } from "@/lib/prisma";
import { calculateShippingCost, calculateTotalWeight, getShippingDetails } from "@/lib/shipping";

/**
 * Get current cart shipping calculation for checkout display
 * Returns the same shipping cost that will be charged at checkout
 */
export async function getCartShippingCost() {
  try {
    const cart = await getOrCreateActiveCart();
    const fullCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: { variant: { select: { weightGrams: true, price: true } } },
        },
      },
    });

    if (!fullCart || fullCart.items.length === 0) {
      return { success: true, data: { cost: 0, isFree: true, details: null } };
    }

    const subtotal = fullCart.items.reduce(
      (sum, item) => sum + Number(item.variant.price) * item.quantity,
      0
    );
    const totalWeight = calculateTotalWeight(fullCart.items);
    const cost = calculateShippingCost(totalWeight, subtotal);

    // Handle >30kg orders that require manual shipping quote
    if (cost === "QUOTE_REQUIRED") {
      return {
        success: false,
        message: "Votre commande dépasse 30 kg. Contactez-nous pour un devis de livraison personnalisé.",
        data: {
          quoteRequired: true,
          totalWeight,
          totalWeightKg: totalWeight / 1000,
          subtotal
        }
      };
    }

    const details = getShippingDetails(totalWeight, subtotal);

    return {
      success: true,
      data: {
        cost,
        subtotal,
        totalWeight,
        ...details
      }
    };
  } catch (error) {
    console.error("[getCartShippingCost]", error);
    return { success: false, message: "Impossible de calculer les frais de port." };
  }
}
