"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS, isAdminRole } from "@/lib/authorization";
import { pointOfSaleSaleSchema } from "@/lib/validations/point-of-sale";
import { issueInvoice, buildInvoiceCustomer } from "@/lib/invoicing";
import { renderInvoicePdf, renderTicketPdf } from "@/lib/pdf/render";
import { formatSalonAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";
import { BELGIUM_VAT_RATE, calculateVatTotals } from "@/lib/tax-policy";
import { stripe } from "@/lib/stripe";
import { getAppBaseUrl } from "@/lib/site-url";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";

const BCRYPT_SALT_ROUNDS = 12;
const POS_CHECKOUT_SECONDS = 31 * 60;

async function requirePointOfSaleAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
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
  };
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
        addressPostalCode: true, addressCountry: true,
      },
    });
    return { success: true, data: customers.map(serializeCustomer) };
  } catch (error) {
    console.error("[searchPointOfSaleCustomers]", error);
    return { success: false, message: "Impossible de rechercher le client.", data: [] };
  }
}

/** Resolves an EAN/UPC for the counter without exposing cost or margin. */
export async function getPointOfSaleProductByBarcode(barcode) {
  const guard = await requirePointOfSaleAccess();
  if (guard.error) return { success: false, message: guard.error };

  const code = barcode?.trim();
  if (!code) return { success: false, message: "Code-barres vide." };

  try {
    const variant = await prisma.productVariant.findFirst({
      where: {
        barcode: code,
        isActive: true,
        isDeleted: false,
        product: { isDeleted: false, status: "ACTIVE" },
      },
      select: {
        id: true,
        name: true,
        price: true,
        stockQuantity: true,
        reservedQuantity: true,
        product: { select: { name: true } },
      },
    });
    if (!variant) return { success: false, message: "Aucun produit actif ne correspond à ce code-barres." };

    return {
      success: true,
      data: {
        variantId: variant.id,
        productName: variant.product.name,
        variantName: variant.name,
        unitPrice: Number(variant.price),
        availableQuantity: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
      },
    };
  } catch (error) {
    console.error("[getPointOfSaleProductByBarcode]", error);
    return { success: false, message: "Impossible de lire ce produit." };
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

  const parsed = pointOfSaleSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Données de caisse invalides." };
  }

  const { customer: requestedCustomer, items, method, attemptKey, terminalReference, cashReceived } = parsed.data;
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
  const serviceLines = items.filter((item) => item.type === "SERVICE");
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
        customer = requestedCustomer.id
          ? await tx.user.findFirst({ where: { id: requestedCustomer.id, role: "CUSTOMER", isDeleted: false }, include: billingProfileInclude })
          : await tx.user.findFirst({ where: { email: requestedCustomer.email, role: "CUSTOMER", isDeleted: false }, include: billingProfileInclude });

        // Only require the address when the resolved customer doesn't already
        // have one on file — a returning customer shouldn't have to re-enter
        // their billing address on every counter sale. New/incomplete
        // customers do need it: invoices are mandatory-address for every
        // named-customer account (see lib/format-address.js) — a walk-in
        // sale skips this entirely since it never creates an account.
        const needsAddress = !customer?.addressLine1;
        if (needsAddress && (!requestedCustomer.addressLine1 || !requestedCustomer.addressCity || !requestedCustomer.addressPostalCode)) {
          throw new Error("POS_ADDRESS_REQUIRED");
        }

        const addressData = needsAddress
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
        } else if (needsAddress) {
          customer = await tx.user.update({ where: { id: customer.id }, data: addressData });
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
          select: { id: true, name: true, sku: true, price: true, stockQuantity: true, reservedQuantity: true, product: { select: { name: true } } },
        });
        if (!variant) throw new Error("POS_PRODUCT_UNAVAILABLE");
        const available = variant.stockQuantity - variant.reservedQuantity;
        if (quantity > available) throw new Error(`POS_STOCK_UNAVAILABLE:${variant.product.name}`);
        saleItems.push({ ...variant, quantity, available });
      }

      const productSubtotal = saleItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
      const serviceSubtotal = serviceLines.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
      const subtotal = productSubtotal + serviceSubtotal;
      if (method === "CASH" && cashReceived < subtotal) {
        throw new Error("POS_CASH_INSUFFICIENT");
      }
      const changeGiven = method === "CASH" ? Math.round((cashReceived - subtotal) * 100) / 100 : null;
      const taxTotals = calculateVatTotals(subtotal, BELGIUM_VAT_RATE);
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
          totalAmount: subtotal,
          taxCountryCode: "BE",
          vatTreatment: "DOMESTIC",
          vatRate: BELGIUM_VAT_RATE,
          totalExclVat: taxTotals.totalExclVat,
          totalVat: taxTotals.vatAmount,
          customerVatNumber: customer?.vatNumber ?? null,
          pickedUpAt: isQrPayment ? null : new Date(),
          pickedUpByStaffId: isQrPayment ? null : guard.session.user.id,
          expiresAt: isQrPayment ? new Date(Date.now() + (POS_CHECKOUT_SECONDS + 4 * 60) * 1000) : null,
          notes: isQrPayment
            ? "Vente en magasin — paiement Stripe QR"
            : isWalkIn
            ? "Vente directe en magasin — client de passage"
            : "Vente directe en magasin",
          items: {
            create: [
              ...saleItems.map((item) => ({
                variantId: item.id,
                productName: item.product.name,
                variantName: item.name,
                sku: item.sku,
                unitPrice: item.price,
                quantity: item.quantity,
              })),
              ...serviceLines.map((item) => ({
                productName: item.description,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
              })),
            ],
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
            after: { status: "PENDING_PAYMENT", totalAmount: subtotal, paymentMethod: "CARD_QR" },
            metadata: { orderNumber: order.orderNumber, customerId: customer.id, attemptKey },
          },
        });
        return { order, customer, invoice: null, qrPayment: true };
      }

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          totalAmount: subtotal,
          paidAmount: subtotal,
          remainingAmount: 0,
          paymentType: "ON_SITE",
          status: "PAID",
          paidAt: new Date(),
        },
      });
      // Attached to whichever till session is currently open, if any — never
      // blocks the sale if none is (see actions/dashboard/cash-sessions.js),
      // just leaves it unassigned for manual reconciliation.
      const openCashSession =
        method === "CASH" ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } }) : null;
      await tx.transaction.create({
        data: {
          paymentId: payment.id,
          amount: subtotal,
          method: method === "CASH" ? "CASH" : "CARD",
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
          // Terminal ticket reference — the only record tying this sale to an
          // actual approved charge on the external card terminal.
          manualReference: method === "EXTERNAL_TERMINAL" ? terminalReference.trim() : null,
          cashReceived: method === "CASH" ? cashReceived : null,
          changeGiven: method === "CASH" ? changeGiven : null,
          cashSessionId: openCashSession?.id ?? null,
        },
      });

      // A walk-in sale has no customer identity for an Invoice's non-null
      // customerName/customerEmail — a simplified ticket is rendered after
      // the transaction instead (see renderTicketPdf below), from the order
      // rows just created.
      const invoice = isWalkIn
        ? null
        : await issueInvoice(tx, {
            paymentId: payment.id,
            source: "ORDER",
            totalInclVat: subtotal,
            customer: buildInvoiceCustomer(customer),
            lines: [
              ...saleItems.map((item) => ({ description: `${item.product.name} — ${item.name}`, quantity: item.quantity, unitPrice: Number(item.price) })),
              ...serviceLines.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice })),
            ],
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
          after: { status: "COMPLETED", totalAmount: subtotal, paymentMethod: method },
          metadata: {
            orderNumber: order.orderNumber,
            customerId: customer?.id ?? null,
            itemCount: saleItems.length,
            ...(method === "EXTERNAL_TERMINAL" ? { terminalReference: terminalReference.trim() } : {}),
          },
        },
      });

      return { order, invoice, customer };
    });

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
      // No email to send it to — the ticket is handed back to the cashier
      // to print/download instead of being attached to a receipt e-mail.
      const salon = await prisma.salon.findUnique({
        where: { id: "main-salon" },
        select: { legalName: true, vatNumber: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, countryCode: true },
      });
      const ticketPdf = await renderTicketPdf({
        orderNumber: result.order.orderNumber,
        issuedAt: result.order.createdAt,
        sellerName: salon?.legalName || "Meri Beauty",
        sellerAddress: formatSalonAddress(salon),
        sellerVatNumber: salon?.vatNumber ?? null,
        subtotalExclVat: result.order.totalExclVat,
        vatRate: result.order.vatRate,
        vatAmount: result.order.totalVat,
        totalInclVat: result.order.totalAmount,
        lines: result.order.items.map((item) => ({ description: item.productName, quantity: item.quantity, unitPrice: Number(item.unitPrice) })),
      }).catch((error) => {
        captureError(error, { area: "point-of-sale", orderId: result.order.id, context: "ticket-pdf" });
        return null;
      });

      revalidatePath("/dashboard/boutique/orders");
      revalidatePath("/dashboard/boutique/stock");
      return {
        success: true,
        data: {
          orderId: result.order.id,
          orderNumber: result.order.orderNumber,
          walkIn: true,
          ticketPdfBase64: ticketPdf ? ticketPdf.toString("base64") : null,
        },
      };
    }

    const invoicePdf = await renderInvoicePdf(result.invoice).catch((error) => {
      captureError(error, { area: "point-of-sale", orderId: result.order.id, context: "invoice-pdf" });
      return null;
    });
    const receiptEmail = {
      to: result.customer.email,
      subject: `Merci pour votre achat — Commande n°${result.order.orderNumber} — Meri Beauty`,
      text: `Bonjour ${result.customer.fullName},\n\nMerci pour votre achat en magasin. Votre facture pour la commande n°${result.order.orderNumber} (${Number(result.order.totalAmount).toFixed(2)} €) est jointe à cet e-mail.\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${result.customer.fullName},</p><p>Merci pour votre achat en magasin.</p><p>Votre facture pour la commande n°${result.order.orderNumber} (<strong>${Number(result.order.totalAmount).toFixed(2)} €</strong>) est jointe à cet e-mail.</p><p>L'équipe Meri Beauty</p>`,
      ...(invoicePdf ? { attachments: [{ filename: `facture-${result.invoice.number}.pdf`, content: invoicePdf }] } : {}),
    };
    let emailResult = await sendEmail(receiptEmail);
    // One immediate retry covers a transient SMTP/API failure without ever
    // rolling back a real cash/card sale that was already collected.
    if (!emailResult?.success) emailResult = await sendEmail(receiptEmail);
    if (!emailResult?.success) {
      captureError(new Error(emailResult?.error || "POS receipt email failed"), {
        area: "point-of-sale",
        orderId: result.order.id,
        context: "receipt-email",
      });
    }

    revalidatePath("/dashboard/boutique/orders");
    revalidatePath("/dashboard/boutique/stock");
    return {
      success: true,
      data: {
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
        receiptEmailSent: Boolean(emailResult?.success),
      },
    };
  } catch (error) {
    if (error.message === "SELLER_LEGAL_DATA_INCOMPLETE") {
      return { success: false, message: "Identité légale du salon incomplète — complétez Réglages > Salon avant d'émettre des factures." };
    }
    if (error.message === "POS_CHECKOUT_RETRY_WINDOW_EXPIRED") {
      return { success: false, message: "Cette tentative QR est trop ancienne. Annulez-la puis recommencez." };
    }
    if (error.message === "POS_PRODUCT_UNAVAILABLE") return { success: false, message: "Un produit du panier n'est plus disponible." };
    if (typeof error.message === "string" && error.message.startsWith("POS_STOCK_UNAVAILABLE:")) {
      return { success: false, message: `Stock insuffisant pour ${error.message.slice("POS_STOCK_UNAVAILABLE:".length)}.` };
    }
    if (error.message === "POS_CASH_INSUFFICIENT") {
      return { success: false, message: "Le montant reçu est inférieur au total de la vente." };
    }
    if (error.message === "POS_ADDRESS_REQUIRED") {
      return {
        success: false,
        message: "L'adresse de facturation est obligatoire pour ce client.",
        errors: { addressLine1: "Obligatoire", addressCity: "Obligatoire", addressPostalCode: "Obligatoire" },
      };
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
    if (error.code === "P2002") return { success: false, message: "Ce client vient d'être créé. Recherchez-le puis réessayez." };
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
