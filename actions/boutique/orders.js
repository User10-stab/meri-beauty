"use server";

import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { qrPngAttachment } from "@/lib/qrcode";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { isCheckoutAuthorized, createResumeCheckoutToken } from "@/lib/resume-checkout-token";
import { sendEmail } from "@/lib/email";
import { ROLES, STAFF_PERMISSIONS, hasDashboardPermission, isAdminRole } from "@/lib/authorization";
import { checkoutSchema, shipOrderSchema, cancelOrderSchema, closeShippedOrderSchema } from "@/lib/validations/commerce";
import { getOrCreateActiveCart } from "@/actions/boutique/cart";
import { issueInvoice, issueCreditNote, buildInvoiceCustomer, isSellerLegalDataComplete } from "@/lib/invoicing";
import { renderInvoicePdf, renderCreditNotePdf } from "@/lib/pdf/render";
import { calculateShippingCost, calculateTotalWeight } from "@/lib/shipping";
import { sendCheckoutVerificationEmail } from "@/actions/shared/send-checkout-verification-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { resolvePromoCode } from "@/lib/promo-codes";
import { fulfillOrderPayment, orderInvoiceLines } from "@/lib/orders/fulfill-order-payment";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import { buildTermsAcceptanceUpdate, recordTermsAcceptance } from "@/lib/terms-consent";
import { MONDIAL_RELAY_TRACKING_URL } from "@/lib/mondial-relay-tracking";
import { captureError, captureWarning } from "@/lib/monitoring";
import { calculateVatTotals, applyVatRate, repriceTtcCataloguePrice, resolveGoodsVatPolicy } from "@/lib/tax-policy";
import { saveCheckoutVatNumber } from "@/lib/customer-vat";
import {
  buildOrderCreatedNotification,
  createNotificationsBulk,
  getSalonAdminNotificationRecipients,
} from "@/lib/notifications";
import {
  getOrderPaymentMethod,
  isManualOrderRefund,
  manualRefundInstruction,
  refundMethodLabel,
  validateManualRefundConfirmation,
} from "@/lib/payments/refund-method";

/**
 * Checkout + order fulfilment.
 *
 * Unlike the appointment flow (nothing exists in the DB until the Stripe
 * webhook fires), an Order is created — and stock reserved — the moment
 * checkout starts, before Stripe is ever involved. Reservation has to exist
 * during the payment window or two customers could both "buy" the last
 * unit while the first one is still on the Stripe page.
 *
 * Stock lifecycle:
 *  - Checkout time: reservedQuantity += qty (a hold, stockQuantity untouched).
 *  - Payment confirmed (prepaid) or pickup+payment collected (pay-on-site):
 *    the hold becomes a real sale — write a SALE InventoryMovement
 *    (stockQuantity -= qty) and release the same amount from
 *    reservedQuantity in the same transaction.
 *  - Cancelled/expired before that point: reservedQuantity -= qty, nothing
 *    else — stock was never actually removed.
 *  - Cancelled after that point (a paid order refunded): a RETURN
 *    InventoryMovement puts the stock back.
 */

const BCRYPT_SALT_ROUNDS = 12;

const PENDING_PAYMENT_EXPIRY_MINUTES = 30;
const PENDING_PICKUP_EXPIRY_DAYS = 7;

// New-hold creation only, for unverified guests — caps how many orders one
// IP can spin up against unproven emails. The existing "supersede the same
// cart's abandoned attempt" logic below already stops a single cart from
// stacking holds; this catches the many-different-fake-emails case that
// doesn't go through.
const GUEST_HOLD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const GUEST_HOLD_RATE_LIMIT_MAX = 5;

// ─── Guards ───────────────────────────────────────────────────────────────────

async function requireOrdersAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.ORDERS))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generatePickupCode() {
  return randomBytes(4).toString("hex").toUpperCase(); // e.g. "A3F9C1B2"
}

async function uniquePickupCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePickupCode();
    const clash = await prisma.order.findUnique({ where: { pickupCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error("PICKUP_CODE_EXHAUSTED");
}

/**
 * Mirrors createReservation's customer resolution — guest checkout creates
 * an account. `authenticatedUserId` comes from the server-side session,
 * never from client-supplied customerInfo — otherwise any logged-in
 * customer could pass a victim's id and have the order attached to their
 * account (IDOR).
 *
 * A brand-new account starts unverified (emailVerified defaults to false,
 * not forced true here as before) — createOrderFromCart gates on that to
 * require email confirmation before Stripe, rather than trusting an
 * unproven address outright.
 */
async function resolveOrCreateCustomer(customerInfo, authenticatedUserId) {
  // Only required once we know the resolved/about-to-be-created user doesn't
  // already have an address on file — a returning guest shouldn't have to
  // resubmit it. Mirrors completePointOfSaleSale's needsAddress gate.
  const suppliedAddress = customerInfo.addressLine1 && customerInfo.addressCity && customerInfo.addressPostalCode
    ? {
        addressLine1: customerInfo.addressLine1,
        addressLine2: customerInfo.addressLine2 || null,
        addressCity: customerInfo.addressCity,
        addressPostalCode: customerInfo.addressPostalCode,
        addressCountry: customerInfo.addressCountry || "BE",
      }
    : null;

  if (authenticatedUserId) {
    const user = await prisma.user.findUnique({ where: { id: authenticatedUserId, isDeleted: false } });
    if (user) {
      // Same rule as a guest: an account reaching checkout with no address on
      // file (pre-dates the mandatory-address rule, or was never completed in
      // /mon-compte) must not be allowed to pay for something that can never
      // be invoiced. issueInvoice's assertBuyerLegalDataComplete would refuse
      // it anyway — this stops it before Stripe is charged rather than after,
      // which is what left order cmtbaqxua0003gczkbigl9x23 paid-but-stuck.
      if (!user.addressLine1) {
        if (!suppliedAddress) throw new Error("ADDRESS_REQUIRED");
        const updated = await prisma.user.update({ where: { id: user.id }, data: suppliedAddress });
        return { user: updated, isNewUser: false, temporaryPassword: null };
      }
      return { user, isNewUser: false, temporaryPassword: null };
    }
  }

  const email = customerInfo.email.trim().toLowerCase();
  const phone = customerInfo.phone?.trim();

  // The email is the identity the buyer actually typed, so it alone decides
  // which account this is. Treating phone as an equal alternative here handed
  // back whichever account owned the number and silently dropped the address
  // they entered: the order was attached to that other account and the
  // confirmation mail went to its owner, while the "check your inbox" screen
  // quoted an address the buyer had never seen and could not open.
  const existing = await prisma.user.findFirst({ where: { email, isDeleted: false } });
  if (existing) {
    if (!existing.addressLine1) {
      if (!suppliedAddress) throw new Error("ADDRESS_REQUIRED");
      const updated = await prisma.user.update({ where: { id: existing.id }, data: suppliedAddress });
      return { user: updated, isNewUser: false, temporaryPassword: null };
    }
    return { user: existing, isNewUser: false, temporaryPassword: null };
  }

  // New email, but the number is already on a different account. Refuse rather
  // than merge — the active-only unique index on phone (user_active_phone_idx)
  // would reject the create below anyway, and saying so beats surfacing a
  // P2002 as the generic "Impossible de créer la commande."
  if (phone) {
    const phoneOwner = await prisma.user.findFirst({
      where: { phone, isDeleted: false },
      select: { id: true },
    });
    if (phoneOwner) throw new Error("PHONE_ALREADY_REGISTERED");
  }

  // Brand-new account — mandatory-address rule applies the same as normal
  // registration (lib/validations/register.js), since this is the moment
  // the account is created.
  if (!suppliedAddress) throw new Error("ADDRESS_REQUIRED");

  // Throwaway placeholder — never shown to anyone. The real, usable
  // password is generated once the email is confirmed (see
  // actions/shared/resume-checkout-after-verification.js).
  const placeholderHash = await bcrypt.hash(randomBytes(9).toString("base64url"), BCRYPT_SALT_ROUNDS);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        fullName: customerInfo.fullName.trim(),
        email,
        phone,
        password: placeholderHash,
        role: "CUSTOMER",
        isActive: true,
        ...suppliedAddress,
        ...buildNewsletterConsentUpdate(customerInfo.newsletterSubscribed ?? false, "boutique_checkout"),
        // Guest checkout creates the account, so this is the moment consent is
        // given — it used to be recorded at signup only, which meant a guest who
        // never registered left no record at all.
        ...buildTermsAcceptanceUpdate(),
      },
    });
  } catch (error) {
    // Two concurrent first-time checkouts can both clear the lookups above and
    // then race this insert; the active-only unique indexes let exactly one
    // win. Re-read the winner when it's the same email (same person, double
    // submit), and report the number as taken when it isn't.
    if (error.code !== "P2002") throw error;

    const conflict = await prisma.user.findFirst({ where: { email, isDeleted: false } });
    if (!conflict) throw new Error("PHONE_ALREADY_REGISTERED");
    return { user: conflict, isNewUser: false, temporaryPassword: null };
  }

  return { user, isNewUser: true, temporaryPassword: null };
}

