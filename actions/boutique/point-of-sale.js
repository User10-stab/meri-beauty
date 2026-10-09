"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole, isTillCashOperator, canUseSalonTill } from "@/lib/authorization";
import { pointOfSaleSaleSchema } from "@/lib/validations/point-of-sale";
import { issueInvoice, buildInvoiceCustomer } from "@/lib/invoicing";
import { allocatePieceNumber, PIECE_SERIES } from "@/lib/cash-book/piece-number";
import { allocateOrderTicketNumber } from "@/lib/tickets/allocate-ticket-number";
import { ensureCashSessionOpen } from "@/lib/cash-book/session-lifecycle";
import { renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";
import {
  calculateVatTotals,
  repriceTtcCataloguePrice,
  resolveGoodsVatPolicy,
  hasInvoiceableVatIdentity,
  isPeppolMandatoryCustomer,
} from "@/lib/tax-policy";
import { saveCheckoutVatNumber } from "@/lib/customer-vat";
import { stripe } from "@/lib/stripe";
import { getAppBaseUrl } from "@/lib/site-url";
import { fulfillOrderPayment, orderInvoiceLines, orderTicketLines } from "@/lib/orders/fulfill-order-payment";
import { POS_HANDOFF_STATUSES, canSettleOrderAtPointOfSale } from "@/lib/orders/point-of-sale-handoff";
import { orderTerminalReference } from "@/lib/payments/terminal-reference";
import { applyCounterPromoCode, CounterPromoCodeError } from "@/lib/promo-codes";
import {
  barcodeLookupCandidates,
  buildSearchEntry,
  isInternalBarcode,
  linkableBarcodeError,
  rankSearchEntries,
} from "@/lib/counter/product-search";

const BCRYPT_SALT_ROUNDS = 12;
const POS_CHECKOUT_SECONDS = 31 * 60;

// The till: Marie, the admins, and any staff member granted CAISSE
// (canUseSalonTill). Everything sold here is boutique stock — the salon's.
async function requirePointOfSaleAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await canUseSalonTill(session.user))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

function serializeCustomer(customer) {
  return {
    id: customer.id,
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    addressCity: customer.addressCity,
    addressPostalCode: customer.addressPostalCode,
    addressCountry: customer.addressCountry,
    // Prefills the field on selection — never re-verified against VIES just
    // by picking a match; only re-typing/changing it at the till does.
    vatNumber: customer.vatNumber ?? "",
    isCompany: Boolean(customer.isCompany),
    vatInvoiceReady: hasInvoiceableVatIdentity(customer),
    vatValidationName: customer.vatValidationName ?? null,
  };
}

async function resolvePointOfSaleCustomer(tx, requestedCustomer, include) {
  // The active-email database constraint is case-insensitive. Resolve with
  // the same rule so an older account saved as Client@Example.com is not
  // missed when the till submits client@example.com and then recreated.
  if (requestedCustomer.id) {
    const selectedCustomer = await tx.user.findFirst({
      where: {
        id: requestedCustomer.id,
        role: "CUSTOMER",
        isDeleted: false,
        email: { equals: requestedCustomer.email, mode: "insensitive" },
      },
      include,
    });
    if (selectedCustomer) return selectedCustomer;
  }

  // An email can also belong to an OWNER/ADMIN/STAFF account. Order.userId
  // accepts any User, so a counter purchase must reuse that active account
  // rather than fail against the global active-email uniqueness constraint.
  return tx.user.findFirst({
    where: {
      email: { equals: requestedCustomer.email, mode: "insensitive" },
      isDeleted: false,
    },
    include,
  });
}

async function createOrRecoverPointOfSaleCheckout(order) {
  if (order.stripeCheckoutSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (existing.payment_status === "paid") {
      await fulfillOrderPayment(existing);
      return { session: existing, paid: true };
    }
    if (existing.status === "open") return { session: existing, paid: false };
  }

  const metadata = { kind: "order", orderId: order.id, source: "pos" };
  const expiresAt = Math.floor(order.expiresAt.getTime() / 1000);
  if (expiresAt < Math.floor(Date.now() / 1000) + 30 * 60) {
    throw new Error("POS_CHECKOUT_RETRY_WINDOW_EXPIRED");
  }
  // Lines at face value, the promo as a Stripe coupon — as the online
  // checkout does — so the amount charged is order.totalAmount.
  const coupon = Number(order.discountAmount) > 0
    ? await stripe.coupons.create({
        amount_off: Math.round(Number(order.discountAmount) * 100),
        currency: "eur",
        duration: "once",
        name: "Code promotionnel",
      })
    : null;
  const session = await stripe.checkout.sessions.create(
    {
      payment_method_types: ["card"],
      line_items: order.items.map((item) => ({
        price_data: {
          currency: "eur",
          product_data: { name: item.variantName ? `${item.productName} — ${item.variantName}` : item.productName },
          unit_amount: Math.round(Number(item.unitPrice) * 100),
        },
        quantity: item.quantity,
      })),
      ...(coupon ? { discounts: [{ coupon: coupon.id }] } : {}),
      mode: "payment",
      success_url: `${getAppBaseUrl()}/boutique/order/success?session_id={CHECKOUT_SESSION_ID}&source=pos`,
      cancel_url: `${getAppBaseUrl()}/boutique/order/success?pos_canceled=1`,
      customer_email: order.user.email,
      metadata,
      payment_intent_data: { metadata },
      expires_at: expiresAt,
    },
    { idempotencyKey: `pos-qr-${order.posAttemptKey}` }
  );

  await prisma.order.update({
    where: { id: order.id },
    data: {
      stripeCheckoutSessionId: session.id,
    },
  });
  return { session, paid: false };
}

/** Limited customer lookup for a counter sale. Never exposes financial data. */
export async function searchPointOfSaleCustomers(query) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const value = query?.trim();
  if (!value || value.length < 2) return { success: true, data: [] };

  try {
    const customers = await prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        isDeleted: false,
        OR: [
          { fullName: { contains: value, mode: "insensitive" } },
          { email: { contains: value, mode: "insensitive" } },
          { phone: { contains: value, mode: "insensitive" } },
        ],
      },
      orderBy: { fullName: "asc" },
      take: 8,
      select: {
        id: true, fullName: true, email: true, phone: true,
        addressLine1: true, addressLine2: true, addressCity: true,
        addressPostalCode: true, addressCountry: true, vatNumber: true,
        vatValidatedAt: true, vatValidationName: true, isCompany: true,
      },
    });
    return { success: true, data: customers.map(serializeCustomer) };
  } catch (error) {
    console.error("[searchPointOfSaleCustomers]", error);
    return { success: false, message: "Impossible de rechercher le client.", data: [] };
  }
}

/**
 * Prefill for the till when an unpaid pickup order is opened with
 * « Encaisser » from the orders list: its client and its lines, at today's
 * shelf price (the same price the sale itself will charge). Nothing is
 * changed here — the order is only closed when the sale completes.
 *
 * availableQuantity adds back what this order itself holds: those units are
 * reserved for exactly this client, so they must not count against them.
 */
