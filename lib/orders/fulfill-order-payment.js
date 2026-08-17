import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { issueInvoice, buildInvoiceCustomer } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { captureCriticalError, captureWarning } from "@/lib/monitoring";

async function createAutomaticOrderRefund(session, orderId, reason) {
  if (!session.payment_intent) return;

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;

  await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      metadata: {
        kind: "order_auto_refund",
        orderId,
        reason,
        checkoutSessionId: session.id,
      },
    },
    { idempotencyKey: `order-auto-refund:${reason}:${session.id}` }
  );
}

/**
 * Order items (+ shipping, + a promo discount line if any) as invoice line
 * snapshots. Product lines keep their full face-value unit price for
 * clarity — the discount is shown as its own negative line — rather than
 * silently reducing each product's displayed price, per bigbatch.txt P0
 * "Les promotions rendent les retours partiels incorrects" (which also
 * flagged this exact invoice mismatch: lines summed to the pre-discount
 * total while the invoice's totalInclVat was the post-discount amount
 * actually paid).
 */
export function orderInvoiceLines(order) {
  const lines = order.items.map((item) => ({
    description: `${item.productName} — ${item.variantName}`,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
  }));
  if (Number(order.shippingCost) > 0) {
    lines.push({ description: "Livraison", quantity: 1, unitPrice: Number(order.shippingCost) });
  }
  if (Number(order.discountAmount) > 0) {
    lines.push({ description: "Code promotionnel", quantity: 1, unitPrice: -Number(order.discountAmount) });
  }

  const linesTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const expected = Number(order.totalAmount);
  if (Math.abs(linesTotal - expected) > 0.01) {
    captureWarning("Invoice line total does not match order.totalAmount", {
      area: "invoicing",
      orderId: order.id,
      linesTotal,
      expected,
    });
  }

  return lines;
}