function serializeOrder(order) {
  const paymentMethod = getOrderPaymentMethod(order.payment);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    fulfilmentMode: order.fulfilmentMode,
    status: order.status,
    subtotal: Number(order.subtotal),
    shippingCost: Number(order.shippingCost),
    totalAmount: Number(order.totalAmount),
    taxCountryCode: order.taxCountryCode,
    vatTreatment: order.vatTreatment,
    vatRate: Number(order.vatRate),
    totalExclVat: order.totalExclVat == null ? null : Number(order.totalExclVat),
    totalVat: order.totalVat == null ? null : Number(order.totalVat),
    shippingCarrier: order.shippingCarrier,
    pickupPointId: order.pickupPointId,
    pickupPointName: order.pickupPointName,
    pickupPointAddress: order.pickupPointAddress,
    pickupPointPostalCode: order.pickupPointPostalCode,
    pickupPointCity: order.pickupPointCity,
    trackingCode: order.trackingCode,
    shippedAt: order.shippedAt,
    collectedAt: order.collectedAt,
    pickupCode: order.pickupCode,
    pickedUpAt: order.pickedUpAt,
    expiresAt: order.expiresAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    notes: order.notes,
    posTicketEmailTo: order.posTicketEmailTo,
    posTicketEmailSentAt: order.posTicketEmailSentAt,
    createdAt: order.createdAt,
    user: order.user
      ? { id: order.user.id, fullName: order.user.fullName, email: order.user.email, phone: order.user.phone }
      : null,
    hasPayment: Boolean(order.payment),
    payment: order.payment
      ? {
          status: order.payment.status,
          paymentMethod,
          paymentMethodLabel: refundMethodLabel(paymentMethod),
          requiresManualRefund: isManualOrderRefund(order.payment),
          refundInstruction: manualRefundInstruction(paymentMethod),
        }
      : null,
    invoice: order.payment?.invoice
      ? { id: order.payment.invoice.id, number: order.payment.invoice.number, issuedAt: order.payment.invoice.issuedAt }
      : null,
    creditNotes: (order.payment?.invoice?.creditNotes ?? []).map((cn) => ({
      id: cn.id,
      number: cn.number,
      issuedAt: cn.issuedAt,
      totalInclVat: Number(cn.totalInclVat),
    })),
    returnRequests: (order.returnRequests ?? []).map((rr) => ({
      id: rr.id,
      status: rr.status,
      requestedAt: rr.requestedAt,
      itemCount: (rr.items ?? []).reduce((sum, i) => sum + i.quantity, 0),
    })),
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
    })),
  };
}

function pendingOrderMatchesCart(order, cart) {
  if (!order || order.items.length !== cart.items.length) return false;
  const quantities = new Map(order.items.map((item) => [item.variantId, item.quantity]));
  return cart.items.every((item) => quantities.get(item.variantId) === item.quantity);
}

/**
 * Makes an old Stripe Checkout Session impossible to pay before its local
 * stock hold is released. A paid session is returned for idempotent
 * fulfilment; an unverifiable or concurrently-completing session blocks the
 * retry instead of risking a paid-but-cancelled order.
 */
async function preparePendingStripeSessionForRetry(order) {
  if (!order.stripeCheckoutSessionId) return { safeToCancel: true, paidSession: null };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
  } catch (error) {
    console.error("[createOrderFromCart] Unable to verify prior Stripe session:", error);
    return {
      safeToCancel: false,
      paidSession: null,
      message: "Impossible de vérifier la tentative de paiement précédente. Veuillez réessayer dans quelques instants.",
    };
  }

  if (session.payment_status === "paid") {
    return { safeToCancel: false, paidSession: session };
  }
  if (session.status === "complete") {
    return {
      safeToCancel: false,
      paidSession: null,
      message: "Votre paiement précédent est en cours de confirmation. Veuillez patienter quelques instants.",
    };
  }
  if (session.status === "expired") {
    return { safeToCancel: true, paidSession: null };
  }
  if (session.status !== "open") {
    return {
      safeToCancel: false,
      paidSession: null,
      message: "La tentative de paiement précédente est encore en cours. Veuillez réessayer dans quelques instants.",
    };
  }

  try {
    await stripe.checkout.sessions.expire(session.id);
    return { safeToCancel: true, paidSession: null };
  } catch (error) {
    // Expiry can lose a race with a payment completing. Re-read once: paid is
    // fulfilled; every other ambiguous state remains blocked and keeps its
    // stock hold intact.
    console.error("[createOrderFromCart] Unable to expire prior Stripe session:", error);
    try {
      const latest = await stripe.checkout.sessions.retrieve(session.id);
      if (latest.payment_status === "paid") {
        return { safeToCancel: false, paidSession: latest };
      }
    } catch (refreshError) {
      console.error("[createOrderFromCart] Unable to refresh prior Stripe session:", refreshError);
    }
    return {
      safeToCancel: false,
      paidSession: null,
      message: "La tentative de paiement précédente n'a pas pu être fermée. Veuillez réessayer dans quelques instants.",
    };
  }
}

/** Releases exactly one pending order's hold, serialized by its cart row. */
async function cancelPendingOrderForRetry(order) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${order.cartId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;

    const current = await tx.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    if (!current || current.status !== "PENDING_PAYMENT") return false;

    await tx.order.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: "Remplacée par une nouvelle tentative de paiement",
      },
    });

    for (const item of current.items) {
      const released = await tx.productVariant.updateMany({
        where: { id: item.variantId, reservedQuantity: { gte: item.quantity } },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
      if (released.count !== 1) throw new Error("ORDER_HOLD_INCONSISTENT");
    }

    return true;
  });
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

/**
 * Turns the current cart into an Order and reserves stock. For prepaid
 * modes this returns requiresPayment: true — the caller must then call
 * createOrderCheckoutSession(orderId) to get the Stripe redirect URL.
 */
