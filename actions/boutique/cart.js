"use server";

import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { addToCartSchema, updateCartItemSchema } from "@/lib/validations/commerce";

/**
 * Guest-friendly cart, identified by a random token in an httpOnly cookie —
 * a browsing session has a cart before the customer is known. Once a
 * CUSTOMER session exists, the cart is attached to that userId so it
 * survives login on the same browser. Merging a guest cart into an
 * already-existing cart for the same user on another device is deliberately
 * not handled yet — no storefront exists to hit that case.
 */

const CART_COOKIE = "boutique_cart_token";
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function currentCustomerId() {
  const session = await auth();
  return session?.user?.role === "CUSTOMER" ? session.user.id : null;
}

/**
 * The cart cookie survives sign-out/sign-in on the same browser, so a cart
 * already claimed by one customer (cart.userId set) must not be readable or
 * writable by anyone else who later shows up with that same cookie — a
 * different customer, a signed-out guest, or a STAFF/OWNER/ADMIN account
 * testing the storefront. An unclaimed cart (userId still null) is fair game
 * for anyone, since that's the normal pre-login guest-cart state.
 */
function cartBelongsToSession(cart, currentUserId) {
  return !cart.userId || cart.userId === currentUserId;
}

async function readOrIssueCartToken() {
  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return existing;

  const token = randomUUID();
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CART_COOKIE_MAX_AGE,
    path: "/",
  });
  return token;
}

async function reissueCartToken() {
  const jar = await cookies();
  const token = randomUUID();
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CART_COOKIE_MAX_AGE,
    path: "/",
  });
  return token;
}

/**
 * Resolves the active cart for this browser, creating one if needed. A cart
 * that already converted to an Order is history, not a checkout target — a
 * fresh one (with a fresh token) is started transparently.
 */
export async function getOrCreateActiveCart() {
  const userId = await currentCustomerId();
  let token = await readOrIssueCartToken();

  let cart = await prisma.cart.findUnique({ where: { token } });

  if (cart && (cart.status !== "ACTIVE" || !cartBelongsToSession(cart, userId))) {
    token = await reissueCartToken();
    cart = null;
  }

  if (!cart) {
    cart = await prisma.cart.create({ data: { token, userId, status: "ACTIVE" } });
  } else if (userId && cart.userId !== userId) {
    cart = await prisma.cart.update({ where: { id: cart.id }, data: { userId } });
  }

  return cart;
}

function serializeCart(cart) {
  const items = cart.items.map((item) => ({
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    variant: {
      id: item.variant.id,
      name: item.variant.name,
      sku: item.variant.sku,
      price: Number(item.variant.price),
      comparePrice: item.variant.comparePrice != null ? Number(item.variant.comparePrice) : null,
      stockQuantity: item.variant.stockQuantity,
      reservedQuantity: item.variant.reservedQuantity,
      isActive: item.variant.isActive,
      isDeleted: item.variant.isDeleted,
      product: {
        id: item.variant.product.id,
        name: item.variant.product.name,
        slug: item.variant.product.slug,
        image: item.variant.product.images[0]?.path ?? null,
      },
    },
  }));

  const subtotal = items.reduce((sum, item) => sum + item.variant.price * item.quantity, 0);

  return {
    id: cart.id,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    items,
  };
}

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              images: { where: { isPrimary: true }, take: 1, select: { path: true } },
            },
          },
        },
      },
    },
  },
};

const EMPTY_CART = { id: null, itemCount: 0, subtotal: 0, items: [] };

/**
 * Read-only: never issues a cart cookie or creates a Cart row. Safe to call
 * from Server Component renders (page.jsx, layout.js), unlike
 * getOrCreateActiveCart() — cookies().set() is only legal inside a Server
 * Action or Route Handler, so cart *creation* only ever happens the moment
 * addToCart() actually runs (a real Server Action call from a click). Until
 * then, a browser with no cart cookie simply has an empty cart.
 */
export async function getCart() {
  try {
    const jar = await cookies();
    const token = jar.get(CART_COOKIE)?.value;
    if (!token) return { success: true, data: EMPTY_CART };

    const cart = await prisma.cart.findUnique({ where: { token }, include: cartInclude });
    if (!cart || cart.status !== "ACTIVE") return { success: true, data: EMPTY_CART };
    if (!cartBelongsToSession(cart, await currentCustomerId())) return { success: true, data: EMPTY_CART };

    return { success: true, data: serializeCart(cart) };
  } catch (error) {
    console.error("[getCart]", error);
    return { success: false, message: "Impossible de charger le panier.", data: EMPTY_CART };
  }
}

/** Adds a variant to the cart, or increases quantity if already present. */
export async function addToCart(input) {
  const parsed = addToCartSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.quantity?.[0] ?? errors.variantId?.[0] ?? "Données invalides." };
  }
  const { variantId, quantity } = parsed.data;

  try {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId, isDeleted: false, isActive: true },
      select: { id: true, stockQuantity: true, reservedQuantity: true },
    });
    if (!variant) return { success: false, message: "Ce produit n'est plus disponible." };

    const cart = await getOrCreateActiveCart();
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });

    const desiredQuantity = (existing?.quantity ?? 0) + quantity;
    const available = variant.stockQuantity - variant.reservedQuantity;
    if (desiredQuantity > available) {
      return {
        success: false,
        message: available > 0
          ? `Il ne reste que ${available} unité(s) en stock.`
          : "Ce produit est en rupture de stock.",
      };
    }

    if (existing) {
      await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: desiredQuantity } });
    } else {
      await prisma.cartItem.create({ data: { cartId: cart.id, variantId, quantity: desiredQuantity } });
    }

    return { success: true, message: "Produit ajouté au panier." };
  } catch (error) {
    console.error("[addToCart]", error);
    return { success: false, message: "Impossible d'ajouter ce produit au panier." };
  }
}

/** Sets an item's quantity; 0 removes it. */
export async function updateCartItemQuantity(input) {
  const parsed = updateCartItemSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.quantity?.[0] ?? errors.cartItemId?.[0] ?? "Données invalides." };
  }
  const { cartItemId, quantity } = parsed.data;

  try {
    const cart = await getOrCreateActiveCart();
    const item = await prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { variant: { select: { stockQuantity: true, reservedQuantity: true } } },
    });
    if (!item || item.cartId !== cart.id) return { success: false, message: "Article introuvable." };

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: cartItemId } });
      return { success: true, message: "Article retiré du panier." };
    }

    const available = item.variant.stockQuantity - item.variant.reservedQuantity;
    if (quantity > available) {
      return {
        success: false,
        message: available > 0
          ? `Il ne reste que ${available} unité(s) en stock.`
          : "Ce produit est en rupture de stock.",
      };
    }

    await prisma.cartItem.update({ where: { id: cartItemId }, data: { quantity } });
    return { success: true, message: "Quantité mise à jour." };
  } catch (error) {
    console.error("[updateCartItemQuantity]", error);
    return { success: false, message: "Impossible de mettre à jour la quantité." };
  }
}

export async function removeFromCart(cartItemId) {
  if (!cartItemId) return { success: false, message: "Identifiant manquant." };

  try {
    const cart = await getOrCreateActiveCart();
    const item = await prisma.cartItem.findUnique({ where: { id: cartItemId } });
    if (!item || item.cartId !== cart.id) return { success: false, message: "Article introuvable." };

    await prisma.cartItem.delete({ where: { id: cartItemId } });
    return { success: true, message: "Article retiré du panier." };
  } catch (error) {
    console.error("[removeFromCart]", error);
    return { success: false, message: "Impossible de retirer cet article." };
  }
}
