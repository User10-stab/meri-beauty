"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import {
  returnRequestReceivedEmail,
  returnApprovedEmail,
  returnCompletedEmail,
} from "@/lib/email-templates";
import { DASHBOARD_PERMISSIONS, hasPermission } from "@/lib/authorization";
import { lookupOrderForReturnSchema, requestReturnSchema, returnActionSchema } from "@/lib/validations/commerce";
import { issueCreditNote } from "@/lib/invoicing";
import { renderCreditNotePdf } from "@/lib/pdf/render";

/**
 * Belgian/EU 14-day right of withdrawal.
 *
 * Customer side is deliberately account-free: order number + the email on
 * the order is the whole identity check, since there's no customer
 * order-history page yet (see actions/invoicing.js note on scope). Staff
 * side reuses the same ORDERS permission as the rest of order fulfilment —
 * this is the same day-to-day counter work, not a separate admin area.
 *
 * Withdrawal window: starts at pickup (pickedUpAt) or shipping (shippedAt —
 * a proxy for delivery, since bpost tracking isn't integrated; the +3 day
 * grace on top of the legal 14 covers typical transit time so the window
 * never closes before the customer could plausibly have received the
 * parcel). Partial returns are supported: an order can have several
 * ReturnRequests over time as long as the total requested quantity per
 * item never exceeds what was bought.
 */

const WITHDRAWAL_DAYS_PICKUP = 14;
const WITHDRAWAL_DAYS_SHIPPING = 14 + 3; // + transit grace, no delivery-confirmation webhook

async function requireOrdersAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.ORDERS)) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

function withdrawalWindow(order) {
  const start = order.pickedUpAt ?? order.shippedAt;
  if (!start) return null;
  const days = order.fulfilmentMode === "SHIPPING_PREPAID" ? WITHDRAWAL_DAYS_SHIPPING : WITHDRAWAL_DAYS_PICKUP;
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return { start, end };
}

/** Quantity per orderItem already covered by a non-rejected return request. */
function claimedQuantities(order) {
  const claimed = new Map();
  for (const rr of order.returnRequests) {
    if (rr.status === "REJECTED") continue;
    for (const item of rr.items) {
      claimed.set(item.orderItemId, (claimed.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  return claimed;
}

function serializeReturnRequest(rr) {
  return {
    id: rr.id,
    status: rr.status,
    reason: rr.reason,
    requestedAt: rr.requestedAt,
    processedAt: rr.processedAt,
    staffNote: rr.staffNote,
    creditNoteId: rr.creditNoteId,
    order: rr.order
      ? {
          id: rr.order.id,
          orderNumber: rr.order.orderNumber,
          user: rr.order.user
            ? { fullName: rr.order.user.fullName, email: rr.order.user.email }
            : null,
        }
      : undefined,
    items: rr.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      productName: item.orderItem?.productName,
      variantName: item.orderItem?.variantName,
      unitPrice: item.orderItem ? Number(item.orderItem.unitPrice) : null,
    })),
  };
}

// ─── Customer: lookup + request ────────────────────────────────────────────────

/**
 * Looks up an order by number + the email it was placed under, and reports
 * withdrawal eligibility + remaining returnable quantity per item. Never
 * reveals whether an email/order combination doesn't match (generic
 * "introuvable" message) — this is a public, unauthenticated lookup.
 */
export async function getReturnableOrder(input) {
  const parsed = lookupOrderForReturnSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Numéro de commande ou e-mail invalide." };
  }
  const { orderNumber, email } = parsed.data;

  try {
    const order = await prisma.order.findFirst({
      where: { orderNumber, user: { email: email.trim().toLowerCase() } },
      include: {
        user: { select: { fullName: true, email: true } },
        items: true,
        returnRequests: { include: { items: true } },
      },
    });

    if (!order) {
      return { success: false, message: "Aucune commande ne correspond à ce numéro et cet e-mail." };
    }
    if (order.status !== "COMPLETED") {
      return { success: false, message: "Cette commande n'est pas encore finalisée — pas de retour possible pour le moment." };
    }

    const window = withdrawalWindow(order);
    if (!window || new Date() > window.end) {
      return {
        success: false,
        message: "Le délai de rétractation de 14 jours pour cette commande est dépassé.",
      };
    }

    const claimed = claimedQuantities(order);
    const items = order.items
      .map((item) => ({
        id: item.id,
        productName: item.productName,
        variantName: item.variantName,
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
        remaining: item.quantity - (claimed.get(item.id) ?? 0),
      }))
      .filter((item) => item.remaining > 0);

    if (items.length === 0) {
      return { success: false, message: "Tous les articles de cette commande ont déjà fait l'objet d'une demande de retour." };
    }

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        deadline: window.end,
        items,
      },
    };
  } catch (error) {
    console.error("[getReturnableOrder]", error);
    return { success: false, message: "Impossible de vérifier cette commande." };
  }
}