export async function createOrderFromCart(input) {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    // Nested object fields (customerInfo.email, etc.) bucket under the
    // parent key in Zod's flatten() output, not a dotted "customerInfo.email"
    // key — checking for the dotted key here always missed the real message.
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message:
        errors.termsAccepted?.[0] ??
        errors.fulfilmentMode?.[0] ??
        errors.pickupPoint?.[0] ??
        errors.customerInfo?.[0] ??
        "Données invalides.",
    };
  }
  const { fulfilmentMode, customerInfo, pickupPoint, notes, promoCode } = parsed.data;

  try {
    const authSession = await auth();
    const cart = await getOrCreateActiveCart();
    const fullCart = await prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          include: { variant: { include: { product: { select: { name: true } } } } },
        },
      },
    });

    if (!fullCart || fullCart.items.length === 0) {
      return { success: false, message: "Votre panier est vide." };
    }

    let { user } = await resolveOrCreateCustomer(customerInfo, authSession?.user?.id);
    const vatSave = await saveCheckoutVatNumber(prisma, user, customerInfo.vatNumber);
    if (!vatSave.success) return vatSave;
    user = vatSave.user;
    // Returning customer, or an account created before consent was tracked:
    // record that they accepted the current CGV at this order.
    await recordTermsAcceptance(prisma, user.id);

    // A customer who abandoned a prepaid checkout and comes back to retry
    // (closed the Stripe tab, card declined, etc.) hits this same cart again
    // before their first attempt's 30-minute hold expires - without this,
    // the retry would reserve the same stock a second time on top of the
    // still-live first reservation, self-inflicting a false "out of stock"
    // against their own abandoned order. Silently supersede it: release its
    // hold (no email - this isn't a customer-visible cancellation, it's an
    // implementation detail of retrying the same purchase). Before releasing
    // anything, expire an open Stripe Session so the old tab can no longer be
    // paid. A same-cart unverified order that has not reached Stripe is reused
    // below instead, including its existing hold.
    const pendingOrder = await prisma.order.findFirst({
      where: { cartId: fullCart.id, userId: user.id, status: "PENDING_PAYMENT" },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    const reuseUnverifiedOrder = Boolean(
      pendingOrder &&
      !user.emailVerified &&
      !pendingOrder.stripeCheckoutSessionId &&
      pendingOrderMatchesCart(pendingOrder, fullCart)
    );
    const preflightHeldQuantityCredit = new Map(
      reuseUnverifiedOrder ? pendingOrder.items.map((item) => [item.variantId, item.quantity]) : []
    );

    if (pendingOrder && !reuseUnverifiedOrder) {
      const priorAttempt = await preparePendingStripeSessionForRetry(pendingOrder);
      if (priorAttempt.paidSession) {
        // fulfillOrderPayment is idempotent, including when the webhook is
        // already finalizing this same session concurrently.
        await fulfillOrderPayment(priorAttempt.paidSession);
        return {
          success: false,
          message: "Un paiement pour ce panier a déjà été confirmé. Consultez vos commandes — la confirmation arrive sous peu.",
        };
      }
      if (!priorAttempt.safeToCancel) {
        return { success: false, message: priorAttempt.message };
      }

      const cancelled = await cancelPendingOrderForRetry(pendingOrder);
      if (!cancelled) {
        return {
          success: false,
          message: "La tentative de paiement précédente vient de changer d'état. Actualisez la page avant de réessayer.",
        };
      }

      // fullCart was loaded before the transaction released this reservation,
      // so its variant.reservedQuantity snapshot still includes those units.
      // Credit only the hold we have just released during this preflight; the
      // locked reservation transaction below reads the fresh database values.
      for (const item of pendingOrder.items) {
        preflightHeldQuantityCredit.set(item.variantId, item.quantity);
      }
    }

    for (const item of fullCart.items) {
      if (item.variant.isDeleted || !item.variant.isActive) {
        return { success: false, message: `"${item.variant.product.name}" n'est plus disponible — retirez-le du panier.` };
      }
      // An unverified retry reuses its existing order below. Add only that
      // order's own hold back for this preflight check so it cannot report its
      // own reserved units as falsely out of stock.
      const available =
        item.variant.stockQuantity -
        item.variant.reservedQuantity +
        (preflightHeldQuantityCredit.get(item.variantId) ?? 0);
      if (item.quantity > available) {
        return {
          success: false,
          message: `Stock insuffisant pour "${item.variant.product.name}" (${available} disponible(s)).`,
        };
      }
    }

    const clientIp = user.emailVerified ? null : await getClientIp();
    if (clientIp && isRateLimited("guest-checkout-hold", clientIp, { windowMs: GUEST_HOLD_RATE_LIMIT_WINDOW_MS, max: GUEST_HOLD_RATE_LIMIT_MAX })) {
      return { success: false, message: "Trop de tentatives. Veuillez réessayer dans quelques minutes." };
    }

    const destinationCountry = fulfilmentMode === "SHIPPING_PREPAID" ? pickupPoint?.countryCode ?? "BE" : "BE";
    const taxPolicy = resolveGoodsVatPolicy({
      fulfilmentMode,
      destinationCountry,
      customer: user,
    });
    const pricedItems = fullCart.items.map((item) => ({
      ...item,
      taxUnitPrice: repriceTtcCataloguePrice(item.variant.price, taxPolicy.vatRate),
    }));
    const subtotal = pricedItems.reduce((sum, item) => sum + item.taxUnitPrice * item.quantity, 0);

    // Calculate shipping based on total weight (Marie's requirement)
    let shippingCost = 0;
    if (fulfilmentMode === "SHIPPING_PREPAID") {
      const totalWeight = calculateTotalWeight(fullCart.items);
      shippingCost = calculateShippingCost(totalWeight, subtotal);

      // Handle >30kg orders that require manual shipping quote
      if (shippingCost === "QUOTE_REQUIRED") {
        return {
          success: false,
          message: "Votre commande dépasse 30 kg. Merci de nous contacter pour un devis de livraison personnalisé."
        };
      }
      shippingCost = applyVatRate(shippingCost, taxPolicy.vatRate);
    }

    // Re-validated here regardless of the client's live preview — a code
    // could have been deactivated between preview and submit, and the
    // discount amount is never trusted from the client.
    let promoCodeId = null;
    let discountAmount = 0;
    let promoMaxUses = null;
    if (promoCode) {
      const promoResult = await resolvePromoCode(promoCode, subtotal);
      if (!promoResult.success) return { success: false, message: promoResult.message };
      promoCodeId = promoResult.promoCodeId;
      discountAmount = promoResult.discountAmount;
      promoMaxUses = promoResult.maxUses;
    }

    const totalAmount = Math.max(0, subtotal + shippingCost - discountAmount);
    const taxTotals = calculateVatTotals(totalAmount, taxPolicy.vatRate);

    const isOnSite = fulfilmentMode === "PICKUP_ON_SITE";
    const pickupCode = fulfilmentMode !== "SHIPPING_PREPAID" ? await uniquePickupCode() : null;
    const expiresAt = isOnSite
      ? new Date(Date.now() + PENDING_PICKUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + PENDING_PAYMENT_EXPIRY_MINUTES * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      // Locks the cart row for the rest of this transaction — an unverified
      // guest submitting the same cart twice in close succession (a slow
      // response followed by an impatient retry) would otherwise have both
      // requests pass the checks above before either commits, each creating
      // its own order, pickup code, and confirmation email for what's really
      // one purchase. The second request now waits here, then finds and
      // reuses the first one instead of also creating a duplicate.
      await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${fullCart.id} FOR UPDATE`;

      if (!user.emailVerified) {
        const existing = await tx.order.findFirst({
          where: {
            cartId: fullCart.id,
            userId: user.id,
            status: { in: ["PENDING_PAYMENT", "PENDING_PICKUP"] },
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
        });
        if (existing) return existing;

        // Only a genuinely new hold counts against the rate limit — reusing
        // a live one above doesn't lock any additional stock.
        recordRateLimitHit("guest-checkout-hold", clientIp);
      }

      for (const item of fullCart.items) {
        // Lock the variant row before reading it — without this, two
        // concurrent checkouts on the same last-unit variant can both read
        // the same "available" snapshot under READ COMMITTED and both pass
        // the check, over-reserving stock (the DB CHECK constraint below is
        // a backstop, not the primary guard). Mirrors the same FOR UPDATE
        // pattern used for workshop/formation session capacity.
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${item.variantId} FOR UPDATE`;

        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stockQuantity: true, reservedQuantity: true },
        });
        const available = variant.stockQuantity - variant.reservedQuantity;
        if (item.quantity > available) throw new Error("STOCK_RACE");

        try {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { increment: item.quantity } },
          });
        } catch (err) {
          if (err.code === "P2004") throw new Error("STOCK_RACE");
          throw err;
        }
      }

      const created = await tx.order.create({
        data: {
          userId: user.id,
          cartId: fullCart.id,
          fulfilmentMode,
          status: isOnSite ? "PENDING_PICKUP" : "PENDING_PAYMENT",
          subtotal,
          shippingCost,
          totalAmount,
          taxCountryCode: taxPolicy.taxCountryCode,
          vatTreatment: taxPolicy.vatTreatment,
          vatRate: taxPolicy.vatRate,
          totalExclVat: taxTotals.totalExclVat,
          totalVat: taxTotals.vatAmount,
          customerVatNumber: taxPolicy.customerVatNumber,
          taxNote: taxPolicy.taxNote,
          promoCodeId,
          discountAmount,
          pickupPointId: pickupPoint?.id ?? null,
          pickupPointName: pickupPoint?.name ?? null,
          pickupPointAddress: pickupPoint?.address ?? null,
          pickupPointPostalCode: pickupPoint?.postalCode ?? null,
          pickupPointCity: pickupPoint?.city ?? null,
          shippingCountry: destinationCountry,
          pickupCode,
          expiresAt,
          notes: notes || null,
          items: {
            create: pricedItems.map((item) => ({
              variantId: item.variantId,
              productName: item.variant.product.name,
              variantName: item.variant.name,
              sku: item.variant.sku,
              unitPrice: item.taxUnitPrice,
              quantity: item.quantity,
            })),
          },
        },
      });

      // Atomic conditional claim — only succeeds while usedCount is still
      // under the cap captured moments ago at resolvePromoCode time. Two
      // concurrent checkouts racing the last use of a capped code can't
      // both win: the loser's WHERE clause matches zero rows.
      if (promoCodeId && promoMaxUses != null) {
        const claim = await tx.promoCode.updateMany({
          where: { id: promoCodeId, usedCount: { lt: promoMaxUses } },
          data: { usedCount: { increment: 1 } },
        });
        if (claim.count === 0) throw new Error("PROMO_EXHAUSTED");
      } else if (promoCodeId) {
        await tx.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } });
      }

      // PICKUP_ON_SITE has no payment step — the order is confirmed right here, so the
      // cart empties immediately, same as any normal checkout. The two prepaid modes
      // still redirect to Stripe after this: the cart deliberately stays ACTIVE until
      // fulfillOrderPayment() confirms the payment actually went through, so a customer
      // who abandons the Stripe page and comes back still finds their cart intact
      // instead of it looking silently cleared.
      if (isOnSite) {
        await tx.cart.update({ where: { id: fullCart.id }, data: { status: "CONVERTED" } });
      }

      const adminIds = await getSalonAdminNotificationRecipients({ tx });
      if (adminIds.length > 0) {
        await createNotificationsBulk(
          adminIds.map((userId) =>
            buildOrderCreatedNotification({
              userId,
              orderId: created.id,
              orderNumber: created.orderNumber,
              customerName: user.fullName,
              totalAmount,
              fulfilmentMode,
            })
          ),
          { tx }
        );
      }

      return created;
    // Cart lock, address/customer resolution, per-item stock decrement and
    // notifications are all sequential DB round trips on the online checkout
    // path — the same shape proven to exceed Prisma's 5000ms default
    // interactive-transaction timeout against Neon elsewhere in this
    // codebase (see lib/orders/fulfill-order-payment.js). 20s/10s gives real
    // headroom without masking a genuinely stuck transaction.
    }, { timeout: 20000, maxWait: 10000 });

    // Brand-new or still-unverified guest: the stock hold above already
    // exists (same as a verified checkout), but stop short of Stripe / the
    // on-site pickup confirmation until they confirm the email actually
    // belongs to them. Awaited — the interstitial we show next promises
    // "check your inbox", so we need to know it actually sent.
    if (!user.emailVerified) {
      try {
        await sendCheckoutVerificationEmail({
          email: user.email,
          fullName: user.fullName,
          resumeType: "ORDER",
          resumeId: order.id,
        });
      } catch (err) {
        console.error("[createOrderFromCart] verification email failed:", err);
        return { success: false, message: "Impossible d'envoyer l'email de confirmation. Veuillez réessayer." };
      }

      return { success: true, message: "Vérifiez votre email pour confirmer.", data: { requiresEmailVerification: true, email: user.email } };
    }

    if (isOnSite) {
      await sendPickupConfirmationEmail(user, order, pickupCode, expiresAt, totalAmount);

      return {
        success: true,
        message: "Commande confirmée.",
        data: { orderId: order.id, orderNumber: order.orderNumber, requiresPayment: false, pickupCode },
      };
    }

    return {
      success: true,
      message: "Commande créée, paiement requis.",
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        requiresPayment: true,
        // Authorizes the immediate createOrderCheckoutSession call the client
        // makes next: that builder is a public "use server" action, so the
        // orderId alone can't be the proof of ownership. Bound to this buyer,
        // valid 30 min.
        checkoutToken: createResumeCheckoutToken({ resumeType: "ORDER", resumeId: order.id, email: user.email }),
      },
    };
  } catch (error) {
    if (error.message === "STOCK_RACE") {
      captureWarning("Stock race lost during checkout", { area: "stock-capacity" });
      return { success: false, message: "Le stock a changé entre-temps — vérifiez votre panier et réessayez." };
    }
    if (error.message === "PROMO_EXHAUSTED") {
      captureWarning("Promo code usage cap lost during checkout", { area: "promo-codes" });
      return { success: false, message: "Ce code promo vient d'atteindre sa limite d'utilisation." };
    }
    if (error.message === "EXPORT_REQUIRES_MANUAL_REVIEW") {
      return { success: false, message: "Cette destination hors UE nécessite une vérification fiscale et douanière manuelle avant paiement." };
    }
    if (error.message === "VAT_RATE_NOT_CONFIGURED") {
      return { success: false, message: "Le taux de TVA de cette destination n’est pas configuré. Contactez Meri Beauty." };
    }
    if (error.message === "PHONE_ALREADY_REGISTERED") {
      return {
        success: false,
        message: "Ce numéro de téléphone est déjà associé à un autre compte. Connectez-vous ou utilisez un autre numéro.",
      };
    }
    if (error.message === "ADDRESS_REQUIRED") {
      return {
        success: false,
        message: "L'adresse de facturation est obligatoire.",
        requiresAddress: true,
        errors: { addressLine1: "Obligatoire", addressCity: "Obligatoire", addressPostalCode: "Obligatoire" },
      };
    }
    captureError(error, { area: "stock-capacity", context: "createOrderFromCart" });
    return { success: false, message: "Impossible de créer la commande." };
  }
}