/**
 * Called by the Stripe webhook (app/api/webhooks/stripe/route.js) when
 * session.metadata.kind === "order". Idempotent via
 * Payment.transactionReference, same pattern as the appointment path.
 *
 * Deliberately kept out of any "use server" module. Every Next.js export
 * from a "use server" file is a public, unauthenticated POST endpoint —
 * this function trusts `session.amount_total` / `session.payment_intent`
 * completely, which is only safe because its one legitimate caller
 * (the webhook route) has already verified the Stripe signature on the
 * raw event before calling it. A client-reachable version of this
 * function is a free-merchandise exploit: fabricate a session object,
 * mark any pending order PAID, decrement stock, get an invoice, pay
 * nothing.
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
    include: {
      items: true,
      cart: { select: { id: true, status: true } },
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          vatNumber: true,
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

  if (!order || order.status === "CANCELLED" || order.status === "EXPIRED") {
    console.warn("[fulfillOrderPayment] order gone/cancelled after payment, refunding:", session.id);
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "order-unavailable").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order unavailable" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "order unavailable" };
  }

  if (order.status !== "PENDING_PAYMENT") {
    // The `existing` check above already handled a retried delivery of the
    // *same* session (harmless, Stripe's at-least-once guarantee). Reaching
    // here means a *different* session — a stale tab, a retry button, a
    // resumed checkout — settled after the order was already paid through
    // another one. That's a real second charge Stripe actually captured;
    // refund it rather than silently leaving the customer out that money.
    console.warn(`[fulfillOrderPayment] order ${orderId} already ${order.status}, refunding stray session:`, session.id);
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "order-already-paid").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order already paid" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "order already paid" };
  }

  const paidAmount = (session.amount_total ?? 0) / 100;
  const isPointOfSale = order.source === "POS";
  const nextStatus = isPointOfSale
    ? "COMPLETED"
    : order.fulfilmentMode === "SHIPPING_PREPAID"
      ? "PROCESSING"
      : "PAID";

  // Paranoid check: line items are built server-side, but the webhook is the
  // last line of defense on money.
  const expectedAmount = Number(order.totalAmount);
  const paidAmountCents = Number(session.amount_total ?? 0);
  const expectedAmountCents = Math.round(expectedAmount * 100);
  if (paidAmountCents < expectedAmountCents) {
    captureCriticalError(new Error("Order payment underpayment detected"), {
      area: "refund-reconciliation",
      sessionId: session.id,
      orderId,
      paidAmount,
      expectedAmount,
    });
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "underpayment").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "underpayment" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "underpayment" };
  }
  if (paidAmountCents > expectedAmountCents) {
    captureCriticalError(new Error("Order payment overpayment detected"), {
      area: "refund-reconciliation",
      sessionId: session.id,
      orderId,
      paidAmount,
      expectedAmount,
    });
    if (session.payment_intent) {
      await createAutomaticOrderRefund(session, orderId, "overpayment").catch((err) => {
        captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "overpayment" });
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "overpayment" };
  }

  let invoice;
  try {
  ({ invoice } = await prisma.$transaction(async (tx) => {
    // Atomic claim, gated on the order still being PENDING_PAYMENT — the read
    // above is only a fast-path check. Without this, a customer cancellation
    // (cancelMyOrder, gated on the same statuses) landing at the same instant
    // as this webhook delivery could have its CANCELLED write silently
    // overwritten back to PAID by the order.update further below committing
    // after it. Claiming it now, up front, means everything else in this
    // transaction (payment, stock, invoice) only happens for the winner.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT" },
      data: {
        status: nextStatus,
        expiresAt: null,
        ...(isPointOfSale
          ? { pickedUpAt: new Date(), pickedUpByStaffId: order.createdByStaffId }
          : {}),
      },
    });
    if (claim.count === 0) throw new Error("ORDER_NO_LONGER_PENDING");

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
        promoCodeId: order.promoCodeId,
        discountAmount: order.discountAmount,
      },
    });

    await tx.transaction.create({
      data: {
        paymentId: payment.id,
        amount: paidAmount,
        method: "ONLINE",
        transactionType: "FINAL_PAYMENT",
        paidAt: new Date(),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      },
    });

    const invoice = await issueInvoice(tx, {
      paymentId: payment.id,
      source: "ORDER",
      totalInclVat: paidAmount,
      customer: buildInvoiceCustomer(order.user, { vatNumberOverride: order.customerVatNumber ?? order.user.vatNumber }),
      lines: orderInvoiceLines(order),
      vatRate: Number(order.vatRate),
      vatTreatment: order.vatTreatment,
      taxCountryCode: order.taxCountryCode,
      taxNote: order.taxNote,
    });

    for (const item of order.items) {
      // POS ad-hoc service lines (variantId null) carry no stock to adjust.
      if (!item.variantId) continue;
      // Atomic {decrement} on both columns — a plain read-then-write of a
      // JS-computed literal would let two orders paying for the same
      // variant at once silently lose one side's decrement.
      const updated = await tx.productVariant.update({
        where: { id: item.variantId },
        data: {
          stockQuantity: { decrement: item.quantity },
          reservedQuantity: { decrement: item.quantity },
        },
      });
      const newStock = updated.stockQuantity;

      await tx.inventoryMovement.create({
        data: {
          variantId: item.variantId,
          type: "SALE",
          quantity: -item.quantity,
          previousStock: newStock + item.quantity,
          newStock,
          reason: `Commande n°${order.orderNumber}`,
          createdById: isPointOfSale ? order.createdByStaffId : null,
        },
      });
    }

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

    if (isPointOfSale) {
      await tx.auditLog.create({
        data: {
          actorId: order.createdByStaffId,
          action: "order.point_of_sale_qr_paid",
          entityType: "Order",
          entityId: order.id,
          before: { status: "PENDING_PAYMENT" },
          after: { status: "COMPLETED", totalAmount: paidAmount, stripeSessionId: session.id },
        },
      });
    }

    return { invoice };
  }));
  } catch (err) {
    // The Payment.transactionReference unique constraint is the real
    // idempotency guarantee — the findFirst check above is just a fast path
    // that two near-simultaneous webhook deliveries can both pass before
    // either commits. A P2002 here means the other delivery won the race;
    // this one is done, not failed.
    if (err.code === "P2002") {
      return { received: true, alreadyProcessed: true };
    }
    // A zero-row claim is ambiguous: a cancellation may have won, but a
    // duplicate webhook/action can also have completed this exact session
    // while this invocation was waiting for the order row lock. Re-check the
    // durable Payment before deciding. Otherwise, the losing duplicate can
    // refund the winning invocation's successfully finalized payment.
    if (err.message === "ORDER_NO_LONGER_PENDING") {
      const processedPayment = await prisma.payment.findFirst({
        where: { orderId, transactionReference: session.id },
        select: { id: true },
      });
      if (processedPayment) {
        return { received: true, alreadyProcessed: true };
      }

      const latestOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (latestOrder && latestOrder.status !== "CANCELLED" && latestOrder.status !== "EXPIRED") {
        captureCriticalError(new Error("Order payment claim lost without a completed payment or cancellation"), {
          area: "stripe-webhook",
          sessionId: session.id,
          orderId,
          orderStatus: latestOrder.status,
        });
        throw err;
      }

      console.warn("[fulfillOrderPayment] order cancelled during payment, refunding:", session.id);
      if (session.payment_intent) {
        await createAutomaticOrderRefund(session, orderId, "order-cancelled-during-payment").catch((refundErr) => {
          captureCriticalError(refundErr, { area: "refund-reconciliation", sessionId: session.id, orderId, reason: "order cancelled during payment" });
          throw refundErr;
        });
      }
      return { received: true, refunded: true, reason: "order cancelled during payment" };
    }
    throw err;
  }

  const pickupNote = isPointOfSale
    ? "Merci pour votre achat en boutique. Votre facture est jointe à cet e-mail."
    : order.fulfilmentMode === "PICKUP_PREPAID"
      ? `Nous vous préviendrons dès qu'elle sera prête à être retirée. Code de retrait : ${order.pickupCode}.`
      : "Elle sera expédiée sous peu vers votre point relais Mondial Relay — vous recevrez le numéro de suivi par e-mail.";

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