/** Creates a REQUESTED return — same identity check as getReturnableOrder. */
export async function requestReturn(input) {
  const parsed = requestReturnSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: errors.reason?.[0] ?? errors.items?.[0] ?? errors.orderNumber?.[0] ?? errors.email?.[0] ?? "Données invalides.",
    };
  }
  const { orderNumber, email, reason, items } = parsed.data;

  try {
    const order = await prisma.order.findFirst({
      where: { orderNumber, user: { email: email.trim().toLowerCase() } },
      include: { user: true, items: true, returnRequests: { include: { items: true } } },
    });
    if (!order) return { success: false, message: "Aucune commande ne correspond à ce numéro et cet e-mail." };
    if (order.status !== "COMPLETED") {
      return { success: false, message: "Cette commande n'est pas encore finalisée — pas de retour possible pour le moment." };
    }

    const window = withdrawalWindow(order);
    if (!window || new Date() > window.end) {
      return { success: false, message: "Le délai de rétractation de 14 jours pour cette commande est dépassé." };
    }

    const claimed = claimedQuantities(order);
    for (const requested of items) {
      const orderItem = order.items.find((i) => i.id === requested.orderItemId);
      if (!orderItem) return { success: false, message: "Article introuvable sur cette commande." };
      const remaining = orderItem.quantity - (claimed.get(orderItem.id) ?? 0);
      if (requested.quantity > remaining) {
        return {
          success: false,
          message: `Quantité invalide pour "${orderItem.productName}" — ${remaining} disponible(s) au retour.`,
        };
      }
    }

    const returnRequest = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        reason,
        items: { create: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
      },
      include: { items: { include: { orderItem: true } } },
    });

    const itemsSummary = returnRequest.items
      .map((i) => `- ${i.orderItem.productName} (${i.orderItem.variantName}) × ${i.quantity}`)
      .join("\n");

    sendEmail({
      to: order.user.email,
      ...returnRequestReceivedEmail({ customerName: order.user.fullName, orderNumber: order.orderNumber, itemsSummary }),
    }).catch((err) => console.error("[requestReturn] email failed:", err));

    revalidatePath("/dashboard/boutique/returns");
    return { success: true, message: "Votre demande de retour a été envoyée." };
  } catch (error) {
    console.error("[requestReturn]", error);
    return { success: false, message: "Impossible d'enregistrer la demande de retour." };
  }
}

// ─── Dashboard: read ────────────────────────────────────────────────────────────

export async function listReturnRequests({ status } = {}) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  try {
    const requests = await prisma.returnRequest.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: "desc" },
      include: {
        order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true } } } },
        items: { include: { orderItem: true } },
      },
    });
    return { success: true, data: requests.map(serializeReturnRequest) };
  } catch (error) {
    console.error("[listReturnRequests]", error);
    return { success: false, message: "Impossible de charger les demandes de retour.", data: [] };
  }
}

export async function getReturnRequestById(id) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };
  if (!id) return { success: false, message: "Identifiant manquant." };

  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, orderNumber: true, user: { select: { fullName: true, email: true } } } },
        items: { include: { orderItem: true } },
      },
    });
    if (!rr) return { success: false, message: "Demande de retour introuvable." };
    return { success: true, data: serializeReturnRequest(rr) };
  } catch (error) {
    console.error("[getReturnRequestById]", error);
    return { success: false, message: "Impossible de charger la demande de retour." };
  }
}

// ─── Dashboard: actions ─────────────────────────────────────────────────────────

export async function approveReturnRequest(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = returnActionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Données invalides." };
  const { returnRequestId, staffNote } = parsed.data;

  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { order: { include: { user: true } } },
    });
    if (!rr) return { success: false, message: "Demande de retour introuvable." };
    if (rr.status !== "REQUESTED") return { success: false, message: "Cette demande a déjà été traitée." };

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: "APPROVED", staffNote: staffNote ?? null, processedAt: new Date(), processedByStaffId: guard.session.user.id },
    });

    const instructions =
      rr.order.fulfilmentMode === "SHIPPING_PREPAID"
        ? "Merci de nous renvoyer le(s) article(s) à l'adresse du salon, ou de les déposer directement en boutique."
        : "Merci de rapporter le(s) article(s) en boutique pour finaliser le retour.";

    sendEmail({
      to: rr.order.user.email,
      ...returnApprovedEmail({ customerName: rr.order.user.fullName, orderNumber: rr.order.orderNumber, instructions }),
    }).catch((err) => console.error("[approveReturnRequest] email failed:", err));

    revalidatePath("/dashboard/boutique/returns");
    return { success: true, message: "Demande de retour approuvée." };
  } catch (error) {
    console.error("[approveReturnRequest]", error);
    return { success: false, message: "Impossible d'approuver cette demande." };
  }
}