/**
 * Extracted so it can be sent either immediately (already-verified
 * checkout) or later from resumeOrderAfterVerification, once a brand-new
 * guest confirms their email. Fire-and-forget — never blocks the caller.
 */
async function sendPickupConfirmationEmail(user, order, pickupCode, expiresAt, totalAmount) {
  // The QR travels with the e-mail rather than living only in "Mon compte":
  // most customers never open their account page, and the one moment they
  // will look for this is on their phone at the counter. The readable code
  // below stays in the body as the fallback if the attachment is stripped.
  const qr = await qrPngAttachment(pickupCode, `retrait-${order.orderNumber}.png`).catch((err) => {
    console.error("[sendPickupConfirmationEmail] QR generation failed:", err);
    return null;
  });

  return sendEmail({
    to: user.email,
    subject: "Commande confirmée – À retirer en boutique – Meri Beauty",
    text:
      `Bonjour ${user.fullName},\n\n` +
      `Votre commande n°${order.orderNumber} (${totalAmount.toFixed(2)} €) est confirmée. ` +
      `Présentez ce code en boutique pour la récupérer et régler le paiement sur place : ${pickupCode}\n\n` +
      `Merci de venir la retirer avant le ${expiresAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} — passé ce délai, la commande sera annulée.\n\n` +
      `L'équipe Meri Beauty`,
    html:
      `<p>Bonjour ${user.fullName},</p>` +
      `<p>Votre commande n°${order.orderNumber} (<strong>${totalAmount.toFixed(2)} €</strong>) est confirmée.</p>` +
      `<p>Présentez ce code en boutique pour la récupérer et régler le paiement sur place : <strong>${pickupCode}</strong></p>` +
      (qr ? `<p>Le QR code correspondant est joint à cet e-mail — présentez-le au comptoir, ou donnez simplement le code ci-dessus.</p>` : "") +
      `<p>Merci de venir la retirer avant le ${expiresAt.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} — passé ce délai, la commande sera annulée.</p>` +
      `<p>L'équipe Meri Beauty</p>`,
    ...(qr ? { attachments: [qr] } : {}),
  }).catch((err) => console.error("[sendPickupConfirmationEmail] failed:", err));
}

/**
 * Called by resumeCheckoutAfterVerification once a brand-new guest confirms
 * their email for an ORDER-type token. Branches on fulfilment mode: prepaid
 * orders still need a Stripe session (delegates to createOrderCheckoutSession
 * below); PICKUP_ON_SITE orders have no payment step, so this just sends the
 * confirmation email that createOrderFromCart deferred and points the
 * browser straight at the success page.
 *
 * @param {string} orderId
 */
