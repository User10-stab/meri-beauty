"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail } from "@/lib/email-templates";
import { ROLES, DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";
import { checkoutSchema, shipOrderSchema, cancelOrderSchema } from "@/lib/validations/commerce";
import { getOrCreateActiveCart } from "@/actions/boutique/cart";
import { issueInvoice, issueCreditNote } from "@/lib/invoicing";
import { renderInvoicePdf, renderCreditNotePdf } from "@/lib/pdf/render";
import { calculateShippingCost, calculateTotalWeight } from "@/lib/shipping";

/** Order items (+ shipping, if any) as invoice line snapshots. */
function orderInvoiceLines(order) {
  const lines = order.items.map((item) => ({
    description: `${item.productName} — ${item.variantName}`,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
  }));
  if (Number(order.shippingCost) > 0) {
    lines.push({ description: "Livraison", quantity: 1, unitPrice: Number(order.shippingCost) });
  }
  return lines;
}

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
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

const PENDING_PAYMENT_EXPIRY_MINUTES = 30;
const PENDING_PICKUP_EXPIRY_DAYS = 7;

// ─── Guards ───────────────────────────────────────────────────────────────────

async function requireOrdersAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
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

/** Mirrors createReservation's customer resolution — guest checkout creates an account. */
async function resolveOrCreateCustomer(customerInfo) {
  if (customerInfo.userId) {
    const user = await prisma.user.findUnique({ where: { id: customerInfo.userId, isDeleted: false } });
    if (user) return { user, isNewUser: false, temporaryPassword: null };
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: customerInfo.email.trim().toLowerCase() },
        ...(customerInfo.phone ? [{ phone: customerInfo.phone.trim() }] : []),
      ],
      isDeleted: false,
    },
  });
  if (existing) return { user: existing, isNewUser: false, temporaryPassword: null };

  const temporaryPassword = randomBytes(9).toString("base64url");
  const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      fullName: customerInfo.fullName.trim(),
      email: customerInfo.email.trim().toLowerCase(),
      phone: customerInfo.phone.trim(),
      password: hashedPassword,
      role: "CUSTOMER",
      emailVerified: true,
      isActive: true,
      newsletterSubscribed: customerInfo.newsletterSubscribed ?? false,
    },
  });

  return { user, isNewUser: true, temporaryPassword };
}

function serializeOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    fulfilmentMode: order.fulfilmentMode,
    status: order.status,
    subtotal: Number(order.subtotal),
    shippingCost: Number(order.shippingCost),
    totalAmount: Number(order.totalAmount),
    shippingLine1: order.shippingLine1,
    shippingLine2: order.shippingLine2,
    shippingCity: order.shippingCity,
    shippingPostalCode: order.shippingPostalCode,
    shippingCountry: order.shippingCountry,
    bpostTrackingCode: order.bpostTrackingCode,
    shippedAt: order.shippedAt,
    pickupCode: order.pickupCode,
    pickedUpAt: order.pickedUpAt,
    expiresAt: order.expiresAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    notes: order.notes,
    createdAt: order.createdAt,
    user: order.user
      ? { id: order.user.id, fullName: order.user.fullName, email: order.user.email, phone: order.user.phone }
      : null,
    hasPayment: Boolean(order.payment),
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
        errors.fulfilmentMode?.[0] ??
        errors.shippingAddress?.[0] ??
        errors.customerInfo?.[0] ??
        "Données invalides.",
    };
  }
  const { fulfilmentMode, customerInfo, shippingAddress, notes } = parsed.data;

  try {
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

    // A customer who abandoned a prepaid checkout and comes back to retry
    // (closed the Stripe tab, card declined, etc.) hits this same cart again
    // before their first attempt's 30-minute hold expires - without this,
    // the retry would reserve the same stock a second time on top of the
    // still-live first reservation, self-inflicting a false "out of stock"
    // against their own abandoned order. Silently supersede it: release its
    // hold (no email - this isn't a customer-visible cancellation, it's an
    // implementation detail of retrying the same purchase).
    const supersededOrder = await prisma.order.findFirst({
      where: { cartId: fullCart.id, status: "PENDING_PAYMENT" },
      include: { items: true },
    });
    if (supersededOrder) {
      await prisma.$transaction(async (tx) => {
        for (const item of supersededOrder.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
        await tx.order.update({
          where: { id: supersededOrder.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Remplacée par une nouvelle tentative de paiement" },
        });
      });
    }

    for (const item of fullCart.items) {
      if (item.variant.isDeleted || !item.variant.isActive) {
        return { success: false, message: `"${item.variant.product.name}" n'est plus disponible — retirez-le du panier.` };
      }
      const available = item.variant.stockQuantity - item.variant.reservedQuantity;
      if (item.quantity > available) {
        return {
          success: false,
          message: `Stock insuffisant pour "${item.variant.product.name}" (${available} disponible(s)).`,
        };
      }
    }

    const { user, isNewUser, temporaryPassword } = await resolveOrCreateCustomer(customerInfo);

    const subtotal = fullCart.items.reduce(
      (sum, item) => sum + Number(item.variant.price) * item.quantity,
      0
    );

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
    }

    const totalAmount = subtotal + shippingCost;

    const isOnSite = fulfilmentMode === "PICKUP_ON_SITE";
    const pickupCode = fulfilmentMode !== "SHIPPING_PREPAID" ? await uniquePickupCode() : null;
    const expiresAt = isOnSite
      ? new Date(Date.now() + PENDING_PICKUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + PENDING_PAYMENT_EXPIRY_MINUTES * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      for (const item of fullCart.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stockQuantity: true, reservedQuantity: true },
        });
        const available = variant.stockQuantity - variant.reservedQuantity;
        if (item.quantity > available) throw new Error("STOCK_RACE");

        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { reservedQuantity: { increment: item.quantity } },
        });
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
          shippingLine1: shippingAddress?.line1 ?? null,
          shippingLine2: shippingAddress?.line2 ?? null,
          shippingCity: shippingAddress?.city ?? null,
          shippingPostalCode: shippingAddress?.postalCode ?? null,
          pickupCode,
          expiresAt,
          notes: notes || null,
          items: {
            create: fullCart.items.map((item) => ({
              variantId: item.variantId,
              productName: item.variant.product.name,
              variantName: item.variant.name,
              sku: item.variant.sku,
              unitPrice: item.variant.price,
              quantity: item.quantity,
            })),
          },
        },
      });

      // PICKUP_ON_SITE has no payment step — the order is confirmed right here, so the
      // cart empties immediately, same as any normal checkout. The two prepaid modes
      // still redirect to Stripe after this: the cart deliberately stays ACTIVE until
      // fulfillOrderPayment() confirms the payment actually went through, so a customer
      // who abandons the Stripe page and comes back still finds their cart intact
      // instead of it looking silently cleared.
      if (isOnSite) {
        await tx.cart.update({ where: { id: fullCart.id }, data: { status: "CONVERTED" } });
      }

      return created;
    });

    if (isNewUser && temporaryPassword) {
      sendEmail({
        to: user.email,
        ...welcomeWithCredentialsEmail({
          customerName: user.fullName,
          email: user.email,
          temporaryPassword,
          loginUrl: LOGIN_URL,
        }),
      }).catch((err) => console.error("[createOrderFromCart] welcome email failed:", err));
    }

    if (isOnSite) {
      sendEmail({
        to: user.email,
        subject: "Commande confirmée – À retirer en boutique – Meri Beauty",
        text:
          `Bonjour ${user.fullName},\n\n` +
          `Votre commande n°${order.orderNumber} (${totalAmount.toFixed(2)} €) est confirmée. ` +
          `Présentez ce code en boutique pour la récupérer et régler le paiement sur place : ${pickupCode}\n\n` +
          `Merci de venir la retirer avant le ${expiresAt.toLocaleDateString("fr-FR")} — passé ce délai, la commande sera annulée.\n\n` +
          `L'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${user.fullName},</p>` +
          `<p>Votre commande n°${order.orderNumber} (<strong>${totalAmount.toFixed(2)} €</strong>) est confirmée.</p>` +
          `<p>Présentez ce code en boutique pour la récupérer et régler le paiement sur place : <strong>${pickupCode}</strong></p>` +
          `<p>Merci de venir la retirer avant le ${expiresAt.toLocaleDateString("fr-FR")} — passé ce délai, la commande sera annulée.</p>` +
          `<p>L'équipe Meri Beauty</p>`,
      }).catch((err) => console.error("[createOrderFromCart] confirmation email failed:", err));

      return {
        success: true,
        message: "Commande confirmée.",
        data: { orderId: order.id, orderNumber: order.orderNumber, requiresPayment: false, pickupCode },
      };
    }

    return {
      success: true,
      message: "Commande créée, paiement requis.",
      data: { orderId: order.id, orderNumber: order.orderNumber, requiresPayment: true },
    };
  } catch (error) {
    if (error.message === "STOCK_RACE") {
      return { success: false, message: "Le stock a changé entre-temps — vérifiez votre panier et réessayez." };
    }
    console.error("[createOrderFromCart]", error);
    return { success: false, message: "Impossible de créer la commande." };
  }
}

