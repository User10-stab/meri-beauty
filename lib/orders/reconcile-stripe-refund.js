import { Prisma } from "@prisma/client";

const REFUND_EPSILON = 0.01;
const REFUNDABLE_ORDER_STATUSES = ["PAID", "PROCESSING", "READY_FOR_PICKUP", "SHIPPED"];

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Reconcile Stripe's cumulative refund total for a product order.
 *
 * Must be called inside an interactive Prisma transaction. The advisory lock
 * serializes duplicate/concurrent Stripe deliveries for the same Payment.
 * Partial refunds only update the payment ledger. A full refund atomically
 * cancels the order and returns sold units to stock exactly once.
 *
 * Stripe has no single refund id on charge.refunded when several refunds make
 * up the total. `stripeRefundId` is therefore returned for observability only;
 * Transaction currently has no stripeRefundId column. PaymentIntent is stored
 * on both the original online transaction (when missing) and the refund row.
 */
export async function reconcileStripeProductOrderRefund(
  tx,
  {
    paymentId,
    stripeRefundedTotal,
    stripePaymentIntentId = null,
    stripeRefundId = null,
    refundedAt = new Date(),
  },
) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`product-order-refund:${paymentId}`}))`,
  );

  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    include: {
      transactions: true,
      order: { include: { items: true } },
    },
  });

  if (!payment?.order) {
    return { handled: false, reason: "not-product-order", stripeRefundId };
  }

  if (stripePaymentIntentId) {
    await tx.transaction.updateMany({
      where: {
        paymentId,
        transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
        stripePaymentIntentId: null,
      },
      data: { stripePaymentIntentId },
    });
  }

  const alreadyRecorded = payment.transactions
    .filter((transaction) => transaction.transactionType === "REFUND")
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const refundedTotal = round2(Number(stripeRefundedTotal));
  const newlyRefunded = round2(refundedTotal - alreadyRecorded);
  const fullyRefunded = refundedTotal + REFUND_EPSILON >= Number(payment.paidAmount);

  if (newlyRefunded > REFUND_EPSILON) {
    await tx.transaction.create({
      data: {
        paymentId,
        amount: newlyRefunded,
        method: "ONLINE",
        transactionType: "REFUND",
        paidAt: refundedAt,
        stripePaymentIntentId,
      },
    });
  }

  await tx.payment.update({
    where: { id: paymentId },
    data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
  });

  let orderCancelled = false;
  if (fullyRefunded) {
    const claim = await tx.order.updateMany({
      where: { id: payment.order.id, status: { in: REFUNDABLE_ORDER_STATUSES } },
      data: {
        status: "CANCELLED",
        cancelledAt: refundedAt,
        cancelReason: "Remboursement intégral effectué via Stripe",
        expiresAt: null,
      },
    });

    orderCancelled = claim.count === 1;
    if (orderCancelled) {
      for (const item of payment.order.items) {
        // POS ad-hoc service lines (variantId null) carry no stock to adjust.
        if (!item.variantId) continue;
        const variant = await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stockQuantity: { increment: item.quantity } },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            type: "RETURN",
            quantity: item.quantity,
            previousStock: variant.stockQuantity - item.quantity,
            newStock: variant.stockQuantity,
            reason: `Remboursement Stripe intégral — commande n°${payment.order.orderNumber}`,
          },
        });
      }
    }
  }

  return {
    handled: true,
    newlyRefunded: Math.max(newlyRefunded, 0),
    fullyRefunded,
    orderCancelled,
    alreadyProcessed: newlyRefunded <= REFUND_EPSILON && !orderCancelled,
    stripeRefundId,
  };
}