export async function resumeOrderAfterVerification(orderId, checkoutToken) {
  if (!orderId) return { success: false, message: "Identifiant de commande manquant." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: { select: { fullName: true, email: true } } },
  });
  if (!order) return { success: false, message: "Commande introuvable." };

  // Exported "use server" action — the orderId alone proves nothing. The
  // pickup code below and the pickup-confirmation e-mail are gated behind
  // this check. The resume path reaches here with a signed resumeToken from
  // retryCheckoutSession; a logged-in owner is also authorized.
  const authSession = await auth();
  if (
    !isCheckoutAuthorized(order, {
      resumeType: "ORDER",
      resumeId: orderId,
      checkoutToken,
      sessionUserId: authSession?.user?.id,
    })
  ) {
    return { success: false, message: "Vous n'êtes pas autorisé(e) à reprendre cette commande." };
  }

  if (order.fulfilmentMode === "PICKUP_ON_SITE") {
    if (order.status !== "PENDING_PICKUP") {
      return { success: false, message: "Cette commande n'est plus en attente." };
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      return { success: false, message: "Le délai de retrait pour cette commande a expiré." };
    }

    await sendPickupConfirmationEmail(order.user, order, order.pickupCode, order.expiresAt, Number(order.totalAmount));

    return {
      success: true,
      url: `/boutique/order/success?onsite=1&number=${order.orderNumber}&code=${order.pickupCode}`,
    };
  }

  return createOrderCheckoutSession(orderId, checkoutToken);
}

