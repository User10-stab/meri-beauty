import { Prisma } from "@prisma/client";
import { stripe as defaultStripeClient } from "@/lib/stripe";
import { prisma as defaultPrismaClient } from "@/lib/prisma";
import { issueCreditNote } from "@/lib/invoicing";
import { reconcileStripeProductOrderRefund } from "@/lib/orders/reconcile-stripe-refund";
import {
  reconcileExceptionalReservationFullRefund,
  RESERVATION_REFUND_AUTHORIZATION,
} from "@/lib/payments/reconcile-reservation-refund";

// Stripe retries a failing webhook endpoint for up to 3 days, then gives up
// silently — an endpoint outage, a bad deploy, or a signature-secret
// rotation during that window permanently drops the event with nothing
// surfacing the gap. 72h lookback covers Stripe's full retry window with no
// dead zone between "still retrying" and "this job would have caught it".
const LOOKBACK_HOURS = 72;
const REFUND_EPSILON = 0.01;

function round2(value) {
  return Math.round(value * 100) / 100;
}

const PAYMENT_INCLUDE = {
  invoice: true,
  transactions: true,
  order: { include: { items: true } },
  workshopReservation: true,
  formationReservation: true,
};

async function findPaymentForPaymentIntent(prismaClient, stripeClient, paymentIntentId) {
  // Fast path: some Transaction row already links this PaymentIntent to a
  // Payment (backfilled the first time any refund event — webhook or this
  // job — touches it, or set directly at checkout for newer payments).
  const linked = await prismaClient.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { paymentId: true },
  });
  if (linked) {
    return prismaClient.payment.findUnique({ where: { id: linked.paymentId }, include: PAYMENT_INCLUDE });
  }

  // Fallback for older Payments whose ledger predates stripePaymentIntentId:
  // resolve via the Checkout Session that created this PaymentIntent, same
  // lookup the webhook itself uses for `findPaymentByChargePaymentIntent`.
  const sessions = await stripeClient.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  if (!session) return null;
  return prismaClient.payment.findUnique({ where: { transactionReference: session.id }, include: PAYMENT_INCLUDE });
}

/**
 * Safety net for lib/orders/reconcile-stripe-refund.js /
 * lib/payments/reconcile-reservation-refund.js, both of which only run when
 * the Stripe `charge.refunded` webhook is actually delivered. This job
 * independently re-derives refund state from Stripe's List Refunds API
 * (never trusting that the webhook fired) and replays the exact same,
 * already-idempotent reconciliation helpers the webhook uses — so running
 * it on a schedule is safe and a no-op whenever nothing was actually missed.
 *
 * Deliberately does NOT touch app/api/webhooks/stripe/route.js — it
 * duplicates the small amount of "generic" ledger-sync logic (the
 * appointment/workshop/formation branch) that lives inline there rather
 * than importing it, so this file has no coupling to that route's internals.
 */
export async function reconcileMissedRefunds({
  stripeClient = defaultStripeClient,
  prismaClient = defaultPrismaClient,
} = {}) {
  const cutoffUnix = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  let checked = 0;
  let reconciled = 0;
  const failures = [];
  const seenChargeIds = new Set();

  let startingAfter;
  for (;;) {
    const page = await stripeClient.refunds.list({
      created: { gte: cutoffUnix },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const refund of page.data) {
      const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
      if (refund.status !== "succeeded" || !chargeId || seenChargeIds.has(chargeId)) continue;
      seenChargeIds.add(chargeId);
      checked += 1;

      try {
        // Re-fetch the charge for its authoritative cumulative amount_refunded
        // — a refund list entry only carries that one refund's own amount,
        // not the running total, and several partial refunds can land on the
        // same charge within the lookback window.
        const charge = await stripeClient.charges.retrieve(chargeId);
        const paymentIntentId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!paymentIntentId) continue;

        const payment = await findPaymentForPaymentIntent(prismaClient, stripeClient, paymentIntentId);
        if (!payment) continue; // Not ours — e.g. a Connect/staff-payout refund.

        const alreadyRecorded = payment.transactions
          .filter((t) => t.transactionType === "REFUND")
          .reduce((sum, t) => sum + Number(t.amount), 0);
        const stripeRefundedTotal = round2((charge.amount_refunded ?? 0) / 100);
        if (stripeRefundedTotal <= alreadyRecorded + REFUND_EPSILON) continue; // webhook already caught this

        const stripeRefundId = charge.refunds?.data?.at(-1)?.id ?? refund.id;

        await prismaClient.$transaction(async (tx) => {
          if (payment.orderId) {
            const result = await reconcileStripeProductOrderRefund(tx, {
              paymentId: payment.id,
              stripeRefundedTotal,
              stripePaymentIntentId: paymentIntentId,
              stripeRefundId,
            });
            if (result.newlyRefunded > REFUND_EPSILON && payment.invoice) {
              await issueCreditNote(tx, {
                invoiceId: payment.invoice.id,
                reason: "Remboursement Stripe reconcilié (webhook manqué)",
                totalInclVat: result.newlyRefunded,
              });
            }
            return;
          }

          // Generic (appointment/workshop/formation) ledger sync — mirrors
          // handleChargeRefunded's own non-order branch in the webhook route.
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`external-refund:${payment.id}`}))`,
          );
          const locked = await tx.payment.findUnique({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
          const recorded = locked.transactions
            .filter((t) => t.transactionType === "REFUND")
            .reduce((sum, t) => sum + Number(t.amount), 0);
          const newlyRefunded = round2(stripeRefundedTotal - recorded);
          if (newlyRefunded <= REFUND_EPSILON) return;
          const fullyRefunded = stripeRefundedTotal + REFUND_EPSILON >= Number(locked.paidAmount);

          await tx.transaction.updateMany({
            where: { paymentId: locked.id, transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }, stripePaymentIntentId: null },
            data: { stripePaymentIntentId: paymentIntentId },
          });
          await tx.transaction.create({
            data: {
              paymentId: locked.id,
              amount: newlyRefunded,
              method: "ONLINE",
              transactionType: "REFUND",
              paidAt: new Date(refund.created * 1000),
              stripePaymentIntentId: paymentIntentId,
            },
          });
          await tx.payment.update({
            where: { id: locked.id },
            data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
          });
          if (locked.invoice) {
            await issueCreditNote(tx, {
              invoiceId: locked.invoice.id,
              reason: "Remboursement Stripe reconcilié (webhook manqué)",
              totalInclVat: newlyRefunded,
            });
          }
          await reconcileExceptionalReservationFullRefund(tx, {
            payment: locked,
            stripeRefundedTotal,
            authorization: RESERVATION_REFUND_AUTHORIZATION.ADMIN_EXTERNAL_STRIPE_REFUND,
          });
        });

        reconciled += 1;
        console.warn(
          `[reconcile-missed-refunds] Recovered a refund the webhook missed — payment ${payment.id}, charge ${chargeId}`,
        );
      } catch (error) {
        failures.push({ chargeId, message: error?.message ?? "Erreur inconnue" });
        console.error("[reconcile-missed-refunds] failed for charge", chargeId, error);
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data.at(-1).id;
  }

  return { checked, reconciled, failures };
}