/** Stripe Checkout Session for a PENDING_PAYMENT order (prepaid modes only). */
export async function createOrderCheckoutSession(orderId) {
  if (!orderId) return { success: false, message: "Identifiant de commande manquant." };

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, user: { select: { email: true } } },
    });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.status !== "PENDING_PAYMENT") {
      return { success: false, message: "Cette commande n'est plus en attente de paiement." };
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      return { success: false, message: "Le délai de paiement pour cette commande a expiré." };
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "bancontact"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/boutique/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/boutique/cart?canceled=true`,
      customer_email: order.user.email,
      metadata,
      payment_intent_data: { metadata },
    });

    return { success: true, url: session.url };
  } catch (error) {
    console.error("[createOrderCheckoutSession]", error);
    return { success: false, message: "Erreur lors de la création de la session de paiement." };
  }
}

/**
 * Called by the Stripe webhook (app/api/webhooks/stripe/route.js) when
 * session.metadata.kind === "order". Idempotent via
 * Payment.transactionReference, same pattern as the appointment path.
 */
export async function fulfillOrderPayment(session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) return { received: true, warning: "missing orderId metadata" };

  const existing = await prisma.payment.findFirst({
    where: { transactionReference: session.id },
    select: { id: true },
  });
  if (existing) return { received: true, alreadyProcessed: true };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, cart: { select: { id: true, status: true } }, user: { select: { id: true, fullName: true, email: true, vatNumber: true } } },
  });

  if (!order || order.status === "CANCELLED" || order.status === "EXPIRED") {
    console.warn("[fulfillOrderPayment] order gone/cancelled after payment, refunding:", session.id);
    if (session.payment_intent) {
      await stripe.refunds.create({ payment_intent: session.payment_intent }).catch((err) => {
        console.error("[fulfillOrderPayment] REFUND FAILED for", session.id, err);
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "order unavailable" };
  }

  if (order.status !== "PENDING_PAYMENT") {
    return { received: true, alreadyProcessed: true };
  }

  const paidAmount = (session.amount_total ?? 0) / 100;
  const nextStatus = order.fulfilmentMode === "SHIPPING_PREPAID" ? "PROCESSING" : "PAID";

  const { invoice } = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        totalAmount: order.totalAmount,
        paidAmount,
        remainingAmount: 0,
        paymentType: "ONLINE",
        status: "PAID",
        paidAt: new Date(),
        transactionReference: session.id,
      },
    });

    await tx.transaction.create({
      data: {
        paymentId: payment.id,
        amount: paidAmount,
        method: "ONLINE",
        transactionType: "FINAL_PAYMENT",
        paidAt: new Date(),
      },
    });

    const invoice = await issueInvoice(tx, {
      paymentId: payment.id,
      source: "ORDER",
      totalInclVat: paidAmount,
      customer: { fullName: order.user.fullName, email: order.user.email, vatNumber: order.user.vatNumber },
      lines: orderInvoiceLines(order),
    });

    for (const item of order.items) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { stockQuantity: true, reservedQuantity: true },
      });
      const newStock = variant.stockQuantity - item.quantity;

      await tx.productVariant.update({
        where: { id: item.variantId },
        data: {
          stockQuantity: newStock,
          reservedQuantity: { decrement: item.quantity },
        },
      });

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "SALE",
          quantity: -item.quantity,
          previousStock: variant.stockQuantity,
          newStock,
          reason: `Commande n°${order.orderNumber}`,
        },
      });
    }

    await tx.order.update({ where: { id: order.id }, data: { status: nextStatus, expiresAt: null } });

    // Only now — payment confirmed — does the source cart actually empty. It was
    // deliberately left ACTIVE at checkout time so an abandoned Stripe session
    // wouldn't wipe the customer's cart (see createOrderFromCart).
    if (order.cart && order.cart.status === "ACTIVE") {
      await tx.cart.update({ where: { id: order.cart.id }, data: { status: "CONVERTED" } });
    }

    await tx.notification.create({
      data: {
        userId: order.user.id,
        type: "PAYMENT_RECEIVED",
        title: "Paiement reçu",
        message: `Paiement de €${paidAmount.toFixed(2)} reçu pour la commande n°${order.orderNumber}.`,
        status: "PENDING",
      },
    });

    return { invoice };
  });

  const pickupNote =
    order.fulfilmentMode === "PICKUP_PREPAID"
      ? `Nous vous préviendrons dès qu'elle sera prête à être retirée. Code de retrait : ${order.pickupCode}.`
      : "Elle sera expédiée sous peu — vous recevrez le numéro de suivi bpost par e-mail.";

  const invoicePdf = await renderInvoicePdf(invoice).catch((err) => {
    console.error("[fulfillOrderPayment] invoice PDF render failed:", err);
    return null;
  });

  sendEmail({
    to: order.user.email,
    subject: `Paiement confirmé – Commande n°${order.orderNumber} – Meri Beauty`,
    text:
      `Bonjour ${order.user.fullName},\n\n` +
      `Votre paiement de €${paidAmount.toFixed(2)} pour la commande n°${order.orderNumber} a bien été reçu. ${pickupNote}\n\n` +
      `L'équipe Meri Beauty`,
    ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
    html:
      `<p>Bonjour ${order.user.fullName},</p>` +
      `<p>Votre paiement de <strong>€${paidAmount.toFixed(2)}</strong> pour la commande n°${order.orderNumber} a bien été reçu. ${pickupNote}</p>` +
      `<p>L'équipe Meri Beauty</p>`,
  }).catch((err) => console.error("[fulfillOrderPayment] confirmation email failed:", err));

  return { received: true, processed: true };
}

