import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { issueInvoice } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";

/** Order items (+ shipping, if any) as invoice line snapshots. */
export function orderInvoiceLines(order) {
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

  // Paranoid check: line items are built server-side, but the webhook is the
  // last line of defense on money.
  const expectedAmount = Number(order.totalAmount);
  if (paidAmount + 0.01 < expectedAmount) {
    console.error(`[fulfillOrderPayment] UNDERPAYMENT: paid ${paidAmount} expected ${expectedAmount} for session ${session.id}`);
    if (session.payment_intent) {
      await stripe.refunds.create({ payment_intent: session.payment_intent }).catch((err) => {
        console.error("[fulfillOrderPayment] underpayment REFUND FAILED for", session.id, err);
        throw err;
      });
    }
    return { received: true, refunded: true, reason: "underpayment" };
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
      data: { status: nextStatus, expiresAt: null },
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
    // A concurrent cancellation (cancelMyOrder/cancelOrder) won the race and
    // moved the order out of PENDING_PAYMENT between this function's initial
    // read and this transaction — the salon can't honor a sale it already
    // voided, so refund rather than resurrect the cancelled order.
    if (err.message === "ORDER_NO_LONGER_PENDING") {
      console.warn("[fulfillOrderPayment] order cancelled during payment, refunding:", session.id);
      if (session.payment_intent) {
        await stripe.refunds.create({ payment_intent: session.payment_intent }).catch((refundErr) => {
          console.error("[fulfillOrderPayment] race REFUND FAILED for", session.id, refundErr);
          throw refundErr;
        });
      }
      return { received: true, refunded: true, reason: "order cancelled during payment" };
    }
    throw err;
  }

  const pickupNote =
    order.fulfilmentMode === "PICKUP_PREPAID"
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
