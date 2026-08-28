"use server";

import { getOrCreateActiveCart } from "@/actions/boutique/cart";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { shippingQuoteRequestOwnerEmail, shippingQuoteRequestConfirmationEmail } from "@/lib/email-templates";
import { shippingQuoteRequestSchema } from "@/lib/validations/commerce";
import { calculateShippingCost, calculateTotalWeight, getShippingDetails } from "@/lib/shipping";
import { applyVatRate, repriceTtcCataloguePrice, resolveGoodsVatPolicy } from "@/lib/tax-policy";

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

    const session = await auth();
    const customer = session?.user?.role === "CUSTOMER"
      ? await prisma.user.findUnique({
          where: { id: session.user.id },
          select: { isCompany: true, vatNumber: true, vatValidatedAt: true },
        })
      : null;
    const vatPolicy = resolveGoodsVatPolicy({ customer });
    const subtotal = fullCart.items.reduce(
      (sum, item) => sum + repriceTtcCataloguePrice(item.variant.price, vatPolicy.vatRate) * item.quantity,
      0
    );
    const totalWeight = calculateTotalWeight(fullCart.items);
    const catalogueCost = calculateShippingCost(totalWeight, subtotal);

    // Handle >30kg orders that require manual shipping quote
    if (catalogueCost === "QUOTE_REQUIRED") {
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
    const cost = applyVatRate(catalogueCost, vatPolicy.vatRate);

    return {
      success: true,
      data: {
        subtotal,
        totalWeight,
        ...details,
        cost,
        // The carrier grid is already net, so the net figure is the one that
        // was read from it — not `cost` divided back down. The cart prints an
        // HT / TVA / TTC breakdown and needs carriage on the same footing as
        // the goods; deriving it here a second time would round twice.
        costExclVat: catalogueCost,
        vatRate: vatPolicy.vatRate,
      }
    };
  } catch (error) {
    console.error("[getCartShippingCost]", error);
    return { success: false, message: "Impossible de calculer les frais de port." };
  }
}

/**
 * For carts over 30kg, where no automatic price exists. Emails the salon
 * with the cart contents/weight/contact info and sends the customer a
 * confirmation — doesn't create an Order, since we don't have a price to
 * charge yet. Re-reads the cart server-side rather than trusting whatever
 * the client submits.
 */
export async function requestShippingQuote(input) {
  const parsed = shippingQuoteRequestSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.fullName?.[0] ?? errors.email?.[0] ?? errors.phone?.[0] ?? "Données invalides.",
    };
  }
  const { fullName, email, phone, pickupPoint, notes } = parsed.data;

  try {
    const cart = await getOrCreateActiveCart();
    const fullCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: { include: { variant: { include: { product: { select: { name: true } } } } } },
      },
    });
    if (!fullCart || fullCart.items.length === 0) {
      return { success: false, message: "Votre panier est vide." };
    }

    const totalWeight = calculateTotalWeight(fullCart.items);
    const subtotal = fullCart.items.reduce((sum, item) => sum + Number(item.variant.price) * item.quantity, 0);
    const totalWeightKg = totalWeight / 1000;

    if (calculateShippingCost(totalWeight, subtotal) !== "QUOTE_REQUIRED") {
      return { success: false, message: "Un devis n'est pas nécessaire pour cette commande — le tarif automatique s'applique." };
    }

    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { name: true, email: true } });
    const salonName = salon?.name || "Meri Beauty";

    const items = fullCart.items.map((item) => ({
      productName: item.variant.product.name,
      variantName: item.variant.name,
      quantity: item.quantity,
    }));

    if (salon?.email) {
      const ownerEmail = shippingQuoteRequestOwnerEmail({
        customerName: fullName,
        customerEmail: email,
        customerPhone: phone,
        items,
        totalWeightKg,
        subtotal,
        pickupPoint: pickupPoint ?? null,
        notes: notes ?? null,
        salonName,
      });
      await sendEmail({ to: salon.email, subject: ownerEmail.subject, text: ownerEmail.text, html: ownerEmail.html });
    }

    const confirmation = shippingQuoteRequestConfirmationEmail({ customerName: fullName, totalWeightKg, salonName });
    await sendEmail({ to: email, subject: confirmation.subject, text: confirmation.text, html: confirmation.html });

    return { success: true, message: "Votre demande de devis a été envoyée. Nous vous recontacterons sous peu." };
  } catch (error) {
    console.error("[requestShippingQuote]", error);
    return { success: false, message: "Impossible d'envoyer votre demande. Veuillez réessayer." };
  }
}