// ─── Dashboard: read ────────────────────────────────────────────────────────────

export async function listOrders({ status, fulfilmentMode, search } = {}) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const orders = await prisma.order.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(fulfilmentMode ? { fulfilmentMode } : {}),
        ...(search
          ? {
              OR: [
                { pickupCode: { contains: search, mode: "insensitive" } },
                { bpostTrackingCode: { contains: search, mode: "insensitive" } },
                { user: { fullName: { contains: search, mode: "insensitive" } } },
                { user: { email: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, fullName: true, email: true, phone: true } },
        payment: { select: { id: true } },
        items: true,
      },
    });

    return { success: true, data: orders.map(serializeOrder) };
  } catch (error) {
    console.error("[listOrders]", error);
    return { success: false, message: "Impossible de charger les commandes.", data: [] };
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
        payment: { include: { invoice: { include: { creditNotes: true } } } },
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
    if (!["PAID", "PENDING_PICKUP"].includes(order.status)) {
      return { success: false, message: "Cette commande ne peut pas être marquée prête pour le moment." };
    }

    await prisma.order.update({ where: { id: orderId }, data: { status: "READY_FOR_PICKUP" } });
    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: "Commande marquée comme prête pour le retrait." };
  } catch (error) {
    console.error("[markOrderReadyForPickup]", error);
    return { success: false, message: "Impossible de mettre à jour la commande." };
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
      include: { items: true, payment: true, user: { select: { fullName: true, email: true, vatNumber: true } } },
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
          },
        });

        await tx.transaction.create({
          data: {
            paymentId: payment.id,
            amount: order.totalAmount,
            method,
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
          },
        });

        invoice = await issueInvoice(tx, {
          paymentId: payment.id,
          source: "ORDER",
          totalInclVat: Number(order.totalAmount),
          customer: { fullName: order.user.fullName, email: order.user.email, vatNumber: order.user.vatNumber },
          lines: orderInvoiceLines(order),
        });

        for (const item of order.items) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: { stockQuantity: true },
          });
          const newStock = variant.stockQuantity - item.quantity;

          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stockQuantity: newStock, reservedQuantity: { decrement: item.quantity } },
          });

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: "SALE",
              quantity: -item.quantity,
              previousStock: variant.stockQuantity,
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
    });

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
    return { success: false, message: errors.bpostTrackingCode?.[0] ?? errors.orderId?.[0] ?? "Données invalides." };
  }
  const { orderId, bpostTrackingCode } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { user: { select: { fullName: true, email: true } } },
    });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.fulfilmentMode !== "SHIPPING_PREPAID") {
      return { success: false, message: "Cette commande n'est pas à expédier." };
    }
    if (order.status !== "PROCESSING") {
      return { success: false, message: "Cette commande n'est pas prête à être expédiée." };
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { status: "SHIPPED", bpostTrackingCode, shippedAt: new Date() },
    });

    sendEmail({
      to: order.user.email,
      subject: `Commande expédiée – n°${order.orderNumber} – Meri Beauty`,
      text:
        `Bonjour ${order.user.fullName},\n\n` +
        `Votre commande n°${order.orderNumber} a été expédiée via bpost. Numéro de suivi : ${bpostTrackingCode}\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${order.user.fullName},</p>` +
        `<p>Votre commande n°${order.orderNumber} a été expédiée via bpost. Numéro de suivi : <strong>${bpostTrackingCode}</strong></p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[markOrderShipped] email failed:", err));

    revalidatePath("/dashboard/boutique/orders");
    return { success: true, message: "Commande marquée comme expédiée." };
  } catch (error) {
    console.error("[markOrderShipped]", error);
    return { success: false, message: "Impossible de mettre à jour la commande." };
  }
}

export async function markOrderCompleted(orderId) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, message: "Commande introuvable." };
    if (order.status !== "SHIPPED") {
      return { success: false, message: "Seule une commande expédiée peut être clôturée." };
    }

    await prisma.order.update({ where: { id: orderId }, data: { status: "COMPLETED" } });
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
async function performOrderCancellation(order, reason) {
  const orderId = order.id;
  try {
    const wasSold = Boolean(order.payment); // stock already decremented via SALE

    const { creditNote } = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { stockQuantity: true, reservedQuantity: true },
        });

        if (wasSold) {
          const newStock = variant.stockQuantity + item.quantity;
          await tx.productVariant.update({ where: { id: item.variantId }, data: { stockQuantity: newStock } });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              type: "RETURN",
              quantity: item.quantity,
              previousStock: variant.stockQuantity,
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

      await tx.order.update({
        where: { id: orderId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason ?? null },
      });

      let creditNote = null;
      if (wasSold && order.payment.invoice) {
        creditNote = await issueCreditNote(tx, {
          invoiceId: order.payment.invoice.id,
          reason: reason ?? "Commande annulée",
          totalInclVat: Number(order.payment.paidAmount),
        });
      }

      return { creditNote };
    });

    if (wasSold && order.payment.transactionReference) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.payment.transactionReference);
        if (session.payment_intent) {
          await stripe.refunds.create({ payment_intent: session.payment_intent });
        }
      } catch (err) {
        // The order is already cancelled and stock restored — surface the
        // refund failure loudly rather than rolling any of that back.
        console.error("[performOrderCancellation] REFUND FAILED for order", orderId, err);
      }
    }

    let creditNotePdf = null;
    if (creditNote) {
      creditNotePdf = await renderCreditNotePdf(creditNote, order.payment.invoice).catch((err) => {
        console.error("[performOrderCancellation] credit note PDF render failed:", err);
        return null;
      });
    }

    sendEmail({
      to: order.user.email,
      subject: `Commande annulée – n°${order.orderNumber} – Meri Beauty`,
      text:
        `Bonjour ${order.user.fullName},\n\n` +
        `Votre commande n°${order.orderNumber} a été annulée.` +
        (wasSold ? " Le remboursement apparaîtra sur votre compte sous quelques jours." : "") +
        (reason ? ` Raison : ${reason}` : "") +
        `\n\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${order.user.fullName},</p>` +
        `<p>Votre commande n°${order.orderNumber} a été annulée.` +
        (wasSold ? " Le remboursement apparaîtra sur votre compte sous quelques jours." : "") +
        (reason ? ` Raison : ${reason}` : "") +
        `</p><p>L'équipe Meri Beauty</p>`,
      ...(creditNotePdf
        ? { attachments: [{ filename: `note-de-credit-${creditNote.number}.pdf`, content: creditNotePdf }] }
        : {}),
    }).catch((err) => console.error("[performOrderCancellation] email failed:", err));

    revalidatePath("/dashboard/boutique/orders");
    revalidatePath("/mon-compte");
    return { success: true, message: "Commande annulée." };
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
  const { orderId, reason } = parsed.data;

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

  return performOrderCancellation(order, reason);
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

  return performOrderCancellation(order, "Annulée par le client");
}

