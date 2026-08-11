"use server";

import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { pointOfSaleSaleSchema } from "@/lib/validations/point-of-sale";
import { issueInvoice } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { formatUserAddress } from "@/lib/format-address";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";
import { BELGIUM_VAT_RATE, calculateVatTotals } from "@/lib/tax-policy";

const BCRYPT_SALT_ROUNDS = 12;

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
  };
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
      select: { id: true, fullName: true, email: true, phone: true },
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

  const { customer: requestedCustomer, items, method } = parsed.data;
  const groupedItems = new Map();
  for (const item of items) {
    groupedItems.set(item.variantId, (groupedItems.get(item.variantId) ?? 0) + item.quantity);
  }
  const placeholderPassword = await bcrypt.hash(randomBytes(18).toString("base64url"), BCRYPT_SALT_ROUNDS);

  try {
    const result = await prisma.$transaction(async (tx) => {
      let customer = requestedCustomer.id
        ? await tx.user.findFirst({ where: { id: requestedCustomer.id, role: "CUSTOMER", isDeleted: false } })
        : await tx.user.findFirst({ where: { email: requestedCustomer.email, role: "CUSTOMER", isDeleted: false } });

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
          },
        });
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

      const subtotal = saleItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
      const taxTotals = calculateVatTotals(subtotal, BELGIUM_VAT_RATE);
      const order = await tx.order.create({
        data: {
          userId: customer.id,
          fulfilmentMode: "PICKUP_ON_SITE",
          status: "COMPLETED",
          subtotal,
          shippingCost: 0,
          totalAmount: subtotal,
          taxCountryCode: "BE",
          vatTreatment: "DOMESTIC",
          vatRate: BELGIUM_VAT_RATE,
          totalExclVat: taxTotals.totalExclVat,
          totalVat: taxTotals.vatAmount,
          customerVatNumber: customer.vatNumber ?? null,
          pickedUpAt: new Date(),
          pickedUpByStaffId: guard.session.user.id,
          notes: "Vente directe en magasin",
          items: {
            create: saleItems.map((item) => ({
              variantId: item.id,
              productName: item.product.name,
              variantName: item.name,
              sku: item.sku,
              unitPrice: item.price,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });

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
      await tx.transaction.create({
        data: { paymentId: payment.id, amount: subtotal, method, transactionType: "FINAL_PAYMENT", paidAt: new Date() },
      });

      const invoice = await issueInvoice(tx, {
        paymentId: payment.id,
        source: "ORDER",
        totalInclVat: subtotal,
        customer: {
          fullName: customer.fullName,
          email: customer.email,
          vatNumber: customer.vatNumber,
          address: formatUserAddress(customer),
        },
        lines: saleItems.map((item) => ({ description: `${item.product.name} — ${item.name}`, quantity: item.quantity, unitPrice: Number(item.price) })),
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
          metadata: { orderNumber: order.orderNumber, customerId: customer.id, itemCount: saleItems.length },
        },
      });

      return { order, invoice, customer };
    });

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
    if (error.message === "POS_PRODUCT_UNAVAILABLE") return { success: false, message: "Un produit du panier n'est plus disponible." };
    if (typeof error.message === "string" && error.message.startsWith("POS_STOCK_UNAVAILABLE:")) {
      return { success: false, message: `Stock insuffisant pour ${error.message.slice("POS_STOCK_UNAVAILABLE:".length)}.` };
    }
    if (error.code === "P2002") return { success: false, message: "Ce client vient d'être créé. Recherchez-le puis réessayez." };
    console.error("[completePointOfSaleSale]", error);
    captureError(error, { area: "point-of-sale" });
    return { success: false, message: "Impossible d'enregistrer la vente." };
  }
}
