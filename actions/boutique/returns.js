"use server";

import { revalidatePath } from "next/cache";
import { revalidateCaisseRoutes } from "@/lib/cash-book/revalidate-caisse";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { sendEmail } from "@/lib/email";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
import { isBusinessRefundCustomer } from "@/lib/refunds/document-policy";
import {
  returnRequestReceivedEmail,
  returnApprovedEmail,
  returnCompletedEmail,
  returnRejectedEmail,
} from "@/lib/email-templates";
import { STAFF_PERMISSIONS, hasDashboardPermission, isAdminRole } from "@/lib/authorization";
import {
  lookupOrderForReturnSchema,
  requestReturnSchema,
  returnActionSchema,
  completeReturnRequestSchema,
  rejectReturnRequestSchema,
} from "@/lib/validations/commerce";
import { issueCreditNote } from "@/lib/invoicing";
import { renderCreditNotePdf } from "@/lib/pdf/render";
import { allocatePieceNumber, PIECE_SERIES } from "@/lib/cash-book/piece-number";
import {
  getOrderPaymentMethod,
  isManualOrderRefund,
  manualRefundInstruction,
  refundMethodLabel,
  validateManualRefundConfirmation,
} from "@/lib/payments/refund-method";
import { allocateOrderDiscount } from "@/lib/orders/discount-allocation";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";

/**
 * Belgian/EU 14-day right of withdrawal.
 *
 * Customer side is deliberately account-free: order number + the email on
 * the order is the whole identity check, since there's no customer
 * order-history page yet. Staff side reuses the same ORDERS permission as
 * the rest of order fulfilment —
 * this is the same day-to-day counter work, not a separate admin area.
 *
 * Withdrawal window: starts at pickup (pickedUpAt, in-store collection) or,
 * for shipped orders, at collectedAt — the date staff confirm from the
 * Mondial Relay tracking portal that the customer actually collected the
 * parcel from the relay point, entered when the order is closed
 * (markOrderCompleted). That is the true legal trigger (SPF Économie: le
 * lendemain de la prise de possession réelle du bien), not shippedAt.
 *
 * Orders closed before collectedAt existed (or before staff started
 * recording it) have no confirmed collection date. For those, shippedAt is
 * used only as a wide, non-punitive estimate — never to auto-close the
 * window early, since we genuinely don't know when the customer received
 * the parcel. See bigbatch.txt P0 "Le délai de retour d'une livraison
 * commence trop tôt" — a shippedAt+17 estimate closed real cases days
 * before the actual 14-day-from-receipt deadline.
 *
 * Partial returns are supported: an order can have several ReturnRequests
 * over time as long as the total requested quantity per item never exceeds
 * what was bought.
 */

const WITHDRAWAL_DAYS = 14;
// Outer sanity bound for the shippedAt-only estimate (no confirmed
// collectedAt yet) — mirrors the EU rule that an incomplete withdrawal
// disclosure extends the window up to 12 months, rather than inventing an
// arbitrary shorter cutoff that could still reject a legitimate return.
const UNCONFIRMED_SHIPPING_ESTIMATE_DAYS = 365;

// The public lookup takes only orderNumber + email — no account, no
// CAPTCHA. Without a cap, either could be brute-forced: many order numbers
// against one IP, or one order number hammered from many IPs to guess the
// matching email. See bigbatch.txt P1 "Le formulaire public peut être
// abusé".
const RETURN_LOOKUP_IP_WINDOW_MS = 5 * 60 * 1000;
const RETURN_LOOKUP_IP_MAX = 10;
const RETURN_LOOKUP_ORDER_WINDOW_MS = 15 * 60 * 1000;
const RETURN_LOOKUP_ORDER_MAX = 10;
const RETURN_REQUEST_IP_WINDOW_MS = 10 * 60 * 1000;
const RETURN_REQUEST_IP_MAX = 5;

const RETURN_REASON_CATEGORY_LABEL = {
  CHANGED_MIND: "Changement d'avis",
  DEFECTIVE: "Produit défectueux",
  WRONG_ITEM: "Article incorrect",
  DAMAGED_IN_TRANSIT: "Endommagé pendant le transport",
  NOT_RECEIVED: "Colis non reçu",
  GOODWILL: "Geste commercial",
};