// ─── Cron-ready ─────────────────────────────────────────────────────────────────

/**
 * For the future /api/cron job runner, not called from the UI: releases
 * abandoned PENDING_PAYMENT checkouts (short window) and un-collected
 * PICKUP_ON_SITE orders (7-day window per the locked policy — prepaid
 * pickups never auto-expire, the customer already paid).
 */
export async function expireStaleOrders() {
  const now = new Date();
  const stale = await prisma.order.findMany({
    where: {
      expiresAt: { lt: now },
      OR: [
        { status: "PENDING_PAYMENT" },
        { fulfilmentMode: "PICKUP_ON_SITE", status: { in: ["PENDING_PICKUP", "READY_FOR_PICKUP"] } },
      ],
    },
    include: { items: true, user: { select: { fullName: true, email: true } } },
  });

  let expiredCount = 0;

  for (const order of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: order.status === "PENDING_PAYMENT" ? "CANCELLED" : "EXPIRED",
            cancelledAt: order.status === "PENDING_PAYMENT" ? new Date() : null,
            cancelReason: order.status === "PENDING_PAYMENT" ? "Paiement non complété" : null,
          },
        });
      });

      sendEmail({
        to: order.user.email,
        subject: `Commande expirée – n°${order.orderNumber} – Meri Beauty`,
        text:
          `Bonjour ${order.user.fullName},\n\n` +
          `Votre commande n°${order.orderNumber} a expiré et a été annulée. ` +
          `Les articles ont été remis en stock — vous pouvez repasser commande à tout moment.\n\n` +
          `L'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${order.user.fullName},</p>` +
          `<p>Votre commande n°${order.orderNumber} a expiré et a été annulée. ` +
          `Les articles ont été remis en stock — vous pouvez repasser commande à tout moment.</p>` +
          `<p>L'équipe Meri Beauty</p>`,
      }).catch((err) => console.error("[expireStaleOrders] email failed:", err));

      expiredCount += 1;
    } catch (error) {
      console.error("[expireStaleOrders] failed for order", order.id, error);
    }
  }

  return { success: true, expiredCount };
}