export async function getPointOfSaleOrderDraft(orderId) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };
  // Settling a boutique pickup order is the salon's own worklist (Commandes),
  // not part of the CAISSE permission.
  if (!isTillCashOperator(guard.session.user)) return { success: false, message: "Accès non autorisé." };
  if (typeof orderId !== "string" || !orderId) return { success: false, message: "Commande introuvable." };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfilmentMode: true,
        stockReleasedAt: true,
        discountAmount: true,
        payment: { select: { id: true } },
        user: {
          select: {
            id: true, fullName: true, email: true, phone: true, isDeleted: true,
            addressLine1: true, addressLine2: true, addressCity: true,
            addressPostalCode: true, addressCountry: true, vatNumber: true,
            vatValidatedAt: true, vatValidationName: true, isCompany: true,
          },
        },
        items: {
          select: {
            variantId: true,
            productName: true,
            variantName: true,
            quantity: true,
            variant: {
              select: {
                id: true,
                name: true,
                price: true,
                stockQuantity: true,
                reservedQuantity: true,
                isActive: true,
                isDeleted: true,
                product: { select: { name: true, status: true, isDeleted: true } },
              },
            },
          },
        },
      },
    });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (!canSettleOrderAtPointOfSale(order)) {
      return { success: false, message: `La commande n°${order.orderNumber} n'est plus à encaisser.` };
    }

    const lines = new Map();
    const unavailable = [];
    for (const item of order.items) {
      const variant = item.variant;
      const sellable =
        variant && variant.isActive && !variant.isDeleted && !variant.product.isDeleted && variant.product.status === "ACTIVE";
      if (!sellable) {
        unavailable.push(item.variantName ? `${item.productName} — ${item.variantName}` : item.productName);
        continue;
      }
      const present = lines.get(variant.id);
      if (present) {
        present.quantity += item.quantity;
        present.availableQuantity += item.quantity;
        continue;
      }
      lines.set(variant.id, {
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        unitPrice: Number(variant.price),
        quantity: item.quantity,
        availableQuantity: Math.max(0, variant.stockQuantity - variant.reservedQuantity) + item.quantity,
      });
    }

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customer: order.user && !order.user.isDeleted ? serializeCustomer(order.user) : null,
        items: [...lines.values()],
        unavailable,
        discountAmount: Number(order.discountAmount ?? 0),
      },
    };
  } catch (error) {
    console.error("[getPointOfSaleOrderDraft]", error);
    return { success: false, message: "Impossible de charger cette commande." };
  }
}

const POS_VARIANT_CART_SELECT = {
  id: true,
  name: true,
  price: true,
  stockQuantity: true,
  reservedQuantity: true,
  product: { select: { name: true } },
};

function serializePointOfSaleCartVariant(variant) {
  return {
    variantId: variant.id,
    productName: variant.product.name,
    variantName: variant.name,
    // Shelf price: the stored TTC amount the cashier reads out and
    // collects. completePointOfSaleSale still re-reads the variant and
    // resolves the buyer's rate server-side, so this display value is
    // never trusted as the amount charged.
    unitPrice: Number(variant.price),
    availableQuantity: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
  };
}

/**
 * Resolves an EAN/UPC for the counter without exposing cost or margin.
 *
 * An unknown code answers BARCODE_UNKNOWN rather than a plain error: most
 * boxes carry a supplier EAN the catalogue simply hasn't learnt yet, and the
 * till then offers to link it to the product the cashier picks
 * (linkPointOfSaleBarcode) — after which this lookup finds it directly.
 */
export async function getPointOfSaleProductByBarcode(barcode) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };

  const code = barcode?.trim();
  if (!code) return { success: false, message: "Code-barres vide." };

  try {
    const variant = await prisma.productVariant.findFirst({
      where: {
        // UPC-A vs EAN-13 (a leading 0): the same box, read either way.
        barcode: { in: barcodeLookupCandidates(code) },
        isActive: true,
        isDeleted: false,
        product: { isDeleted: false, status: "ACTIVE" },
      },
      select: POS_VARIANT_CART_SELECT,
    });
    if (!variant) {
      return {
        success: false,
        code: "BARCODE_UNKNOWN",
        barcode: code,
        // Only a code the till would accept to link is worth offering.
        linkable: linkableBarcodeError(code) === null,
        message: "Aucun produit actif ne correspond à ce code-barres.",
      };
    }

    return { success: true, data: serializePointOfSaleCartVariant(variant) };
  } catch (error) {
    console.error("[getPointOfSaleProductByBarcode]", error);
    return { success: false, message: "Impossible de lire ce produit." };
  }
}

/**
 * Teaches the catalogue a supplier barcode from the till: a box scanned as
 * unknown, then the matching product picked by name. From then on the scan
 * alone finds it — no label to print or stick.
 *
 * Deliberately narrow, because a wrong link would ring up the wrong product
 * on every later scan:
 * - only a variant with NO barcode, or with the generated internal one
 *   (IN…), can receive it — replacing a real supplier code is a catalogue
 *   edit and stays in the product editor;
 * - a code already on another variant (archived ones included — the column
 *   is unique) is refused, never moved;
 * - a numeric EAN/UPC must pass its check digit;
 * - written with an audit row naming who linked it.
 */
export async function linkPointOfSaleBarcode({ variantId, barcode } = {}) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };

  const code = typeof barcode === "string" ? barcode.trim() : "";
  const formatError = linkableBarcodeError(code);
  if (formatError) return { success: false, message: formatError };
  if (typeof variantId !== "string" || !variantId) return { success: false, message: "Produit introuvable." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: {
          id: variantId,
          isActive: true,
          isDeleted: false,
          product: { isDeleted: false, status: "ACTIVE" },
        },
        select: { ...POS_VARIANT_CART_SELECT, barcode: true },
      });
      if (!variant) throw new Error("POS_LINK_VARIANT_NOT_FOUND");
      if (variant.barcode && !isInternalBarcode(variant.barcode)) {
        const error = new Error("POS_LINK_VARIANT_HAS_BARCODE");
        error.existingBarcode = variant.barcode;
        throw error;
      }

      const owner = await tx.productVariant.findFirst({
        where: { barcode: { in: barcodeLookupCandidates(code) } },
        select: { id: true, name: true, isDeleted: true, product: { select: { name: true } } },
      });
      if (owner) {
        const error = new Error("POS_LINK_BARCODE_TAKEN");
        error.owner = owner;
        throw error;
      }

      await tx.productVariant.update({ where: { id: variant.id }, data: { barcode: code } });
      await tx.auditLog.create({
        data: {
          actorId: guard.session.user.id,
          actorRole: guard.session.user.role,
          action: "product_variant.barcode_linked_at_counter",
          entityType: "ProductVariant",
          entityId: variant.id,
          before: { barcode: variant.barcode },
          after: { barcode: code },
          metadata: { productName: variant.product.name, variantName: variant.name },
        },
      });
      return { variant, replacedInternalBarcode: variant.barcode };
    }, { timeout: 15000, maxWait: 10000 });

    return {
      success: true,
      data: serializePointOfSaleCartVariant(result.variant),
      replacedInternalBarcode: result.replacedInternalBarcode ?? null,
    };
  } catch (error) {
    if (error.message === "POS_LINK_VARIANT_NOT_FOUND") {
      return { success: false, message: "Ce produit n'est plus en vente." };
    }
    if (error.message === "POS_LINK_VARIANT_HAS_BARCODE") {
      return {
        success: false,
        message: `Ce produit a déjà le code-barres ${error.existingBarcode}. Pour le remplacer, modifiez la fiche produit.`,
      };
    }
    if (error.message === "POS_LINK_BARCODE_TAKEN") {
      const { owner } = error;
      const label = owner.name && owner.name !== "Standard" ? `${owner.product.name} — ${owner.name}` : owner.product.name;
      return {
        success: false,
        message: `Ce code-barres appartient déjà à « ${label} »${owner.isDeleted ? " (archivé)" : ""}.`,
      };
    }
    // Two tills linking the same code at once: the unique index decides.
    if (error.code === "P2002") {
      return { success: false, message: "Ce code-barres vient d'être associé à un autre produit." };
    }
    console.error("[linkPointOfSaleBarcode]", error);
    return { success: false, message: "Impossible d'associer ce code-barres." };
  }
}