/** Stripe Checkout Session for a PENDING_PAYMENT order (prepaid modes only). */
export async function createOrderCheckoutSession(orderId, checkoutToken) {
  if (!orderId) return { success: false, message: "Identifiant de commande manquant." };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: { select: { email: true } } },
    });
    if (!order) return { success: false, message: "Commande introuvable." };

    // This is an exported "use server" action reachable by anyone — a bare
    // orderId proves nothing. Authorize via a signed checkout token (guest
    // checkout / post-verification resume) or by being signed in as the
    // order's owner, BEFORE any Stripe session or pickup code is handed out.
    const authSession = await auth();
    if (
      !isCheckoutAuthorized(order, {
        resumeType: "ORDER",
        resumeId: orderId,
        checkoutToken,
        sessionUserId: authSession?.user?.id,
      })
    ) {
      return { success: false, message: "Vous n'êtes pas autorisé(e) à démarrer le paiement de cette commande." };
    }
    if (order.status !== "PENDING_PAYMENT") {
      return { success: false, message: "Cette commande n'est plus en attente de paiement." };
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      return { success: false, message: "Le délai de paiement pour cette commande a expiré." };
    }

    // Reuse the live Stripe session instead of minting a new one on every
    // retry-button click / post-verification resume / accidental double
    // submit. Without this, each call created a fresh live session and the
    // old one stayed payable — two tabs, two charges, no refund (the webhook
    // only recognizes a *duplicate* of the exact same session as harmless).
    if (order.stripeCheckoutSessionId) {
      const previousSession = await stripe.checkout.sessions
        .retrieve(order.stripeCheckoutSessionId)
        .catch(() => null);
      if (previousSession?.status === "open") {
        return { success: true, url: previousSession.url };
      }
      if (previousSession?.status === "complete") {
        // Already paid (or being finalized) via the previous session — the
        // webhook just hasn't landed yet. Creating a second session here
        // would be a real double charge; make the customer wait it out
        // instead.
        return {
          success: false,
          message: "Votre paiement précédent est en cours de confirmation. Merci de patienter quelques instants et de rafraîchir la page.",
        };
      }
    }

    if (!(await isSellerLegalDataComplete())) {
      return {
        success: false,
        message: "Le paiement en ligne n'est pas disponible pour le moment. Merci de réessayer plus tard ou de nous contacter.",
      };
    }

    // A 100%-off promo code can bring the total to exactly 0 — Stripe
    // Checkout Sessions in "payment" mode reject a 0-value line item, so
    // there's nothing to actually charge. Confirm the order directly
    // through the same fulfilment path a real Stripe payment uses (a
    // synthetic "session" shaped just enough for fulfillOrderPayment to
    // read), instead of forking a second, parallel implementation.
    if (Number(order.totalAmount) <= 0) {
      const syntheticSession = {
        id: `free_order_${order.id}`,
        metadata: { kind: "order", orderId: order.id },
        amount_total: 0,
        payment_intent: null,
      };
      await fulfillOrderPayment(syntheticSession);
      return { success: true, url: null, freeOrder: true, orderNumber: order.orderNumber, pickupCode: order.pickupCode };
    }

    const lineItems = order.items.map((item) => ({
      price_data: {
        currency: "eur",
        product_data: { name: `${item.productName} — ${item.variantName}` },
        unit_amount: Math.round(Number(item.unitPrice) * 100),
      },
      quantity: item.quantity,
    }));

    if (Number(order.shippingCost) > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: { name: "Livraison" },
          unit_amount: Math.round(Number(order.shippingCost) * 100),
        },
        quantity: 1,
      });
    }

    const metadata = { kind: "order", orderId: order.id };

    // Line items stay at full face value (same reasoning as orderInvoiceLines:
    // per-item price stays legible) — the promo discount, if any, is applied
    // as a Stripe-side coupon so the amount actually charged matches
    // order.totalAmount. Without this, Stripe charged full price while the
    // checkout UI had shown the discounted total.
    let discounts;
    if (Number(order.discountAmount) > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: Math.round(Number(order.discountAmount) * 100),
        currency: "eur",
        duration: "once",
        name: "Code promotionnel",
      });
      discounts = [{ coupon: coupon.id }];
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see docs/QUESTIONS_FOR_MARIE.md
      line_items: lineItems,
      ...(discounts ? { discounts } : {}),
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/boutique/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/boutique/cart?canceled=true`,
      customer_email: order.user.email,
      metadata,
      payment_intent_data: { metadata },
    });

    // Recorded so a later checkout attempt on the same cart can check with
    // Stripe directly whether *this* order was actually already paid before
    // assuming it's abandoned (see the supersede logic in createOrderFromCart).
    await prisma.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { success: true, url: session.url };
  } catch (error) {
    console.error("[createOrderCheckoutSession]", error);
    return { success: false, message: "Erreur lors de la création de la session de paiement." };
  }
}

// ─── Dashboard: read ────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 20;

export async function listOrders({ status, fulfilmentMode, search, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error, data: [], totalCount: 0, page: 1, pageSize };

  try {
    const where = {
      ...(status ? { status } : {}),
      ...(fulfilmentMode ? { fulfilmentMode } : {}),
      ...(search
        ? {
            OR: [
              { pickupCode: { contains: search, mode: "insensitive" } },
              { trackingCode: { contains: search, mode: "insensitive" } },
              { user: { fullName: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    // Unbounded findMany here used to fetch every order ever placed on
    // every dashboard load — fine at launch, would hang the page once
    // orders pile up. Paginate at the DB level instead.
    const [totalCount, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
          payment: { select: { id: true, transactionReference: true, status: true, transactions: { select: { method: true, transactionType: true } } } },
          items: true,
        },
      }),
    ]);

    return { success: true, data: orders.map(serializeOrder), totalCount, page, pageSize };
  } catch (error) {
    console.error("[listOrders]", error);
    return { success: false, message: "Impossible de charger les commandes.", data: [], totalCount: 0, page, pageSize };
  }
}

export async function getOrderById(orderId) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!orderId) return { success: false, message: "Identifiant manquant." };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        payment: { include: { invoice: { include: { creditNotes: true } }, transactions: true } },
        items: true,
        returnRequests: { include: { items: true }, orderBy: { requestedAt: "desc" } },
      },
    });
    if (!order) return { success: false, message: "Commande introuvable." };

    return { success: true, data: serializeOrder(order) };
  } catch (error) {
    console.error("[getOrderById]", error);
    return { success: false, message: "Impossible de charger la commande." };
  }
}

// ─── Dashboard: fulfilment ────────────────────────────────────────────────────

export async function markOrderReadyForPickup(orderId) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.fulfilmentMode === "SHIPPING_PREPAID") {
      return { success: false, message: "Cette commande est à expédier, pas à retirer." };
    }

    // Atomic claim, gated on the prior status — without this, two concurrent
    // clicks (double-click, or two staff members racing) both pass a plain
    // read-then-check and both fire the transition.
    const claim = await prisma.order.updateMany({
      where: { id: orderId, status: { in: ["PAID", "PENDING_PICKUP"] } },
      data: { status: "READY_FOR_PICKUP" },
    });
    if (claim.count === 0) {
      return { success: false, message: "Cette commande ne peut pas être marquée prête pour le moment." };
    }

    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: "Commande marquée comme prête pour le retrait." };
  } catch (error) {
    console.error("[markOrderReadyForPickup]", error);
    return { success: false, message: "Impossible de mettre à jour la commande." };
  }
}

/**
 * Read-only counterpart of completeOrderPickup, for the unified counter
 * scanner (actions/counter/lookup.js): resolves a bare pickup code to enough
 * to render PickupConfirmDialog without writing anything yet.
 */
export async function lookupOrderByPickupCode(pickupCode) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const order = await prisma.order.findUnique({
      where: { pickupCode },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        fulfilmentMode: true,
        totalAmount: true,
        payment: { select: { id: true } },
        user: { select: { fullName: true } },
      },
    });
    if (!order) return { success: false, message: "Commande introuvable — vérifiez le code." };

    return {
      success: true,
      data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        hasPayment: Boolean(order.payment),
        totalAmount: Number(order.totalAmount),
        readyForPickup:
          order.fulfilmentMode !== "SHIPPING_PREPAID"
          && ["PAID", "READY_FOR_PICKUP", "PENDING_PICKUP"].includes(order.status),
        user: order.user,
      },
    };
  } catch (error) {
    console.error("[lookupOrderByPickupCode]", error);
    return { success: false, message: "Impossible de lire cette commande." };
  }
}

/**
 * Staff scans the pickup QR / enters the code at the counter. If no Payment
 * exists yet (PICKUP_ON_SITE), `method` is required and payment is collected
 * — and stock is only decremented now, since it was only ever reserved.
 * If a Payment already exists (prepaid), this just records the handover.
 */
export async function completeOrderPickup({ orderId, pickupCode, method }) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const order = await prisma.order.findFirst({
      where: orderId ? { id: orderId } : { pickupCode },
      include: {
        items: true,
        payment: true,
        user: {
          select: {
            fullName: true,
            email: true,
            vatNumber: true,
            vatValidatedAt: true,
            vatValidationName: true,
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressPostalCode: true,
            addressCountry: true,
            isCompany: true,
            billingProfile: {
              select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
            },
          },
        },
      },
    });
    if (!order) return { success: false, message: "Commande introuvable — vérifiez le code." };
    if (order.fulfilmentMode === "SHIPPING_PREPAID") {
      return { success: false, message: "Cette commande est à expédier, pas à retirer en boutique." };
    }
    if (order.status === "COMPLETED") return { success: false, message: "Cette commande a déjà été remise." };
    if (!["PAID", "READY_FOR_PICKUP", "PENDING_PICKUP"].includes(order.status)) {
      return { success: false, message: "Cette commande n'est pas prête pour le retrait." };
    }

    const needsPayment = !order.payment;
    if (needsPayment && !method) {
      return { success: false, message: "Mode de paiement requis pour cette commande non prépayée." };
    }

    const { invoice } = await prisma.$transaction(async (tx) => {
      let invoice = null;

      if (needsPayment) {
        const payment = await tx.payment.create({
          data: {
            orderId: order.id,
            totalAmount: order.totalAmount,
            paidAmount: order.totalAmount,
            remainingAmount: 0,
            paymentType: "ON_SITE",
            status: "PAID",
            paidAt: new Date(),
            promoCodeId: order.promoCodeId,
            discountAmount: order.discountAmount,
          },
        });

        // Attach to whichever till session is open so the counter cash is
        // reconcilable at close (see lib/cash-sessions.js). Never blocks the
        // payment if none is open — the row is simply left unassigned.
        const openCashSession =
          method === "CASH"
            ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
            : null;

        await tx.transaction.create({
          data: {
            paymentId: payment.id,
            amount: order.totalAmount,
            method,
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
            cashSessionId: openCashSession?.id ?? null,
          },
        });

        invoice = await issueInvoice(tx, {
          paymentId: payment.id,
          source: "ORDER",
          totalInclVat: Number(order.totalAmount),
          customer: buildInvoiceCustomer(order.user, { vatNumberOverride: order.customerVatNumber ?? order.user.vatNumber }),
          lines: orderInvoiceLines(order),
          vatRate: Number(order.vatRate),
          vatTreatment: order.vatTreatment,
          taxCountryCode: order.taxCountryCode,
          taxNote: order.taxNote,
        });

        for (const item of order.items) {
          const updated = await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { decrement: item.quantity }, reservedQuantity: { decrement: item.quantity } },
          });
          const newStock = updated.stockQuantity;

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: "SALE",
              quantity: -item.quantity,
              previousStock: newStock + item.quantity,
              newStock,
              reason: `Commande n°${order.orderNumber} — paiement sur place`,
            },
          });
        }
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
          pickedUpAt: new Date(),
          pickedUpByStaffId: guard.session.user.id,
          expiresAt: null,
        },
      });

      return { invoice };
    // Same shape as lib/orders/fulfill-order-payment.js: payment, invoice
    // numbering and per-item stock updates are all sequential DB round
    // trips that can exceed Prisma's 5000ms default timeout against Neon.
    // 20s/10s gives real headroom.
    }, { timeout: 20000, maxWait: 10000 });

    if (invoice) {
      const invoicePdf = await renderInvoicePdf(invoice).catch((err) => {
        console.error("[completeOrderPickup] invoice PDF render failed:", err);
        return null;
      });

      sendEmail({
        to: order.user.email,
        subject: `Facture – Commande n°${order.orderNumber} – Meri Beauty`,
        text:
          `Bonjour ${order.user.fullName},\n\n` +
          `Merci pour votre achat ! Voici votre facture pour la commande n°${order.orderNumber} (${Number(order.totalAmount).toFixed(2)} €).\n\n` +
          `L'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${order.user.fullName},</p>` +
          `<p>Merci pour votre achat ! Voici votre facture pour la commande n°${order.orderNumber} (<strong>${Number(order.totalAmount).toFixed(2)} €</strong>).</p>` +
          `<p>L'équipe Meri Beauty</p>`,
        ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
      }).catch((err) => console.error("[completeOrderPickup] receipt email failed:", err));
    }

    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: `Commande n°${order.orderNumber} remise au client.` };
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    // Actionable at the counter: staff completes the customer record and
    // retries, instead of reading "impossible de finaliser le retrait".
    if (error.message === "BUYER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: error.userMessage };
    }
    console.error("[completeOrderPickup]", error);
    return { success: false, message: "Impossible de finaliser le retrait." };
  }
}