const RETURN_CONDITION_LABEL = {
  SEALED_RESELLABLE: "Scellé, revendable",
  OPENED_HYGIENE: "Descellé (exception hygiène)",
  DAMAGED: "Endommagé",
  DEFECTIVE: "Défectueux",
  WRONG_ITEM: "Mauvais article envoyé",
};

async function requireOrdersAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.RETURNS))) {
    return { error: "Accès non autorisé." };
  }
  return { session };
}

function withdrawalWindow(order) {
  const confirmedStart = order.pickedUpAt ?? order.collectedAt;
  if (confirmedStart) {
    const end = new Date(confirmedStart);
    end.setDate(end.getDate() + WITHDRAWAL_DAYS);
    return { start: confirmedStart, end, estimated: false };
  }
  if (order.fulfilmentMode === "SHIPPING_PREPAID" && order.shippedAt) {
    const end = new Date(order.shippedAt);
    end.setDate(end.getDate() + UNCONFIRMED_SHIPPING_ESTIMATE_DAYS);
    return { start: order.shippedAt, end, estimated: true };
  }
  return null;
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
  const paymentMethod = getOrderPaymentMethod(rr.order?.payment);
  return {
    id: rr.id,
    status: rr.status,
    reasonCategory: rr.reasonCategory,
    reasonCategoryLabel: RETURN_REASON_CATEGORY_LABEL[rr.reasonCategory] ?? rr.reasonCategory,
    reason: rr.reason,
    requestedAt: rr.requestedAt,
    processedAt: rr.processedAt,
    staffNote: rr.staffNote,
    creditNoteId: rr.creditNoteId,
    order: rr.order
      ? {
          id: rr.order.id,
          orderNumber: rr.order.orderNumber,
          paymentMethod,
          paymentMethodLabel: refundMethodLabel(paymentMethod),
          requiresManualRefund: isManualOrderRefund(rr.order.payment),
          refundInstruction: manualRefundInstruction(paymentMethod),
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
      condition: item.condition,
      conditionLabel: item.condition ? RETURN_CONDITION_LABEL[item.condition] : null,
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

  const ip = await getClientIp();
  if (
    isRateLimited("return-lookup-ip", ip, { windowMs: RETURN_LOOKUP_IP_WINDOW_MS, max: RETURN_LOOKUP_IP_MAX }) ||
    isRateLimited("return-lookup-order", String(orderNumber), { windowMs: RETURN_LOOKUP_ORDER_WINDOW_MS, max: RETURN_LOOKUP_ORDER_MAX })
  ) {
    return { success: false, message: "Trop de tentatives. Veuillez patienter avant de réessayer." };
  }
  recordRateLimitHit("return-lookup-ip", ip);
  recordRateLimitHit("return-lookup-order", String(orderNumber));

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

    // The 14-day withdrawal window only ever gates a CHANGED_MIND request —
    // a defective/wrong-item/damaged/not-received/goodwill claim isn't
    // bound by it at all (see requestReturn). The reason isn't chosen yet
    // at lookup time, so this step never hard-rejects on the window; it
    // only reports whether it has passed so the UI can steer the customer
    // toward the right reason. requestReturn is the authoritative gate.
    const window = withdrawalWindow(order);
    const withdrawalExpired = Boolean(window && !window.estimated && new Date() > window.end);

    const claimed = claimedQuantities(order);
    const items = order.items
      // POS ad-hoc service lines (variantId null) have no stock to return
      // to — they're a counter sale, not something to ship back.
      .filter((item) => item.variantId !== null)
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
        deadline: window && !window.estimated ? window.end : null,
        estimatedDeadline: Boolean(window?.estimated),
        withdrawalExpired,
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
      message:
        errors.reasonCategory?.[0] ?? errors.reason?.[0] ?? errors.items?.[0] ?? errors.orderNumber?.[0] ?? errors.email?.[0] ?? "Données invalides.",
    };
  }
  const { orderNumber, email, reasonCategory, reason, items } = parsed.data;

  const ip = await getClientIp();
  if (
    isRateLimited("return-request-ip", ip, { windowMs: RETURN_REQUEST_IP_WINDOW_MS, max: RETURN_REQUEST_IP_MAX }) ||
    isRateLimited("return-lookup-order", String(orderNumber), { windowMs: RETURN_LOOKUP_ORDER_WINDOW_MS, max: RETURN_LOOKUP_ORDER_MAX })
  ) {
    return { success: false, message: "Trop de tentatives. Veuillez patienter avant de réessayer." };
  }
  recordRateLimitHit("return-request-ip", ip);
  recordRateLimitHit("return-lookup-order", String(orderNumber));

  try {
    const order = await prisma.order.findFirst({
      where: { orderNumber, user: { email: email.trim().toLowerCase() } },
      include: { user: true, items: true, returnRequests: { include: { items: true } } },
    });
    if (!order) return { success: false, message: "Aucune commande ne correspond à ce numéro et cet e-mail." };
    if (order.status !== "COMPLETED") {
      return { success: false, message: "Cette commande n'est pas encore finalisée — pas de retour possible pour le moment." };
    }

    // The 14-day withdrawal window only governs a simple change of mind.
    // Defective goods carry the separate 2-year statutory guarantee; a
    // wrong/damaged/lost item or a goodwill exception aren't rétractation
    // claims at all — none of these are time-boxed by this check. See
    // bigbatch.txt P1 "Rétractation et produit défectueux sont confondus".
    if (reasonCategory === "CHANGED_MIND") {
      const window = withdrawalWindow(order);
      if (!window || (!window.estimated && new Date() > window.end)) {
        return {
          success: false,
          message:
            "Le délai de rétractation de 14 jours pour un changement d'avis est dépassé. " +
            "Pour un produit défectueux ou non conforme, vous restez couvert par la garantie légale — contactez le salon directement.",
        };
      }
    }

    // Serialize return-request creation per order: two concurrent requests
    // for the same item would otherwise both read the same "claimed" snapshot
    // before either commits, both pass the remaining-quantity check, and both
    // insert — over-claiming units that get double-refunded when staff later
    // completes both. Locking the order row (same FOR UPDATE pattern as
    // createOrderFromCart) and recomputing claimed quantities after
    // acquiring it closes that window.
    const { returnRequest, validationError } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;

      const freshOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: true, returnRequests: { include: { items: true } } },
      });
      const freshClaimed = claimedQuantities(freshOrder);

      // freshClaimed only accounts for *prior* return requests — two entries
      // for the same orderItemId within THIS submission would each be
      // checked against the same pre-existing remaining count independently
      // (e.g. two lines of 3 against 5 available, each individually "fits")
      // and together over-claim the item. Track what this submission itself
      // has already claimed as it validates each line.
      const claimedInThisRequest = new Map();

      for (const requested of items) {
        const orderItem = freshOrder.items.find((i) => i.id === requested.orderItemId);
        if (!orderItem) return { returnRequest: null, validationError: "Article introuvable sur cette commande." };
        const alreadyClaimed = (freshClaimed.get(orderItem.id) ?? 0) + (claimedInThisRequest.get(orderItem.id) ?? 0);
        const remaining = orderItem.quantity - alreadyClaimed;
        if (requested.quantity > remaining) {
          return {
            returnRequest: null,
            validationError: `Quantité invalide pour "${orderItem.productName}" — ${remaining} disponible(s) au retour.`,
          };
        }
        claimedInThisRequest.set(orderItem.id, (claimedInThisRequest.get(orderItem.id) ?? 0) + requested.quantity);
      }

      const created = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          reasonCategory,
          reason,
          items: { create: items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })) },
        },
        include: { items: { include: { orderItem: true } } },
      });

      return { returnRequest: created, validationError: null };
    });

    if (validationError) {
      return { success: false, message: validationError };
    }

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