/**
 * Name/SKU/barcode search for the counter — the fallback for the (many)
 * products that have no barcode label on the box, and the picker used to
 * link an unknown scanned barcode (linkPointOfSaleBarcode).
 *
 * Results are VARIANT-level, not product-level: the cart line, the stock
 * decrement and the invoice line all key on variantId, so "Popits" has to
 * come back as one row per variant rather than one row needing a second
 * disambiguating click.
 *
 * Matching is forgiving (lib/counter/product-search): accents ignored, each
 * typed word matched on its own in any order, by prefix, a typo or two
 * tolerated, and the brand/category count too. That scoring runs in JS over
 * the whole active catalogue — a few hundred variants — rather than a
 * Postgres `contains`, which needed the exact spelling and word order.
 * Among equally good matches, what the shop sells most comes first.
 *
 * Same visibility filters as the barcode lookup above (ACTIVE product, live
 * variant) so the counter can never find and try to sell a draft, and the
 * same narrow select: costPrice/comparePrice must not travel to the client.
 */
const POS_SEARCH_LIMIT = 24;
const POS_POPULARITY_DAYS = 180;
const POS_POPULARITY_STATUSES = ["PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED", "COMPLETED"];

export async function searchPointOfSaleProducts(query) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const value = query?.trim();
  // Mirrors searchPointOfSaleCustomers: one character matches most of the
  // catalogue and is never a real search.
  if (!value || value.length < 2) return { success: true, data: [] };

  try {
    const since = new Date(Date.now() - POS_POPULARITY_DAYS * 24 * 60 * 60 * 1000);
    const [variants, sales] = await Promise.all([
      prisma.productVariant.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          product: { isDeleted: false, status: "ACTIVE" },
        },
        orderBy: [{ product: { name: "asc" } }, { position: "asc" }],
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          price: true,
          stockQuantity: true,
          reservedQuantity: true,
          lowStockThreshold: true,
          product: {
            select: {
              name: true,
              subcategory: {
                select: {
                  name: true,
                  category: { select: { name: true, brand: { select: { name: true } } } },
                },
              },
              images: {
                select: { path: true },
                orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
                take: 1,
              },
            },
          },
        },
      }),
      prisma.orderItem.groupBy({
        by: ["variantId"],
        where: {
          variantId: { not: null },
          createdAt: { gte: since },
          order: { status: { in: POS_POPULARITY_STATUSES } },
        },
        _sum: { quantity: true },
      }),
    ]);

    const soldByVariant = new Map(sales.map((row) => [row.variantId, row._sum.quantity ?? 0]));
    const ranked = rankSearchEntries(
      variants.map((variant) => {
        const subcategory = variant.product.subcategory;
        return {
          variant,
          searchEntry: buildSearchEntry({
            productName: variant.product.name,
            variantName: variant.name,
            brandName: subcategory?.category?.brand?.name,
            categoryNames: [subcategory?.category?.name, subcategory?.name],
            sku: variant.sku,
            barcode: variant.barcode,
          }),
        };
      }),
      value
    );

    const results = ranked.map(({ item: { variant }, score }) => {
      // Available, not on-hand: stock already reserved for an online order
      // awaiting pickup is not sellable at the counter. Same formula as
      // getPointOfSaleProductByBarcode.
      const availableQuantity = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
      return {
        row: {
          variantId: variant.id,
          productName: variant.product.name,
          variantName: variant.name,
          unitPrice: Number(variant.price),
          availableQuantity,
          isLowStock: availableQuantity > 0 && availableQuantity <= variant.lowStockThreshold,
          imagePath: variant.product.images[0]?.path ?? null,
          // For the « Associer » button after an unknown scan: only a variant
          // without a real supplier code can take one (linkPointOfSaleBarcode).
          barcodeLinkable: !variant.barcode || isInternalBarcode(variant.barcode),
          hasInternalBarcode: isInternalBarcode(variant.barcode),
        },
        score,
        sold: soldByVariant.get(variant.id) ?? 0,
      };
    });

    // Sellable first, out-of-stock last but still listed — staff need to see
    // that a product exists and is simply empty, not wonder if they mistyped.
    // Then best match, then best seller; Array#sort is stable, so the
    // name/position ordering above breaks the remaining ties.
    results.sort((a, b) => {
      const aSellable = a.row.availableQuantity > 0;
      const bSellable = b.row.availableQuantity > 0;
      if (aSellable !== bSellable) return aSellable ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return b.sold - a.sold;
    });

    return { success: true, data: results.slice(0, POS_SEARCH_LIMIT).map((result) => result.row) };
  } catch (error) {
    console.error("[searchPointOfSaleProducts]", error);
    return { success: false, message: "Impossible de rechercher les produits.", data: [] };
  }
}

/**
 * The whole sellable catalogue for the till's photo grid, in one call.
 *
 * A few hundred products is small enough to ship at once and filter in the
 * browser: brand/category chips and the search then react instantly, with
 * no request per tap or keystroke. Re-fetched after every sale and when the
 * window regains focus, so stock figures don't drift far.
 *
 * Product-level rows (one tile per product), each carrying its live
 * variants (sizes/shades picked on the tile). Same visibility filters and
 * the same narrow select as the search above: never a draft, never a
 * cost price.
 */
export async function getPointOfSaleCatalogue() {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error, data: null };

  try {
    const since = new Date(Date.now() - POS_POPULARITY_DAYS * 24 * 60 * 60 * 1000);
    const liveVariant = { isActive: true, isDeleted: false };
    const [products, sales] = await Promise.all([
      prisma.product.findMany({
        where: { isDeleted: false, status: "ACTIVE", variants: { some: liveVariant } },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          subcategory: {
            select: {
              id: true,
              name: true,
              position: true,
              category: {
                select: { id: true, name: true, position: true, brand: { select: { id: true, name: true } } },
              },
            },
          },
          images: {
            select: { path: true },
            orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
            take: 1,
          },
          variants: {
            where: liveVariant,
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              price: true,
              stockQuantity: true,
              reservedQuantity: true,
              lowStockThreshold: true,
            },
          },
        },
      }),
      prisma.orderItem.groupBy({
        by: ["variantId"],
        where: {
          variantId: { not: null },
          createdAt: { gte: since },
          order: { status: { in: POS_POPULARITY_STATUSES } },
        },
        _sum: { quantity: true },
      }),
    ]);

    const soldByVariant = new Map(sales.map((row) => [row.variantId, row._sum.quantity ?? 0]));

    return {
      success: true,
      data: products.map((product) => {
        const subcategory = product.subcategory;
        const category = subcategory?.category;
        const variants = product.variants.map((variant) => {
          // Available, not on-hand — same formula as the barcode lookup.
          const availableQuantity = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
          return {
            variantId: variant.id,
            variantName: variant.name,
            sku: variant.sku,
            barcode: variant.barcode,
            unitPrice: Number(variant.price),
            availableQuantity,
            isLowStock: availableQuantity > 0 && availableQuantity <= variant.lowStockThreshold,
            barcodeLinkable: !variant.barcode || isInternalBarcode(variant.barcode),
            hasInternalBarcode: isInternalBarcode(variant.barcode),
            sold: soldByVariant.get(variant.id) ?? 0,
          };
        });
        return {
          id: product.id,
          name: product.name,
          imagePath: product.images[0]?.path ?? null,
          brandId: category?.brand?.id ?? null,
          brandName: category?.brand?.name ?? null,
          categoryId: category?.id ?? null,
          categoryName: category?.name ?? null,
          categoryPosition: category?.position ?? 0,
          subcategoryId: subcategory?.id ?? null,
          subcategoryName: subcategory?.name ?? null,
          subcategoryPosition: subcategory?.position ?? 0,
          sold: variants.reduce((sum, variant) => sum + variant.sold, 0),
          variants,
        };
      }),
    };
  } catch (error) {
    console.error("[getPointOfSaleCatalogue]", error);
    return { success: false, message: "Impossible de charger le catalogue.", data: null };
  }
}