export async function markOrderShipped(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = shipOrderSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.trackingCode?.[0] ?? errors.orderId?.[0] ?? "Données invalides." };
  }
  const { orderId, trackingCode } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.fulfilmentMode !== "SHIPPING_PREPAID") {
      return { success: false, message: "Cette commande n'est pas à expédier." };
    }

    // Atomic claim, gated on the prior status — prevents a double-click (or
    // two staff members racing) from double-sending the shipped-notification
    // email for the same order.
    const claim = await prisma.order.updateMany({
      where: { id: orderId, status: "PROCESSING" },
      data: { status: "SHIPPED", trackingCode, shippedAt: new Date() },
    });
    if (claim.count === 0) {
      return { success: false, message: "Cette commande n'est pas prête à être expédiée." };
    }

    sendEmail({
      to: order.user.email,
      subject: `Commande expédiée – n°${order.orderNumber} – Meri Beauty`,
      text:
        `Bonjour ${order.user.fullName},\n\n` +
        `Votre commande n°${order.orderNumber} a été expédiée via Mondial Relay. Numéro de suivi : ${trackingCode}\n` +
        `Suivez votre colis : ${MONDIAL_RELAY_TRACKING_URL}\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${order.user.fullName},</p>` +
        `<p>Votre commande n°${order.orderNumber} a été expédiée via Mondial Relay. Numéro de suivi : <strong>${trackingCode}</strong>.</p>` +
        `<p><a href="${MONDIAL_RELAY_TRACKING_URL}" style="display:inline-block;padding:12px 18px;background:#2F3A2E;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Suivre mon colis</a></p>` +
        `<p>Sur la page Mondial Relay, saisissez le numéro de suivi : <strong>${trackingCode}</strong>.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[markOrderShipped] email failed:", err));

    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: "Commande marquée comme expédiée." };
  } catch (error) {
    console.error("[markOrderShipped]", error);
    return { success: false, message: "Impossible de mettre à jour la commande." };
  }
}

/**
 * Closes a shipped order. Requires the date staff confirmed (from the
 * Mondial Relay tracking portal) that the customer actually collected the
 * parcel — this becomes Order.collectedAt, the legal start of the 14-day
 * withdrawal window (see withdrawalWindow() in actions/boutique/returns.js).
 * Closing without a real date would let the return window silently start
 * from nothing, the exact gap this action exists to close.
 */
export async function markOrderCompleted(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = closeShippedOrderSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.collectedAt?.[0] ?? errors.orderId?.[0] ?? "Données invalides." };
  }
  const { orderId, collectedAt } = parsed.data;

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.shippedAt && collectedAt.getTime() < order.shippedAt.getTime()) {
      return { success: false, message: "La date de retrait ne peut pas être antérieure à la date d'expédition." };
    }

    // Atomic claim, gated on the prior status — same double-click/race guard
    // as markOrderShipped/markOrderReadyForPickup above.
    const claim = await prisma.order.updateMany({
      where: { id: orderId, status: "SHIPPED" },
      data: { status: "COMPLETED", collectedAt },
    });
    if (claim.count === 0) {
      return { success: false, message: "Seule une commande expédiée peut être clôturée." };
    }

    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: "Commande clôturée." };
  } catch (error) {
    console.error("[markOrderCompleted]", error);
    return { success: false, message: "Impossible de clôturer la commande." };
  }
}

/** Staff-initiated cancellation — refunds if paid, always releases/returns stock. */
/**
 * Shared by both the admin-facing cancelOrder and the customer-facing
 * cancelMyOrder — every authorization/ownership/status decision happens in
 * the caller, this just performs the cancellation once that's settled.
 */
// Once a parcel is shipped, do not restock or refund it through a generic
// cancellation: the goods are no longer physically in the salon. It must go
// through the return workflow once received (or a separately audited loss /
// carrier-claim process).
const CANCELLABLE_ORDER_STATUSES = ["PENDING_PAYMENT", "PENDING_PICKUP", "PAID", "PROCESSING", "READY_FOR_PICKUP"];

async function performOrderCancellation(order, reason, manualRefund = {}) {
  const orderId = order.id;
  try {
    const wasSold = Boolean(order.payment); // stock already decremented via SALE

    // A refund on this same payment (e.g. from a partial return on the same
    // order) may already be in flight — its exact pending amount lives in a
    // single pair of columns on Payment, so starting a second refund now
    // would overwrite it and strand that amount from ever being safely
    // retried. Must resolve (succeed or be manually reconciled) first.
    if (wasSold && ["REFUND_PENDING", "REFUND_FAILED"].includes(order.payment.status)) {
      return {
        success: false,
        message: "Un remboursement est déjà en cours de traitement pour cette commande — attendez sa résolution (ou réessayez-le depuis la page Réconciliation) avant d'annuler.",
      };
    }

    // Cap against what's actually still outstanding — a prior partial return
    // can already have refunded part of this payment, so summing (not just
    // checking existence of) prior REFUND transactions is what stops this
    // from either re-refunding the full original amount or, worse, silently
    // skipping the remaining balance once any refund exists at all. Mirrors
    // completeReturnRequest's exact pattern. Computed once up front so the
    // credit note (below) and the Stripe refund (further down) agree on the
    // same capped amount.
    const REFUND_EPSILON = 0.01;
    let remaining = 0;
    if (wasSold) {
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: order.payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      remaining = Number(order.payment.paidAmount) - alreadyRefunded;
    }

    const originalMethod = getOrderPaymentMethod(order.payment);
    const needsManualRefund = wasSold && isManualOrderRefund(order.payment) && remaining > REFUND_EPSILON;
    if (needsManualRefund) {
      const confirmationError = validateManualRefundConfirmation({
        method: originalMethod,
        confirmed: manualRefund.confirmed,
        reference: manualRefund.reference,
      });
      if (confirmationError) {
        return {
          success: false,
          message: confirmationError,
          requiresManualRefundConfirmation: true,
          paymentMethod: originalMethod,
          paymentMethodLabel: refundMethodLabel(originalMethod),
          refundInstruction: manualRefundInstruction(originalMethod),
        };
      }
    }

    const { claimed, creditNote } = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the order still being in a cancellable status —
      // without this, two concurrent cancel calls (e.g. a double-click, or the
      // customer and staff cancelling at once) both pass a plain read-then-check
      // and both restock + refund + credit-note. Only the request that actually
      // flips the row wins; everyone else gets a clean "already processed".
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: { in: CANCELLABLE_ORDER_STATUSES } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
      });
      if (claim.count === 0) {
        return { claimed: false, creditNote: null };
      }

      for (const item of order.items) {
        // POS ad-hoc service lines (variantId null) carry no stock to adjust.
        if (!item.variantId) continue;
        if (wasSold) {
          const updated = await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: { increment: item.quantity } },
          });
          const newStock = updated.stockQuantity;
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: "RETURN",
              quantity: item.quantity,
              previousStock: newStock - item.quantity,
              newStock,
              reason: `Commande n°${order.orderNumber} annulée`,
            },
          });
        } else {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
      }

      if (order.promoCodeId) {
        await tx.promoCode.updateMany({
          where: { id: order.promoCodeId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } },
        });
      }

      let creditNote = null;
      if (wasSold && order.payment.invoice && remaining > REFUND_EPSILON) {
        creditNote = await issueCreditNote(tx, {
          invoiceId: order.payment.invoice.id,
          reason: reason ?? "Commande annulée",
          totalInclVat: remaining,
        });
      }

      if (needsManualRefund) {
        const fullyRefunded = remaining + REFUND_EPSILON >= Number(order.payment.paidAmount);
        // Attach to whichever till session is open so the counter cash is
        // reconcilable at close (see lib/cash-sessions.js). Never blocks the
        // refund if none is open — the row is simply left unassigned.
        const openCashSession =
          originalMethod === "CASH"
            ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
            : null;
        await tx.transaction.create({
          data: {
            paymentId: order.payment.id,
            amount: remaining,
            method: originalMethod,
            transactionType: "REFUND",
            paidAt: new Date(),
            manualReference: originalMethod === "CARD" ? manualRefund.reference.trim() : null,
            cashSessionId: openCashSession?.id ?? null,
            creditNoteId: creditNote?.id ?? null,
          },
        });
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: manualRefund.actorId ?? null,
          actorRole: manualRefund.actorRole ?? null,
          action: "order.cancelled",
          entityType: "Order",
          entityId: orderId,
          metadata: {
            orderNumber: order.orderNumber,
            reason: reason ?? null,
            refundAmount: remaining,
            refundMethod: needsManualRefund ? originalMethod : order.payment?.transactionReference ? "ONLINE" : null,
            manualReference: needsManualRefund && originalMethod === "CARD" ? manualRefund.reference.trim() : null,
            manualRefundConfirmed: needsManualRefund,
          },
        },
      });

      return { claimed: true, creditNote };
    });

    if (!claimed) {
      return { success: true, message: "Cette commande a déjà été annulée." };
    }

    let refundFailed = false;
    if (wasSold && order.payment.transactionReference) {
      if (remaining > REFUND_EPSILON) {
        // Recorded before the Stripe call, not just in the catch block below —
        // a crash/timeout mid-call would otherwise leave nothing durable to
        // retry against; see lib/payments/retry-failed-refunds.js. Pinning
        // the exact amount + a stable idempotency key here (not recomputed
        // later) is what lets a retry replay precisely this operation
        // instead of resolving to the full remaining balance on the payment.
        const refundIdempotencyKey = `cancel-${orderId}-${randomUUID()}`;
        await prisma.payment.update({
          where: { id: order.payment.id },
          data: {
            status: "REFUND_PENDING",
            pendingRefundAmount: remaining,
            pendingRefundIdempotencyKey: refundIdempotencyKey,
            pendingRefundCreditNoteId: creditNote?.id ?? null,
          },
        });
        try {
          const session = await stripe.checkout.sessions.retrieve(order.payment.transactionReference);
          if (session.payment_intent) {
            const stripePaymentIntentId =
              typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
            await stripe.refunds.create(
              { payment_intent: stripePaymentIntentId, amount: Math.round(remaining * 100) },
              { idempotencyKey: refundIdempotencyKey }
            );
            const fullyRefunded = remaining + REFUND_EPSILON >= Number(order.payment.paidAmount);
            await prisma.$transaction([
              prisma.transaction.updateMany({
                where: {
                  paymentId: order.payment.id,
                  transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
                  stripePaymentIntentId: null,
                },
                data: { stripePaymentIntentId },
              }),
              prisma.transaction.create({
                data: {
                  paymentId: order.payment.id,
                  amount: remaining,
                  method: "ONLINE",
                  transactionType: "REFUND",
                  paidAt: new Date(),
                  stripeCheckoutSessionId: order.payment.transactionReference,
                  stripePaymentIntentId,
                  creditNoteId: creditNote?.id ?? null,
                },
              }),
              prisma.payment.update({
                where: { id: order.payment.id },
                data: {
                  status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
                  pendingRefundAmount: null,
                  pendingRefundIdempotencyKey: null,
                  pendingRefundCreditNoteId: null,
                },
              }),
              prisma.auditLog.create({
                data: {
                  actorId: manualRefund.actorId ?? null,
                  actorRole: manualRefund.actorRole ?? null,
                  action: "order.cancellation_refund_completed",
                  entityType: "Order",
                  entityId: orderId,
                  metadata: { orderNumber: order.orderNumber, amount: remaining, method: "ONLINE", automatedByStripe: true },
                },
              }),
            ]);
          } else {
            throw new Error("STRIPE_PAYMENT_INTENT_MISSING");
          }
        } catch (err) {
          // The order is already cancelled and stock restored — that's correct
          // and stays. But don't let the customer email below claim a refund
          // that didn't happen; surface this to staff instead, AND persist it
          // durably so the cron retry job (lib/payments/retry-failed-refunds.js)
          // can pick it up even if this email is missed.
          console.error("[performOrderCancellation] REFUND FAILED for order", orderId, err);
          refundFailed = true;
          await prisma.payment.update({
            where: { id: order.payment.id },
            data: {
              status: "REFUND_FAILED",
              refundFailureReason: err?.message?.slice(0, 500) ?? "Erreur inconnue",
              refundAttemptedAt: new Date(),
              refundRetryCount: { increment: 1 },
            },
          });
        }
      }
    }

    let creditNotePdf = null;
    if (creditNote) {
      creditNotePdf = await renderCreditNotePdf(creditNote, order.payment.invoice).catch((err) => {
        console.error("[performOrderCancellation] credit note PDF render failed:", err);
        return null;
      });
    }

    const refundNote = wasSold
      ? refundFailed
        ? " Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
        : needsManualRefund
          ? " Le remboursement a été effectué directement en boutique."
        : " Le remboursement apparaîtra sur votre compte sous quelques jours."
      : "";

    // A walk-in POS "client de passage" order has no user/email to notify —
    // nothing to send here, the cashier already has whatever ticket/refund
    // record was handed over in person.
    if (order.user) {
      sendEmail({
        to: order.user.email,
        subject: `Commande annulée – n°${order.orderNumber} – Meri Beauty`,
        text:
          `Bonjour ${order.user.fullName},\n\n` +
          `Votre commande n°${order.orderNumber} a été annulée.${refundNote}` +
          (reason ? ` Raison : ${reason}` : "") +
          `\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${order.user.fullName},</p>` +
          `<p>Votre commande n°${order.orderNumber} a été annulée.${refundNote}` +
          (reason ? ` Raison : ${reason}` : "") +
          `</p><p>L'équipe Meri Beauty</p>`,
        ...(creditNotePdf
          ? { attachments: [{ filename: `note-de-credit-${creditNote.number}.pdf`, content: creditNotePdf }] }
          : {}),
      }).catch((err) => console.error("[performOrderCancellation] email failed:", err));
    }

    if (refundFailed) {
      const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
      if (salon?.email) {
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement Stripe échoué – Commande n°${order.orderNumber}`,
          text: `Le remboursement Stripe pour la commande n°${order.orderNumber} (client : ${order.user?.email ?? "client de passage"}) a échoué. Traitement manuel requis dans le dashboard Stripe.`,
          html: `<p>Le remboursement Stripe pour la commande n°${order.orderNumber} (client : ${order.user?.email ?? "client de passage"}) a échoué. Traitement manuel requis dans le dashboard Stripe.</p>`,
        }).catch((err) => console.error("[performOrderCancellation] refund-failure alert email failed:", err));
      }
    }

    revalidatePath("/dashboard/boutique/orders");
    revalidatePath("/mon-compte");
    return {
      success: true,
      message: refundFailed
        ? "Commande annulée. Le remboursement n'a pas pu être traité automatiquement — notre équipe s'en occupe."
        : "Commande annulée.",
      refundFailed,
    };
  } catch (error) {
    console.error("[performOrderCancellation]", error);
    return { success: false, message: "Impossible d'annuler la commande." };
  }
}

/** Admin/staff: cancel any order. */
export async function cancelOrder(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.orderId?.[0] ?? "Données invalides." };
  }
  const { orderId, reason, manualRefundConfirmed, manualRefundReference } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payment: { include: { invoice: true } },
      user: { select: { fullName: true, email: true } },
    },
  });
  if (!order) return { success: false, message: "Commande introuvable." };
  if (["CANCELLED", "EXPIRED", "COMPLETED"].includes(order.status)) {
    return { success: false, message: "Cette commande ne peut plus être annulée." };
  }
  if (order.status === "SHIPPED") {
    return { success: false, message: "Cette commande est déjà expédiée. Attendez le retour physique des articles avant de procéder au remboursement." };
  }

  // Cancelling an unpaid order is routine order management — but cancelling
  // a paid one triggers restock + a real Stripe refund, which per policy
  // only OWNER/ADMIN may issue. STAFF can still cancel unpaid/pending orders.
  if (order.payment && !isAdminRole(guard.session.user.role)) {
    return {
      success: false,
      message: "Seul un administrateur peut annuler une commande déjà payée (remboursement requis). Contactez un administrateur.",
    };
  }

  return performOrderCancellation(order, reason, {
    confirmed: manualRefundConfirmed,
    reference: manualRefundReference,
    actorId: guard.session.user.id,
    actorRole: guard.session.user.role,
  });
}

/**
 * Customer self-service: cancel one of MY OWN orders, only while it's still
 * PENDING_PAYMENT or PENDING_PICKUP — i.e. nothing has been paid-and-fulfilled
 * yet. Once staff has started preparing/shipping (PAID and beyond), a
 * customer can no longer unilaterally cancel through here; that needs staff
 * involvement via the admin cancelOrder above.
 */
export async function cancelMyOrder(orderId) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }
  if (!orderId || typeof orderId !== "string") {
    return { success: false, message: "Commande invalide." };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payment: { include: { invoice: true } },
      user: { select: { fullName: true, email: true } },
    },
  });
  if (!order || order.userId !== session.user.id) {
    return { success: false, message: "Commande introuvable." };
  }
  if (!["PENDING_PAYMENT", "PENDING_PICKUP"].includes(order.status)) {
    return { success: false, message: "Cette commande ne peut plus être annulée en ligne — contactez-nous." };
  }
  if (order.source === "POS") {
    return { success: false, message: "Cette vente en caisse ne peut pas être annulée depuis l'espace client — contactez l'équipe." };
  }

  return performOrderCancellation(order, "Annulée par le client", { actorId: session.user.id, actorRole: session.user.role });
}