export async function rejectReturnRequest(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = returnActionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Données invalides." };
  const { returnRequestId, staffNote } = parsed.data;

  try {
    const rr = await prisma.returnRequest.findUnique({ where: { id: returnRequestId } });
    if (!rr) return { success: false, message: "Demande de retour introuvable." };
    if (!["REQUESTED", "APPROVED"].includes(rr.status)) {
      return { success: false, message: "Cette demande ne peut plus être refusée." };
    }

    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: "REJECTED", staffNote: staffNote ?? null, processedAt: new Date(), processedByStaffId: guard.session.user.id },
    });

    revalidatePath("/dashboard/boutique/returns");
    return { success: true, message: "Demande de retour refusée." };
  } catch (error) {
    console.error("[rejectReturnRequest]", error);
    return { success: false, message: "Impossible de refuser cette demande." };
  }
}

/**
 * Staff confirms the item(s) are physically back: restocks, issues a credit
 * note against the order's invoice, and refunds — Stripe if the order was
 * paid online, otherwise it's a cash/card reimbursement handled at the
 * counter (nothing further for this action to do about the money itself).
 * Shipping is only refunded if this completion returns every remaining
 * item on the order — a partial return never touches the delivery fee.
 */
export async function completeReturnRequest(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = returnActionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Données invalides." };
  const { returnRequestId, staffNote } = parsed.data;

  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: {
        items: { include: { orderItem: true } },
        order: {
          include: {
            items: true,
            payment: { include: { invoice: true } },
            user: true,
            returnRequests: { include: { items: true } },
          },
        },
      },
    });
    if (!rr) return { success: false, message: "Demande de retour introuvable." };
    if (rr.status !== "APPROVED") return { success: false, message: "Cette demande doit d'abord être approuvée." };
    if (!rr.order.payment?.invoice) {
      return { success: false, message: "Aucune facture n'est associée à cette commande — impossible d'émettre une note de crédit." };
    }

    const refundAmount = rr.items.reduce((sum, i) => sum + Number(i.orderItem.unitPrice) * i.quantity, 0);

    // Is every unit of the order now returned (across all non-rejected requests, including this one)?
    const claimed = new Map();
    for (const other of rr.order.returnRequests) {
      if (other.status === "REJECTED") continue;
      const effectiveStatus = other.id === rr.id ? "COMPLETED" : other.status;
      if (effectiveStatus === "REQUESTED") continue; // not yet committed
      for (const item of other.items) {
        claimed.set(item.orderItemId, (claimed.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    const fullyReturned = rr.order.items.every((oi) => (claimed.get(oi.id) ?? 0) >= oi.quantity);
    const shippingRefund = fullyReturned ? Number(rr.order.shippingCost) : 0;
    const totalRefund = refundAmount + shippingRefund;

    const { creditNote } = await prisma.$transaction(async (tx) => {
      for (const item of rr.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.orderItem.variantId },
          select: { stockQuantity: true },
        });
        const newStock = variant.stockQuantity + item.quantity;
        await tx.productVariant.update({ where: { id: item.orderItem.variantId }, data: { stockQuantity: newStock } });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.orderItem.variantId,
            type: "RETURN",
            quantity: item.quantity,
            previousStock: variant.stockQuantity,
            newStock,
            reason: `Retour — commande n°${rr.order.orderNumber}`,
          },
        });
      }

      const creditNote = await issueCreditNote(tx, {
        invoiceId: rr.order.payment.invoice.id,
        reason: rr.reason,
        totalInclVat: totalRefund,
      });

      await tx.returnRequest.update({
        where: { id: rr.id },
        data: {
          status: "COMPLETED",
          staffNote: staffNote ?? rr.staffNote,
          processedAt: new Date(),
          processedByStaffId: guard.session.user.id,
          creditNoteId: creditNote.id,
        },
      });

      return { creditNote };
    });

    if (rr.order.payment.transactionReference) {
      try {
        const session = await stripe.checkout.sessions.retrieve(rr.order.payment.transactionReference);
        if (session.payment_intent) {
          await stripe.refunds.create({ payment_intent: session.payment_intent, amount: Math.round(totalRefund * 100) });
        }
      } catch (err) {
        console.error("[completeReturnRequest] REFUND FAILED for return", rr.id, err);
      }
    }

    const creditNotePdf = await renderCreditNotePdf(creditNote, rr.order.payment.invoice).catch((err) => {
      console.error("[completeReturnRequest] credit note PDF render failed:", err);
      return null;
    });

    sendEmail({
      to: rr.order.user.email,
      ...returnCompletedEmail({ customerName: rr.order.user.fullName, orderNumber: rr.order.orderNumber, refundAmount: totalRefund }),
      ...(creditNotePdf ? { attachments: [{ filename: `note-de-credit-${creditNote.number}.pdf`, content: creditNotePdf }] } : {}),
    }).catch((err) => console.error("[completeReturnRequest] email failed:", err));

    revalidatePath("/dashboard/boutique/returns");
    return { success: true, message: `Retour finalisé — €${totalRefund.toFixed(2)} remboursé(s).` };
  } catch (error) {
    console.error("[completeReturnRequest]", error);
    return { success: false, message: "Impossible de finaliser ce retour." };
  }
}