/**
 * Live sellable stock for the variants in the till's cart (or one about to
 * be added). The grid is a snapshot: an online order can reserve the last
 * unit while a client stands at the counter with the same product. The till
 * polls this so the cashier sees it before taking the money, not after.
 *
 * Display/guard only — completePointOfSaleSale still locks each variant
 * row (FOR UPDATE) and re-checks stock − reserved at payment, the same lock
 * createOrderFromCart takes online, so the two can never both sell the
 * last unit whatever this returns.
 */
export async function getPointOfSaleStockLevels(variantIds) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error, data: {} };

  const ids = Array.isArray(variantIds)
    ? [...new Set(variantIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, 100)
    : [];
  if (ids.length === 0) return { success: true, data: {} };

  try {
    const variants = await prisma.productVariant.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        isDeleted: false,
        product: { isDeleted: false, status: "ACTIVE" },
      },
      select: { id: true, stockQuantity: true, reservedQuantity: true },
    });
    const levels = Object.fromEntries(ids.map((id) => [id, 0])); // gone/unlisted = nothing to sell
    for (const variant of variants) {
      levels[variant.id] = Math.max(0, variant.stockQuantity - variant.reservedQuantity);
    }
    return { success: true, data: levels };
  } catch (error) {
    console.error("[getPointOfSaleStockLevels]", error);
    return { success: false, message: "Impossible de vérifier le stock.", data: {} };
  }
}

/**
 * Records a fully settled counter sale. This deliberately has no Cart and no
 * customer-facing checkout state: inventory, payment, invoice and audit row
 * commit together, or none do.
 */
