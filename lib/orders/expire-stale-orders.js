import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";

/**
 * For the /api/cron job runner, not called from the UI: releases abandoned
 * PENDING_PAYMENT checkouts (short window) and un-collected PICKUP_ON_SITE
 * orders (7-day window per the locked policy — prepaid pickups never
 * auto-expire, the customer already paid).
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * mass-expires every stale order in the system on each call.
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
      // Our local PENDING_PAYMENT status can be stale: the customer may have
      // already paid on Stripe's hosted page moments before this exact
      // expiry window closed, and the webhook just hasn't landed yet.
      // Blindly expiring here would silently swallow that payment — the
      // money is charged, but no Payment row, no stock decrement, no
      // confirmation ever gets created, because the webhook later finds the
      // order no longer PENDING_PAYMENT and no-ops. Same real incident and
      // same guard as the supersede path in createOrderFromCart
      // (actions/boutique/orders.js) — check with Stripe directly before
      // assuming abandonment.
      if (order.status === "PENDING_PAYMENT" && order.stripeCheckoutSessionId) {
        try {
          const liveSession = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
          if (liveSession.payment_status === "paid") {
            // fulfillOrderPayment is idempotent (claims via
            // Payment.transactionReference), so this is safe even if the
            // real webhook delivery lands moments later too.
            await fulfillOrderPayment(liveSession);
            continue;
          }
        } catch (err) {
          console.error("[expireStaleOrders] Stripe session check failed for order", order.id, "proceeding with expiry:", err);
        }
      }

      // Atomic claim gated on the status read above: if a customer paid,
      // cancelled, or picked up between the findMany and here — or an
      // overlapping cron run already claimed this same order — the WHERE
      // clause no longer matches and this update affects zero rows. Only
      // the run that actually flips the row goes on to decrement stock and
      // email the customer.
      const claimed = await prisma.$transaction(async (tx) => {
        // cancelledAt is set for BOTH branches now — it previously stayed
        // null for on-site pickup expirations, which broke any "cancelled
        // orders" query filtering on that column even though the order was
        // just as dead as a payment-timeout cancellation.
        const claim = await tx.order.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: order.status === "PENDING_PAYMENT" ? "CANCELLED" : "EXPIRED",
            cancelledAt: new Date(),
            cancelReason:
              order.status === "PENDING_PAYMENT"
                ? "Paiement non complété"
                : "Retrait non effectué dans le délai imparti",
          },
        });
        if (claim.count === 0) return false;

        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedQuantity: { decrement: item.quantity } },
          });
        }
        return true;
      });

      if (!claimed) continue;

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