const DEFAULT_RETURNS_PAGE_SIZE = 20;

export async function listReturnRequests({ status, search, page = 1, pageSize = DEFAULT_RETURNS_PAGE_SIZE } = {}) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error, data: [], totalCount: 0, page: 1, pageSize };

  try {
    const searchAsOrderNumber = search && /^\d+$/.test(search.trim()) ? Number(search.trim()) : null;

    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { order: { user: { fullName: { contains: search, mode: "insensitive" } } } },
              { order: { user: { email: { contains: search, mode: "insensitive" } } } },
              ...(searchAsOrderNumber !== null ? [{ order: { orderNumber: searchAsOrderNumber } }] : []),
            ],
          }
        : {}),
    };

    // Same issue as listOrders: this fetched every return request ever
    // filed with no limit. Paginate at the DB level instead.
    const [totalCount, requests] = await Promise.all([
      prisma.returnRequest.count({ where }),
      prisma.returnRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              user: { select: { fullName: true, email: true } },
              payment: { select: { transactionReference: true, transactions: { select: { method: true, transactionType: true } } } },
            },
          },
          items: { include: { orderItem: true } },
        },
      }),
    ]);
    return { success: true, data: requests.map(serializeReturnRequest), totalCount, page, pageSize };
  } catch (error) {
    console.error("[listReturnRequests]", error);
    return { success: false, message: "Impossible de charger les demandes de retour.", data: [], totalCount: 0, page, pageSize };
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
        order: {
          select: {
            id: true,
            orderNumber: true,
            user: { select: { fullName: true, email: true } },
            payment: { select: { transactionReference: true, transactions: { select: { method: true, transactionType: true } } } },
          },
        },
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

  const parsed = rejectReturnRequestSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.staffNote?.[0] ?? "Données invalides." };
  }
  const { returnRequestId, staffNote } = parsed.data;

  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { order: { include: { user: true } } },
    });
    if (!rr) return { success: false, message: "Demande de retour introuvable." };
    if (!["REQUESTED", "APPROVED"].includes(rr.status)) {
      return { success: false, message: "Cette demande ne peut plus être refusée." };
    }

    const decidedAt = new Date();
    await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: { status: "REJECTED", staffNote, processedAt: decidedAt, processedByStaffId: guard.session.user.id },
    });

    sendEmail({
      to: rr.order.user.email,
      ...returnRejectedEmail({ customerName: rr.order.user.fullName, orderNumber: rr.order.orderNumber, reason: staffNote, decidedAt }),
    }).catch((err) => console.error("[rejectReturnRequest] email failed:", err));

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
 * paid online, otherwise it requires an explicit confirmation that the
 * physical cash/card-terminal reimbursement has happened at the counter.
 * Shipping is only refunded if this completion returns every remaining
 * item on the order — a partial return never touches the delivery fee.
 */