export async function completePointOfSaleSale(input) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };

  // A boutique sale is ALWAYS the salon's money, whoever rings it up: on-till,
  // salon ticket, salon revenue (Payment.payeeStaffId stays null). Everyone
  // who passed requirePointOfSaleAccess may put it in the Livre de caisse —
  // Marie, the admins, and a staff member granted CAISSE — so this is false
  // for every caller today; it is kept as the one switch every till branch
  // below reads.
  const offTill = !(await canUseSalonTill(guard.session.user));

  // Every POS sale — whatever the payment method — must belong to a till
  // session, not just CASH ones. Before this gate, a card/QR sale rung up
  // with no session open completed normally and simply carried
  // cashSessionId: null forever (see Transaction.pieceNumber allocation
  // below): unrecoverable once made. Blocking here instead of only warning
  // means staff open the till before ringing up anything, not after. An
  // off-till cashier is exempt — nothing they ring up enters the till.
  if (!offTill) {
    const openCashSessionGate = await ensureCashSessionOpen(prisma);
    if (!openCashSessionGate) {
      return {
        success: false,
        message: "Aucune session de caisse n'est ouverte. Ouvrez la caisse avant d'encaisser une vente.",
        requiresCashSession: true,
      };
    }
  }

  const parsed = pointOfSaleSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Données de caisse invalides." };
  }

  const { customer: requestedCustomer, walkInEmail, items, method, attemptKey, cashReceived, invoiceRequested, sourceOrderId, promoCode } = parsed.data;
  // Closing a boutique pickup order from the till is the salon's own
  // worklist (see getPointOfSaleOrderDraft), not part of CAISSE.
  if (sourceOrderId && !isTillCashOperator(guard.session.user)) {
    return { success: false, message: "Accès non autorisé." };
  }
  if (items.some((item) => item.type === "SERVICE")) {
    return {
      success: false,
      message: "Les prestations doivent être encaissées depuis Pointage & encaissement afin de rester liées au catalogue et au personnel.",
    };
  }
  if (!attemptKey) {
    return { success: false, message: "Identifiant de tentative de caisse manquant. Rechargez la page." };
  }
  const isQrPayment = method === "CARD_QR";
  // No account, no invoice — a simplified ticket is issued instead. The
  // schema's refine already blocks this combined with CARD_QR (Stripe
  // checkout needs a real customer_email), so isQrPayment is never true here.
  const isWalkIn = requestedCustomer === null;
  const groupedItems = new Map();
  for (const item of items) {
    if (item.type !== "PRODUCT") continue;
    groupedItems.set(item.variantId, (groupedItems.get(item.variantId) ?? 0) + item.quantity);
  }
  const placeholderPassword = await bcrypt.hash(randomBytes(18).toString("base64url"), BCRYPT_SALT_ROUNDS);

  try {
    const priorOrder = await prisma.order.findUnique({
      where: { posAttemptKey: attemptKey },
      include: { items: true, user: { select: { email: true } } },
    });
    if (priorOrder) {
      if (priorOrder.source !== "POS" || priorOrder.createdByStaffId !== guard.session.user.id) {
        return { success: false, message: "Cette tentative de caisse n'est pas valide." };
      }
      if (priorOrder.status === "COMPLETED") {
        return { success: true, data: { orderId: priorOrder.id, orderNumber: priorOrder.orderNumber, completed: true, alreadyProcessed: true } };
      }
      if (isQrPayment && priorOrder.status === "PENDING_PAYMENT") {
        const checkout = await createOrRecoverPointOfSaleCheckout(priorOrder);
        return {
          success: true,
          data: {
            orderId: priorOrder.id,
            orderNumber: priorOrder.orderNumber,
            checkoutUrl: checkout.session.url,
            sessionId: checkout.session.id,
            completed: checkout.paid,
          },
        };
      }
      return { success: false, message: "Cette tentative de caisse a déjà été traitée." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const billingProfileInclude = {
        billingProfile: {
          select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
        },
      };
      let customer = null;
      if (!isWalkIn) {
        customer = await resolvePointOfSaleCustomer(tx, requestedCustomer, billingProfileInclude);

        // A particulier only gives a name and an e-mail: a ticket follows,
        // never an invoice, so no billing address is asked. It is required
        // only for a customer with a VAT number (typed on this sale or
        // already on file) who has none stored yet — same rule as
        // resolveCounterCustomer. A returning customer never re-enters it; a
        // walk-in sale skips this entirely since it never creates an account.
        const needsAddress = !customer?.addressLine1;
        const hasVatNumber = Boolean(requestedCustomer.vatNumber || customer?.vatNumber);
        const addressSupplied = Boolean(requestedCustomer.addressLine1 && requestedCustomer.addressCity && requestedCustomer.addressPostalCode);
        if (needsAddress && hasVatNumber && !addressSupplied) {
          throw new Error("POS_ADDRESS_REQUIRED");
        }

        const addressData = needsAddress && addressSupplied
          ? {
              addressLine1: requestedCustomer.addressLine1,
              addressLine2: requestedCustomer.addressLine2 || null,
              addressCity: requestedCustomer.addressCity,
              addressPostalCode: requestedCustomer.addressPostalCode,
              addressCountry: requestedCustomer.addressCountry || "BE",
            }
          : {};

        if (!customer) {
          customer = await tx.user.create({
            data: {
              fullName: requestedCustomer.fullName,
              email: requestedCustomer.email,
              phone: requestedCustomer.phone || null,
              password: placeholderPassword,
              role: "CUSTOMER",
              // A receipt is transactional, not marketing consent. The client
              // can verify/create login credentials later through the normal
              // account flow.
              emailVerified: false,
              newsletterSubscribed: false,
              ...addressData,
            },
          });
        } else if (needsAddress && addressSupplied) {
          customer = await tx.user.update({ where: { id: customer.id }, data: addressData });
        }

        // Optional B2B field, shared with the online checkout's own VAT
        // box: format-checked already by the schema, verified against VIES
        // and persisted here — before posVatPolicy is resolved below, so a
        // number entered on THIS sale is what the invoice actually reflects.
        // Works identically for a brand-new till customer and an existing
        // one who never had a VAT number on file; a returning customer's
        // already-validated number is recognised as reusable and skips VIES.
        const vatSave = await saveCheckoutVatNumber(tx, customer, requestedCustomer.vatNumber);
        if (!vatSave.success) {
          throw Object.assign(new Error("POS_VAT_INVALID"), { userMessage: vatSave.message });
        }
        customer = vatSave.user;
      }

      // « Encaisser » from the orders list: claim the unpaid pickup order
      // first (the status/payment guard makes a double submit, or a teammate
      // settling it through the pickup fiche at the same moment, lose
      // cleanly), then hand its held units back so the availability check
      // below counts them as sellable again. Everything rolls back with the
      // sale if anything after this fails.
      let sourceOrder = null;
      if (sourceOrderId) {
        sourceOrder = await tx.order.findUnique({
          where: { id: sourceOrderId },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            fulfilmentMode: true,
            stockReleasedAt: true,
            promoCodeId: true,
            payment: { select: { id: true } },
            items: { select: { variantId: true, quantity: true } },
          },
        });
        if (!canSettleOrderAtPointOfSale(sourceOrder)) throw new Error("POS_SOURCE_ORDER_UNAVAILABLE");
        const claim = await tx.order.updateMany({
          where: {
            id: sourceOrder.id,
            fulfilmentMode: "PICKUP_ON_SITE",
            status: { in: POS_HANDOFF_STATUSES },
            stockReleasedAt: null,
            payment: { is: null },
          },
          // Not a cancellation: the order is sold, as the counter sale created
          // below — linked through settledBySaleId once that sale exists.
          data: { status: "SETTLED_AT_COUNTER" },
        });
        if (claim.count === 0) throw new Error("POS_SOURCE_ORDER_UNAVAILABLE");
        for (const item of sourceOrder.items) {
          if (!item.variantId) continue;
          await tx.productVariant.updateMany({
            where: { id: item.variantId, reservedQuantity: { gte: item.quantity } },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
        // The till sells at shelf price, so the original order's promo code
        // is not carried over — give its use back, as a cancellation would.
        if (sourceOrder.promoCodeId) {
          await tx.promoCode.updateMany({
            where: { id: sourceOrder.promoCodeId, usedCount: { gt: 0 } },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }

      const saleItems = [];
      for (const [variantId, quantity] of groupedItems) {
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
        const variant = await tx.productVariant.findFirst({
          where: {
            id: variantId,
            isActive: true,
            isDeleted: false,
            product: { isDeleted: false, status: "ACTIVE" },
          },
          select: { id: true, name: true, sku: true, price: true, stockQuantity: true, reservedQuantity: true, productId: true, product: { select: { name: true } } },
        });
        if (!variant) throw new Error("POS_PRODUCT_UNAVAILABLE");
        const available = variant.stockQuantity - variant.reservedQuantity;
        if (quantity > available) throw new Error(`POS_STOCK_UNAVAILABLE:${variant.product.name}`);
        saleItems.push({ ...variant, quantity, available });
      }

      const isVatEligible = !isWalkIn && hasInvoiceableVatIdentity(customer);
      // Defaults to true (today's behavior) when omitted — the till only
      // ever sends false when staff/the client explicitly declined it.
      const wantsInvoice = invoiceRequested !== false;
      // A non-privileged staff member (offTill) can never cause an Invoice
      // to be created, regardless of VAT eligibility or customer request —
      // see isTillCashOperator. The sale still completes normally either
      // way; it simply never gets an invoice from this till.
      const shouldCreateInvoice = isVatEligible && wantsInvoice && !offTill;
      const posVatPolicy = resolveGoodsVatPolicy({ customer });
      const pricedSaleItems = saleItems.map((item) => ({
        ...item,
        taxUnitPrice: repriceTtcCataloguePrice(item.price, posVatPolicy.vatRate),
      }));
      const subtotal = pricedSaleItems.reduce((sum, item) => sum + item.taxUnitPrice * item.quantity, 0);
      // Same rules as the online checkout (orders.js): the discount is
      // worked out on the lines as priced for this customer, and only on the
      // targeted products when the code names some. Claimed here, before the
      // order that carries it is created — see claimPromoCodeUse.
      const promo = promoCode
        ? await applyCounterPromoCode(tx, promoCode, subtotal, {
            scope: "BOUTIQUE",
            customerId: customer?.id ?? null,
            lines: pricedSaleItems.map((item) => ({
              key: item.id,
              productId: item.productId,
              unitPrice: item.taxUnitPrice,
              quantity: item.quantity,
              amount: item.taxUnitPrice * item.quantity,
            })),
          })
        : null;
      const discountAmount = promo?.discountAmount ?? 0;
      // A multi-offer code discounts each line by its own offer (by variant id).
      const lineDiscountByVariantId = new Map((promo?.lineDiscounts ?? []).map((line) => [line.key, line]));
      const totalAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
      // Stripe can't open a checkout with nothing to pay.
      if (isQrPayment && totalAmount <= 0) throw new Error("POS_QR_NOTHING_TO_PAY");
      if (method === "CASH" && cashReceived < totalAmount) {
        throw new Error("POS_CASH_INSUFFICIENT");
      }
      const changeGiven = method === "CASH" ? Math.round((cashReceived - totalAmount) * 100) / 100 : null;
      const taxTotals = calculateVatTotals(totalAmount, posVatPolicy.vatRate);
      const order = await tx.order.create({
        data: {
          userId: customer?.id ?? null,
          fulfilmentMode: isQrPayment ? "PICKUP_PREPAID" : "PICKUP_ON_SITE",
          status: isQrPayment ? "PENDING_PAYMENT" : "COMPLETED",
          source: "POS",
          createdByStaffId: guard.session.user.id,
          posAttemptKey: attemptKey,
          subtotal,
          shippingCost: 0,
          discountAmount,
          promoCodeId: promo?.promoCodeId ?? null,
          // A multi-offer code's offers, kept for returns (lib/orders/return-refund.js).
          promoSnapshot: promo?.snapshot ?? undefined,
          totalAmount,
          taxCountryCode: posVatPolicy.taxCountryCode,
          vatTreatment: posVatPolicy.vatTreatment,
          vatRate: posVatPolicy.vatRate,
          totalExclVat: taxTotals.totalExclVat,
          totalVat: taxTotals.vatAmount,
          customerVatNumber: shouldCreateInvoice ? customer?.vatNumber ?? null : null,
          invoiceRequested: isVatEligible ? wantsInvoice : null,
          pickedUpAt: isQrPayment ? null : new Date(),
          pickedUpByStaffId: isQrPayment ? null : guard.session.user.id,
          expiresAt: isQrPayment ? new Date(Date.now() + (POS_CHECKOUT_SECONDS + 4 * 60) * 1000) : null,
          notes: isQrPayment
            ? "Vente en magasin — paiement Stripe QR"
            : sourceOrder
            ? `Vente directe en magasin — reprise de la commande n°${sourceOrder.orderNumber}`
            : isWalkIn
            ? "Vente directe en magasin — client de passage"
            : "Vente directe en magasin",
          items: {
            create: pricedSaleItems.map((item) => ({
                variantId: item.id,
                productName: item.product.name,
                variantName: item.name,
                sku: item.sku,
                unitPrice: item.taxUnitPrice,
                quantity: item.quantity,
                discountAmount: lineDiscountByVariantId.get(item.id)?.discountAmount ?? 0,
                promoLabel: lineDiscountByVariantId.get(item.id)?.label ?? null,
              })),
          },
        },
        include: { items: true },
      });

      if (isQrPayment) {
        for (const item of saleItems) {
          await tx.productVariant.update({
            where: { id: item.id },
            data: { reservedQuantity: { increment: item.quantity } },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId: guard.session.user.id,
            actorRole: guard.session.user.role,
            action: "order.point_of_sale_checkout_created",
            entityType: "Order",
            entityId: order.id,
            after: { status: "PENDING_PAYMENT", totalAmount, paymentMethod: "CARD_QR" },
            metadata: { orderNumber: order.orderNumber, customerId: customer.id, attemptKey },
          },
        });
        return { order, customer, invoice: null, qrPayment: true };
      }

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          totalAmount,
          paidAmount: totalAmount,
          remainingAmount: 0,
          paymentType: "ON_SITE",
          status: "PAID",
          paidAt: new Date(),
        },
      });
      // The outer gate (above, before this transaction opened) is only a
      // fast-path check — with staff on multiple terminals, the session can
      // close in the gap between that read and this write. Re-checked here,
      // inside the transaction, as the authoritative guard: a race that
      // slips past the outer gate must still abort the sale rather than let
      // it complete with cashSessionId silently left null (see
      // requiresCashSession handling in the catch block below).
      // A till operator's POS sale must belong to a session whatever the
      // method (the outer gate already refused otherwise; re-checked here for
      // the close-in-the-race-window case). An off-till cashier's sale never
      // joins the drawer, so the session is neither required nor looked up.
      const openCashSession = offTill
        ? null
        : await tx.cashSession.findFirst({
            where: { closedAt: null },
            orderBy: { openedAt: "desc" }, // matches getCurrentCashSession's tie-break — without it, findFirst's row order is unspecified
            select: { id: true },
          });
      if (!offTill && !openCashSession) throw new Error("POS_CASH_SESSION_CLOSED");
      // Only a till operator's CASH row enters the drawer total and gets a
      // cash-book line number — see model Transaction.pieceNumber and the
      // cash-book queries (lib/cash-book/*).
      const useTill = !offTill && method === "CASH";
      const pieceNumber = useTill ? await allocatePieceNumber(tx, PIECE_SERIES.ORDER) : null;
      await tx.transaction.create({
        data: {
          paymentId: payment.id,
          amount: totalAmount,
          method: method === "CASH" ? "CASH" : "CARD",
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
          // A terminal payment is referenced by the sale's own order number —
          // staff no longer type the terminal ticket's reference at the till.
          manualReference: method === "EXTERNAL_TERMINAL" ? orderTerminalReference(order.orderNumber) : null,
          cashReceived: method === "CASH" ? cashReceived : null,
          changeGiven: method === "CASH" ? changeGiven : null,
          // Only a CASH row taken by a till operator belongs to the till
          // total — see the cash-book queries (lib/cash-book/*), which all
          // filter on method: "CASH" alongside cashSessionId + pieceNumber.
          cashSessionId: useTill ? openCashSession.id : null,
          pieceNumber,
        },
      });

      const ticketNumber = await allocateOrderTicketNumber(tx, order.id, new Date(), offTill);

      // A POS invoice is reserved for a customer whose VAT identity is
      // currently VIES-valid. Everyone else, including particuliers and
      // company-looking accounts without reusable VIES proof, gets only the
      // ticket that is rendered and mailed after the transaction.
      const invoice = !shouldCreateInvoice
        ? null
        : await issueInvoice(tx, {
            paymentId: payment.id,
            source: "ORDER",
            totalInclVat: totalAmount,
            customer: buildInvoiceCustomer(customer),
            lines: orderInvoiceLines(order),
            vatRate: posVatPolicy.vatRate,
            vatTreatment: posVatPolicy.vatTreatment,
            taxCountryCode: posVatPolicy.taxCountryCode,
            taxNote: posVatPolicy.taxNote,
          });

      for (const item of saleItems) {
        const updated = await tx.productVariant.update({
          where: { id: item.id },
          data: { stockQuantity: { decrement: item.quantity } },
          select: { stockQuantity: true },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.id,
            type: "SALE",
            quantity: -item.quantity,
            previousStock: updated.stockQuantity + item.quantity,
            newStock: updated.stockQuantity,
            reason: `Vente en magasin n°${order.orderNumber}`,
            createdById: guard.session.user.id,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: guard.session.user.id,
          actorRole: guard.session.user.role,
          action: "order.point_of_sale_completed",
          entityType: "Order",
          entityId: order.id,
          after: { status: "COMPLETED", totalAmount, paymentMethod: method },
          metadata: {
            orderNumber: order.orderNumber,
            customerId: customer?.id ?? null,
            itemCount: saleItems.length,
            ...(method === "EXTERNAL_TERMINAL" ? { terminalReference: orderTerminalReference(order.orderNumber) } : {}),
            ...(sourceOrder ? { sourceOrderId: sourceOrder.id, sourceOrderNumber: sourceOrder.orderNumber } : {}),
          },
        },
      });

      if (sourceOrder) {
        await tx.order.update({
          where: { id: sourceOrder.id },
          data: { settledBySaleId: order.id },
        });
        await tx.auditLog.create({
          data: {
            actorId: guard.session.user.id,
            actorRole: guard.session.user.role,
            action: "order.settled_at_point_of_sale",
            entityType: "Order",
            entityId: sourceOrder.id,
            before: { status: sourceOrder.status },
            after: { status: "SETTLED_AT_COUNTER", settledBySaleId: order.id, replacedByOrderId: order.id },
            metadata: { orderNumber: sourceOrder.orderNumber, replacedByOrderNumber: order.orderNumber },
          },
        });
      }

      return { order: { ...order, ticketNumber }, invoice, customer };
    // A counter sale does a VIES call, a row-locked stock check, invoice
    // numbering and a per-item stock/audit loop — all sequential DB round
    // trips. Prisma's 5000ms default interactive-transaction timeout was
    // measured failing this exact flow (P2028) well before it could finish,
    // silently rolling back a sale the cashier believed went through. 20s/10s
    // gives real headroom without masking a genuinely stuck transaction.
    }, { timeout: 20000, maxWait: 10000 });

    if (result.qrPayment) {
      const order = await prisma.order.findUnique({
        where: { id: result.order.id },
        include: { items: true, user: { select: { email: true } } },
      });
      const checkout = await createOrRecoverPointOfSaleCheckout(order);
      revalidatePath("/dashboard/boutique/orders");
      return {
        success: true,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          checkoutUrl: checkout.session.url,
          sessionId: checkout.session.id,
          completed: checkout.paid,
        },
      };
    }

    if (isWalkIn) {
      // No identity is registered, so this can never become a nominative
      // Invoice — but the cashier may still have collected an e-mail just to
      // send the same ticket PDF a printer would produce. Optional: most
      // walk-ins still only take the printed ticket.
      const salon = await prisma.salon.findUnique({
        where: { id: "main-salon" },
        select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
      });
      // No ticket number means an independent rang this sale up: it is her
      // sale, under her own VAT number, so the salon issues no ticket for it
      // — see lib/tickets/allocate-ticket-number.js. The e-mail below is
      // already conditional on a PDF existing, so it stops with it.
      const ticketPdf = !result.order.ticketNumber ? null : await renderTicketPdf({
        orderNumber: result.order.orderNumber,
        ticketNumber: result.order.ticketNumber,
        issuedAt: result.order.createdAt,
        sellerName: salon?.legalName || "Meri Beauty",
        sellerAddress: formatSalonAddress(salon),
        sellerVatNumber: salon?.vatNumber ?? null,
        subtotalExclVat: result.order.totalExclVat,
        vatRate: result.order.vatRate,
        vatAmount: result.order.totalVat,
        totalInclVat: result.order.totalAmount,
        lines: orderTicketLines(result.order),
      }).catch((error) => {
        captureError(error, { area: "point-of-sale", orderId: result.order.id, context: "ticket-pdf" });
        return null;
      });

      let ticketEmailSent = null;
      if (walkInEmail && ticketPdf) {
        const ticketEmail = {
          to: walkInEmail,
          subject: `Votre ticket de caisse — Commande n°${result.order.orderNumber} — Meri Beauty`,
          text: `Bonjour,\n\nMerci pour votre achat en magasin. Votre ticket de caisse pour la commande n°${result.order.orderNumber} (${Number(result.order.totalAmount).toFixed(2)} €) est joint à cet e-mail.\n\nL'équipe Meri Beauty`,
          html: `<p>Bonjour,</p><p>Merci pour votre achat en magasin.</p><p>Votre ticket de caisse pour la commande n°${result.order.orderNumber} (<strong>${Number(result.order.totalAmount).toFixed(2)} €</strong>) est joint à cet e-mail.</p><p>L'équipe Meri Beauty</p>`,
          attachments: [{ filename: `${result.order.ticketNumber}.pdf`, content: ticketPdf }],
        };
        let ticketEmailResult = await sendEmail(ticketEmail).catch(() => null);
        // One immediate retry, same as the nominative receipt below — the
        // sale and the ticket already exist regardless of whether this ever
        // succeeds, so this never blocks or rolls back the payment. The
        // .catch matters: a transport that throws (Mailpit down) would
        // otherwise reach the action's catch-all and report a sale that is
        // already committed as « Impossible d'enregistrer la vente ».
        if (!ticketEmailResult?.success) ticketEmailResult = await sendEmail(ticketEmail).catch(() => null);
        ticketEmailSent = Boolean(ticketEmailResult?.success);
        if (!ticketEmailSent) {
          captureError(new Error(ticketEmailResult?.error || "POS walk-in ticket email failed"), {
            area: "point-of-sale",
            orderId: result.order.id,
            context: "walk-in-ticket-email",
          });
        }
        // Persisted regardless of outcome — posTicketEmailSentAt staying
        // null on a non-null posTicketEmailTo is itself the record of a
        // failed send, checkable later without a Sentry event or a console
        // log still being around. Best-effort: a failure here must not turn
        // an already-completed, already-paid sale into an error response.
        await prisma.order
          .update({
            where: { id: result.order.id },
            data: { posTicketEmailTo: walkInEmail, posTicketEmailSentAt: ticketEmailSent ? new Date() : null },
          })
          .catch((error) => {
            captureError(error, { area: "point-of-sale", orderId: result.order.id, context: "walk-in-ticket-email-tracking" });
          });
      }

      revalidatePath("/dashboard/boutique/orders");
      revalidatePath("/dashboard/boutique/stock");
      if (!offTill && method === "CASH") revalidateCaisseRoutes();
      return {
        success: true,
        data: {
          orderId: result.order.id,
          orderNumber: result.order.orderNumber,
          ticketNumber: result.order.ticketNumber,
          walkIn: true,
          ticketPdfBase64: ticketPdf ? ticketPdf.toString("base64") : null,
          ticketEmailSent,
        },
      };
    }

    // The invoice PDF itself is never auto-e-mailed from the till, even for
    // a valid-VAT customer — only a compact ticket-style receipt goes out
    // automatically here. An owed invoice is still created and numbered
    // above (VAT purposes), staff just review and send it afterward from
    // Opérations: over Peppol for a Belgian company (mandatory — Belgium's
    // 2026 structured e-invoicing mandate — see
    // actions/invoices/send-invoice-peppyrus.js), or by e-mail on demand for
    // anyone else (see actions/invoices/send-invoice-email.js). A private
    // customer who asked for nothing gets the same receipt for a different
    // reason: no invoice was ever created for them.
    const holdsInvoiceForPeppol = Boolean(result.invoice) && isPeppolMandatoryCustomer(result.customer);
    const salon = await prisma.salon.findUnique({
      where: { id: "main-salon" },
      select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
    });
    // Same rule as the walk-in branch: an independent's sale gets no ticket
    // number, so the salon produces no receipt document for it.
    const receiptPdf = !result.order.ticketNumber ? null : await renderTicketPdf({
      orderNumber: result.order.orderNumber,
      ticketNumber: result.order.ticketNumber,
      invoiceNumber: result.invoice?.number ?? null,
      issuedAt: result.order.createdAt,
      sellerName: salon?.legalName || "Meri Beauty",
      sellerAddress: formatSalonAddress(salon),
      sellerVatNumber: salon?.vatNumber ?? null,
      subtotalExclVat: result.order.totalExclVat,
      vatRate: result.order.vatRate,
      vatAmount: result.order.totalVat,
      totalInclVat: result.order.totalAmount,
      lines: orderTicketLines(result.order),
    }).catch((error) => {
      captureError(error, { area: "point-of-sale", orderId: result.order.id, context: "receipt-pdf" });
      return null;
    });

    const pendingInvoiceNote = !result.invoice
      ? ""
      : holdsInvoiceForPeppol
      ? ` Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément via le réseau Peppol, conformément à la réglementation belge.`
      : ` Votre facture officielle (n°${result.invoice.number}) vous sera transmise séparément par e-mail.`;
    const receiptEmail = {
      to: result.customer.email,
      subject: `Votre reçu — Commande n°${result.order.orderNumber} — Meri Beauty`,
      text: `Bonjour ${result.customer.fullName},\n\nMerci pour votre achat en magasin. Votre reçu pour la commande n°${result.order.orderNumber} (${Number(result.order.totalAmount).toFixed(2)} €) est joint à cet e-mail.${pendingInvoiceNote}\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${result.customer.fullName},</p><p>Merci pour votre achat en magasin.</p><p>Votre reçu pour la commande n°${result.order.orderNumber} (<strong>${Number(result.order.totalAmount).toFixed(2)} €</strong>) est joint à cet e-mail.</p>${pendingInvoiceNote ? `<p>${pendingInvoiceNote.trim()}</p>` : ""}<p>L'équipe Meri Beauty</p>`,
      ...(receiptPdf ? { attachments: [{ filename: `${result.order.ticketNumber}.pdf`, content: receiptPdf }] } : {}),
    };
    // This e-mail exists only to deliver that receipt, and its body says so
    // ("est joint à cet e-mail") — sending it with nothing attached for
    // every independent's sale would be a standing lie, so it goes only when
    // there is a document to carry. A render failure keeps its old
    // behaviour: the attempt is still made, and still reported.
    let receiptEmailResult = result.order.ticketNumber ? await sendEmail(receiptEmail).catch(() => null) : null;
    if (result.order.ticketNumber && !receiptEmailResult?.success) receiptEmailResult = await sendEmail(receiptEmail).catch(() => null);
    if (result.order.ticketNumber && !receiptEmailResult?.success) {
      captureError(new Error(receiptEmailResult?.error || "POS receipt email failed"), {
        area: "point-of-sale",
        orderId: result.order.id,
        context: "receipt-email",
      });
    }

    revalidatePath("/dashboard/boutique/orders");
    revalidatePath("/dashboard/boutique/stock");
    if (!offTill && method === "CASH") revalidateCaisseRoutes();
    return {
      success: true,
      data: {
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        ticketNumber: result.order.ticketNumber,
        documentType: !result.invoice ? "receipt" : holdsInvoiceForPeppol ? "invoice_pending_peppol" : "invoice_pending_manual_send",
        invoiceNumber: result.invoice ? result.invoice.number : null,
        ticketPdfBase64: receiptPdf ? receiptPdf.toString("base64") : null,
        receiptEmailSent: Boolean(receiptEmailResult?.success),
      },
    };
  } catch (error) {
    if (error instanceof CounterPromoCodeError) {
      return { success: false, message: error.message, errors: { promoCode: error.message } };
    }
    if (error.message === "POS_QR_NOTHING_TO_PAY") {
      return { success: false, message: "Le total est à 0 € après le code promo : encaissez en espèces ou au terminal." };
    }
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage };
    }
    if (error.message === "POS_CHECKOUT_RETRY_WINDOW_EXPIRED") {
      return { success: false, message: "Cette tentative QR est trop ancienne. Annulez-la puis recommencez." };
    }
    if (error.message === "POS_SOURCE_ORDER_UNAVAILABLE") {
      return { success: false, message: "La commande reprise n'est plus à encaisser — elle a déjà été réglée, annulée ou remise en vente." };
    }
    if (error.message === "POS_PRODUCT_UNAVAILABLE") return { success: false, message: "Un produit du panier n'est plus disponible." };
    if (typeof error.message === "string" && error.message.startsWith("POS_STOCK_UNAVAILABLE:")) {
      return { success: false, message: `Stock insuffisant pour ${error.message.slice("POS_STOCK_UNAVAILABLE:".length)}.` };
    }
    if (error.message === "POS_CASH_INSUFFICIENT") {
      return { success: false, message: "Le montant reçu est inférieur au total de la vente." };
    }
    if (error.message === "POS_CASH_SESSION_CLOSED") {
      return {
        success: false,
        message: "La session de caisse vient d'être clôturée. Ouvrez-la à nouveau avant d'encaisser.",
        requiresCashSession: true,
      };
    }
    if (error.message === "POS_ADDRESS_REQUIRED") {
      return {
        success: false,
        message: "L'adresse de facturation est obligatoire pour un client avec un numéro de TVA.",
        errors: { addressLine1: "Obligatoire", addressCity: "Obligatoire", addressPostalCode: "Obligatoire" },
      };
    }
    if (error.message === "POS_VAT_INVALID") {
      return { success: false, message: error.userMessage, errors: { vatNumber: error.userMessage } };
    }
    if (error.code === "P2002" && error.meta?.target?.includes?.("posAttemptKey")) {
      const order = await prisma.order.findUnique({
        where: { posAttemptKey: attemptKey },
        include: { items: true, user: { select: { email: true } } },
      });
      if (order?.createdByStaffId === guard.session.user.id) {
        if (order.status === "COMPLETED") {
          return { success: true, data: { orderId: order.id, orderNumber: order.orderNumber, completed: true, alreadyProcessed: true } };
        }
        if (isQrPayment && order.status === "PENDING_PAYMENT") {
          const checkout = await createOrRecoverPointOfSaleCheckout(order);
          return {
            success: true,
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              checkoutUrl: checkout.session.url,
              sessionId: checkout.session.id,
              completed: checkout.paid,
            },
          };
        }
      }
    }
    if (error.code === "P2002") {
      const target = String(error.meta?.target ?? "").toLowerCase();
      if (target.includes("email")) {
        return { success: false, message: "Cette adresse e-mail appartient déjà à un compte. Recherchez ce client puis réessayez." };
      }
      if (target.includes("phone")) {
        return { success: false, message: "Ce numéro de téléphone appartient déjà à un autre compte." };
      }
      return { success: false, message: "Ce client vient d'être créé. Recherchez-le puis réessayez." };
    }
    console.error("[completePointOfSaleSale]", error);
    captureError(error, { area: "point-of-sale" });
    return { success: false, message: "Impossible d'enregistrer la vente." };
  }
}

