import { stripe as defaultStripeClient } from "@/lib/stripe";
import { prisma as defaultPrismaClient } from "@/lib/prisma";
import { isForeignCheckoutSession } from "@/lib/stripe-deployment";
import { captureCriticalError } from "@/lib/monitoring";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";
import { confirmWorkshopReservationPayment } from "@/lib/workshops/fulfill-workshop-reservation-payment";
import { confirmFormationReservationPayment } from "@/lib/formations/fulfill-formation-reservation-payment";

// A `stripe listen` CLI session (local dev) only forwards events while it's
// actively connected — unlike a real Dashboard-registered endpoint, Stripe
// does not queue/retry deliveries for it. A payment completed while nobody's
// listener was up (or whose one delivery hit a transient error) leaves the
// reservation/order stuck exactly as Stripe left it — PENDING_DEPOSIT, no
// Payment row — while Stripe itself already shows the charge as succeeded.
// 31 Aug 2026: reported as "paid on Stripe, still en attente d'acompte on the
// site". Mirrors reconcile-missed-refunds.js for the opposite direction:
// independently re-derives fulfilment state from Stripe's own Checkout
// Session list instead of trusting webhook delivery, and replays the exact
// same, already-idempotent confirm functions the webhook itself calls.
const LOOKBACK_HOURS = 72;

// Only the initial deposit/full-payment confirmation is in scope — session
// and seat-change fees (workshopAction "session_change_fee"/"seats_change_fee")
// add a Transaction to an *existing* Payment through a different, separately
// idempotent path (applyWorkshopSessionChangeFee/applyWorkshopSeatsChangeFee
// in the webhook route) that this job does not touch.
const WORKSHOP_ACTIONS_HANDLED = new Set(["deposit", "full_payment", undefined]);

export async function reconcileMissedCheckouts({
  stripeClient = defaultStripeClient,
  prismaClient = defaultPrismaClient,
} = {}) {
  const cutoffUnix = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;

  let checked = 0;
  let reconciled = 0;
  const failures = [];

  let startingAfter;
  for (;;) {
    let page;
    try {
      page = await stripeClient.checkout.sessions.list({
        created: { gte: cutoffUnix },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      failures.push({ sessionId: null, message: error?.message ?? "Erreur inconnue" });
      captureCriticalError(error, { area: "checkout-reconciliation", context: "list" });
      break;
    }

    for (const session of page.data) {
      if (session.payment_status !== "paid") continue;
      if (isForeignCheckoutSession(session)) continue; // not ours to fulfil

      const kind = session.metadata?.kind;
      if (kind !== "order" && kind !== "workshop" && kind !== "formation") continue;
      if (kind === "workshop" && !WORKSHOP_ACTIONS_HANDLED.has(session.metadata?.workshopAction)) continue;

      checked += 1;

      try {
        const existing = await prismaClient.payment.findFirst({
          where: { transactionReference: session.id },
          select: { id: true },
        });
        if (existing) continue; // webhook (or a prior run) already handled it

        const fullSession = await stripeClient.checkout.sessions.retrieve(session.id);

        if (kind === "order") {
          await fulfillOrderPayment(fullSession);
        } else if (kind === "workshop") {
          await confirmWorkshopReservationPayment(fullSession);
        } else {
          await confirmFormationReservationPayment(fullSession);
        }

        reconciled += 1;
        console.warn(`[reconcile-missed-checkouts] Recovered a payment confirmation the webhook missed — session ${session.id} (${kind})`);
      } catch (error) {
        failures.push({ sessionId: session.id, message: error?.message ?? "Erreur inconnue" });
        captureCriticalError(error, { area: "checkout-reconciliation", sessionId: session.id, kind });
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data.at(-1).id;
  }

  return { checked, reconciled, failures };
}