export async function completeReturnRequest(input) {
  const guard = await requireOrdersAccess();
  if (guard.error) return { success: false, message: guard.error };
  // Completing a return always issues a refund — per policy, only
  // OWNER/ADMIN may do that. approveReturnRequest/rejectReturnRequest stay
  // STAFF-accessible since neither moves money.
  if (!isAdminRole(guard.session.user.role)) {
    return { success: false, message: "Seul un administrateur peut finaliser un retour (remboursement requis). Contactez un administrateur." };
  }

  const parsed = completeReturnRequestSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return { success: false, message: errors.itemConditions?.[0] ?? "Données invalides." };
  }
  const { returnRequestId, staffNote, manualRefundConfirmed, manualRefundReference, itemConditions } = parsed.data;

  try {
    const rr = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: {
        items: { include: { orderItem: true } },
        order: {
          include: {
            items: true,
            payment: { include: { invoice: true, transactions: true } },
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

    // Every physical line item must be inspected and classified before any
    // stock decision is made — see ReturnItemCondition. Reject rather than
    // default-guessing a condition for anything staff didn't explicitly set.
    const conditionByItemId = new Map(itemConditions.map((c) => [c.returnRequestItemId, c.condition]));
    for (const item of rr.items) {
      if (!conditionByItemId.has(item.id)) {
        return { success: false, message: "Indiquez l'état de chaque article retourné avant de finaliser." };
      }
    }

    const originalMethod = getOrderPaymentMethod(rr.order.payment);
    const manualConfirmationError = validateManualRefundConfirmation({
      method: originalMethod,
      confirmed: manualRefundConfirmed,
      reference: manualRefundReference,
    });
    if (manualConfirmationError) return { success: false, message: manualConfirmationError };

    // Net (post-discount) amount per order item, not the face-value
    // unitPrice — an order with a promo code paid less than the sticker
    // price per item, and refunding the sticker price on a partial return
    // both over-refunds this item and wrongly eats into the cap that a
    // later return of a different item on the same order needs. See
    // allocateOrderDiscount() / bigbatch.txt P0 "Les promotions rendent les
    // retours partiels incorrects".
    const netAmountByOrderItemId = allocateOrderDiscount(rr.order);
    const refundAmount = rr.items.reduce((sum, i) => {
      const netForFullQuantity = netAmountByOrderItemId.get(i.orderItemId) ?? Number(i.orderItem.unitPrice) * i.orderItem.quantity;
      const netUnitPrice = netForFullQuantity / i.orderItem.quantity;
      return sum + netUnitPrice * i.quantity;
    }, 0);

    // Is every unit of the order now returned? Only COMPLETED requests
    // (items physically confirmed back) count toward this — an APPROVED
    // request is just "cleared to return," not proof the item actually
    // came back, so counting it here could refund shipping before every
    // item is truly accounted for.
    const claimed = new Map();
    for (const other of rr.order.returnRequests) {
      const effectiveStatus = other.id === rr.id ? "COMPLETED" : other.status;
      if (effectiveStatus !== "COMPLETED") continue;
      for (const item of other.items) {
        claimed.set(item.orderItemId, (claimed.get(item.orderItemId) ?? 0) + item.quantity);
      }
    }
    const fullyReturned = rr.order.items.every((oi) => (claimed.get(oi.id) ?? 0) >= oi.quantity);
    const shippingRefund = fullyReturned ? Number(rr.order.shippingCost) : 0;
    const totalRefund = refundAmount + shippingRefund;
    const REFUND_EPSILON = 0.01;

    const manualRefund = isManualOrderRefund(rr.order.payment);
    const { creditNote, refundQueued } = await prisma.$transaction(async (tx) => {
      // Atomically claim this return: the WHERE clause only matches while
      // status is still APPROVED, so if two requests race here only one
      // update actually affects a row — the loser's count is 0 and it
      // aborts before ever touching stock, credit notes, or Stripe.
      const claim = await tx.returnRequest.updateMany({
        where: { id: rr.id, status: "APPROVED" },
        data: {
          status: "COMPLETED",
          staffNote: staffNote ?? rr.staffNote,
          processedAt: new Date(),
          processedByStaffId: guard.session.user.id,
        },
      });
      if (claim.count === 0) throw new Error("ALREADY_PROCESSED");

      // Lock the payment row so two return requests on the same order can't
      // both read "nothing refunded yet" and both slip under the cap.
      const lockedPayment = await tx.$queryRaw`SELECT status FROM "Payment" WHERE id = ${rr.order.payment.id} FOR UPDATE`;
      if (["REFUND_PENDING", "REFUND_FAILED"].includes(lockedPayment[0]?.status)) {
        // A prior refund on this same payment (this return or another one)
        // hasn't resolved yet — its exact pending amount lives in a single
        // pair of columns on Payment, so starting a second operation now
        // would overwrite it and strand that amount from ever being safely
        // retried. Must resolve (succeed or be manually reconciled) first.
        throw new Error("REFUND_ALREADY_PENDING");
      }
      const priorRefunds = await tx.transaction.aggregate({
        where: { paymentId: rr.order.payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      const paidAmount = Number(rr.order.payment.paidAmount);
      if (totalRefund + alreadyRefunded > paidAmount + REFUND_EPSILON) {
        throw new Error("REFUND_CAP_EXCEEDED");
      }

      // Only a sealed, resalable item goes back into vendable stock. Every
      // other condition is received into quarantine — recorded for audit,
      // but stockQuantity is left untouched — so an opened cosmetic, a
      // damaged item, or a supplier defect can never re-enter the shop
      // shelf without a separate, deliberate stock movement.
      for (const item of rr.items) {
        const condition = conditionByItemId.get(item.id);
        await tx.returnRequestItem.update({ where: { id: item.id }, data: { condition } });

        if (condition === "SEALED_RESELLABLE") {
          const updated = await tx.productVariant.update({
            where: { id: item.orderItem.variantId },
            data: { stockQuantity: { increment: item.quantity } },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.orderItem.variantId,
              type: "RETURN",
              quantity: item.quantity,
              previousStock: updated.stockQuantity - item.quantity,
              newStock: updated.stockQuantity,
              reason: `Retour — commande n°${rr.order.orderNumber} — scellé, remis en stock vendable`,
            },
          });
        } else {
          const variant = await tx.productVariant.findUniqueOrThrow({
            where: { id: item.orderItem.variantId },
            select: { stockQuantity: true },
          });
          await tx.inventoryMovement.create({
            data: {
              variantId: item.orderItem.variantId,
              type: "RETURN_QUARANTINE",
              quantity: item.quantity,
              previousStock: variant.stockQuantity,
              newStock: variant.stockQuantity,
              reason: `Retour — commande n°${rr.order.orderNumber} — état : ${RETURN_CONDITION_LABEL[condition]} — mis en quarantaine, non revendable`,
            },
          });
        }
      }

      const creditNote = await issueCreditNote(tx, {
        invoiceId: rr.order.payment.invoice.id,
        reason: rr.reason,
        totalInclVat: totalRefund,
      });

      await tx.returnRequest.update({ where: { id: rr.id }, data: { creditNoteId: creditNote.id } });

      if (manualRefund) {
        const newTotalRefunded = alreadyRefunded + totalRefund;
        const fullyRefunded = newTotalRefunded + REFUND_EPSILON >= paidAmount;
        // Attach to whichever till session is open so the counter cash is
        // reconcilable at close (see lib/cash-sessions.js). Never blocks the
        // refund if none is open — the row is simply left unassigned.
        const openCashSession =
          originalMethod === "CASH"
            ? await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } })
            : null;
        // A refund stays in the same series as its original sale — it's the
        // same order, just a sortie line instead of an entrée.
        const pieceNumber =
          originalMethod === "CASH" ? await allocatePieceNumber(tx, PIECE_SERIES.ORDER) : null;
        await tx.transaction.create({
          data: {
            paymentId: rr.order.payment.id,
            amount: totalRefund,
            method: originalMethod,
            transactionType: "REFUND",
            paidAt: new Date(),
            manualReference: originalMethod === "CARD" ? manualRefundReference.trim() : null,
            cashSessionId: openCashSession?.id ?? null,
            pieceNumber,
            creditNoteId: creditNote.id,
          },
        });
        await tx.payment.update({
          where: { id: rr.order.payment.id },
          data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
        });
      }

      // Confirmed policy (2026-09-02): the application never issues a Stripe
      // refund itself — every card refund is performed by hand in the
      // Stripe dashboard by an OWNER/ADMIN. This records what is owed as a
      // RefundOperation whose legs carry the precise amount and
      // payment_intent to refund against; it surfaces on
      // /dashboard/operations until someone has actually done it, and the
      // charge.refunded webhook settles it — mirrors rejectAppointment and
      // cancelWorkshopReservation/cancelFormationReservation.
      let refundQueued = false;
      if (!manualRefund) {
        const queued = await queueManualRefund(tx, {
          paymentId: rr.order.payment.id,
          source: "ORDER",
          trigger: "SHOP_RETURN",
          reason: rr.reason,
          amount: totalRefund,
          transactions: rr.order.payment.transactions,
          creditNoteId: creditNote.id,
          invoiceId: rr.order.payment.invoice.id,
          decidedByUserId: guard.session.user.id,
          returnRequestId: rr.id,
          customerIsBusiness: isBusinessRefundCustomer(rr.order.user),
        });
        refundQueued = Boolean(queued);
      }

      if (manualRefund) {
        await tx.auditLog.create({
          data: {
            actorId: guard.session.user.id,
            actorRole: guard.session.user.role,
            action: "order.return_refund_completed",
            entityType: "ReturnRequest",
            entityId: rr.id,
            metadata: {
              orderId: rr.order.id,
              orderNumber: rr.order.orderNumber,
              amount: totalRefund,
              method: originalMethod,
              manualReference: originalMethod === "CARD" ? manualRefundReference.trim() : null,
              automatedByStripe: false,
            },
          },
        });
      }

      return { creditNote, refundQueued };
    });

    const creditNotePdf = await renderCreditNotePdf(creditNote, rr.order.payment.invoice).catch((err) => {
      console.error("[completeReturnRequest] credit note PDF render failed:", err);
      return null;
    });

    // Never `refunded: true`/false-as-failure here — this app does not move
    // money. `manualRefund` means the cash/card hand-over already happened
    // at the counter (trusted at the point of confirmation, same as the POS
    // terminal sale); an ONLINE refund is only ever queued at this point, and
    // notify-refund-complete.js sends the real "c'est fait" e-mail once the
    // charge.refunded webhook (or an admin's manual confirmation) settles it.
    sendEmail({
      to: rr.order.user.email,
      ...returnCompletedEmail({
        customerName: rr.order.user.fullName,
        orderNumber: rr.order.orderNumber,
        refundAmount: totalRefund,
        manualRefund,
        refundPending: !manualRefund && refundQueued,
      }),
      ...(creditNotePdf ? { attachments: [{ filename: `note-de-credit-${creditNote.number}.pdf`, content: creditNotePdf }] } : {}),
    }).catch((err) => console.error("[completeReturnRequest] email failed:", err));

    if (!manualRefund && !refundQueued && totalRefund > REFUND_EPSILON) {
      // Nothing to hand back on purpose (a fully-consumed prior partial
      // refund would look like this) is not a failure — but queueManualRefund
      // returning null while totalRefund is still positive means the ledger
      // and this function disagree about what's owed, which is worth a human
      // looking at rather than silently telling the customer it's handled.
      const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
      if (salon?.email) {
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement à vérifier – Retour commande n°${rr.order.orderNumber}`,
          text: `Le retour de la commande n°${rr.order.orderNumber} (client : ${rr.order.user.email}) est finalisé, mais ${totalRefund.toFixed(2)} € restaient dus sans qu'aucun remboursement ait pu être mis en file. Vérifiez ce paiement manuellement.`,
          html: `<p>Le retour de la commande n°${rr.order.orderNumber} (client : ${rr.order.user.email}) est finalisé, mais ${totalRefund.toFixed(2)} € restaient dus sans qu'aucun remboursement ait pu être mis en file. Vérifiez ce paiement manuellement.</p>`,
        }).catch((err) => console.error("[completeReturnRequest] refund-inconsistency alert email failed:", err));
      }
    }

    revalidatePath("/dashboard/boutique/returns");
    if (originalMethod === "CASH") revalidateCaisseRoutes();
    return {
      success: true,
      message: manualRefund
        ? `Retour finalisé — €${totalRefund.toFixed(2)} remboursé(s) en boutique.`
        : `Retour finalisé. Le remboursement de €${totalRefund.toFixed(2)} est à effectuer — voir « Remboursements dus » dans Opérations.`,
      refundQueued,
    };
  } catch (error) {
    if (error.message === "ALREADY_PROCESSED") {
      return { success: false, message: "Ce retour vient d'être finalisé (par vous ou un autre membre de l'équipe)." };
    }
    if (error.message === "REFUND_CAP_EXCEEDED") {
      return { success: false, message: "Ce remboursement dépasserait le montant réellement payé pour cette commande." };
    }
    if (error.message === "REFUND_ALREADY_PENDING") {
      return {
        success: false,
        message: "Un remboursement est déjà en cours de traitement pour cette commande — attendez sa résolution (ou réessayez-le depuis la page Réconciliation) avant d'en lancer un autre.",
      };
    }
    console.error("[completeReturnRequest]", error);
    return { success: false, message: "Impossible de finaliser ce retour." };
  }
}