function canAccessPosOrder(order, session) {
  return isAdminRole(session.user.role) || order.createdByStaffId === session.user.id;
}

/** Cheap authenticated status probe used only while the staff QR modal is open. */
export async function getPointOfSaleOrderStatus(orderId) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!orderId || typeof orderId !== "string") return { success: false, message: "Commande invalide." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, source: true, status: true, createdByStaffId: true },
  });
  if (!order || order.source !== "POS" || !canAccessPosOrder(order, guard.session)) {
    return { success: false, message: "Commande introuvable." };
  }
  return { success: true, status: order.status };
}

/** Reopens an in-progress QR after refresh without creating another order. */
export async function recoverPointOfSaleCheckout(attemptKey) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!attemptKey || typeof attemptKey !== "string") return { success: false, message: "Tentative invalide." };

  const order = await prisma.order.findUnique({
    where: { posAttemptKey: attemptKey },
    include: { items: true, user: { select: { email: true } } },
  });
  if (!order || order.source !== "POS" || !canAccessPosOrder(order, guard.session)) {
    return { success: false, notFound: true };
  }
  if (order.status === "COMPLETED") {
    return { success: true, data: { orderId: order.id, orderNumber: order.orderNumber, completed: true } };
  }
  if (order.status !== "PENDING_PAYMENT") {
    return { success: false, terminal: true, status: order.status };
  }

  let checkout;
  try {
    checkout = await createOrRecoverPointOfSaleCheckout(order);
  } catch (error) {
    if (error.message === "POS_CHECKOUT_RETRY_WINDOW_EXPIRED") {
      return { success: false, terminal: true, status: "EXPIRED" };
    }
    console.error("[recoverPointOfSaleCheckout]", error);
    return { success: false, message: "Impossible de récupérer le paiement QR." };
  }
  return {
    success: true,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      checkoutUrl: checkout.session.url,
      sessionId: checkout.session.id,
      totalAmount: Number(order.totalAmount),
      completed: checkout.paid,
    },
  };
}

/** Cancels an unpaid POS QR and makes both the Stripe URL and stock hold inert. */
export async function cancelPointOfSaleCheckout(orderId) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order || order.source !== "POS" || !canAccessPosOrder(order, guard.session)) {
    return { success: false, message: "Commande introuvable." };
  }
  if (order.status === "COMPLETED") return { success: false, paid: true, message: "Le paiement est déjà confirmé." };
  if (order.status !== "PENDING_PAYMENT") return { success: true, message: "Cette tentative est déjà clôturée." };

  if (order.stripeCheckoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
    if (session.payment_status === "paid") {
      await fulfillOrderPayment(session);
      return { success: false, paid: true, message: "Le paiement vient d'être confirmé." };
    }
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  }

  const cancelled = await prisma.$transaction(async (tx) => {
    const claim = await tx.order.updateMany({
      where: { id: order.id, source: "POS", status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Paiement QR annulé à la caisse" },
    });
    if (claim.count === 0) return false;
    for (const item of order.items) {
      // POS ad-hoc service lines (variantId null) carry no stock to adjust.
      if (!item.variantId) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: guard.session.user.id,
        actorRole: guard.session.user.role,
        action: "order.point_of_sale_checkout_cancelled",
        entityType: "Order",
        entityId: order.id,
        before: { status: "PENDING_PAYMENT" },
        after: { status: "CANCELLED" },
      },
    });
    return true;
  });

  revalidatePath("/dashboard/boutique/orders");
  revalidatePath("/dashboard/boutique/stock");
  return cancelled
    ? { success: true, message: "Paiement QR annulé." }
    : { success: false, message: "La commande a changé d'état. Actualisez la page." };
}
