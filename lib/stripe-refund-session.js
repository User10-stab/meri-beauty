import { stripe } from "@/lib/stripe";
import { captureCriticalError } from "@/lib/monitoring";

/**
 * Refunds a Checkout Session's payment intent, if it has one. Used across
 * the Stripe webhook whenever a payment cleared for something that's no
 * longer valid to honor (deleted/cancelled reservation, underpayment, etc).
 * A no-op for a synthetic zero-total "session" (no real payment_intent).
 */
export async function refundSession(session) {
  if (!session.payment_intent) return;
  try {
    await stripe.refunds.create({ payment_intent: session.payment_intent });
  } catch (err) {
    // The money question must never be silently swallowed.
    captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, kind: session.metadata?.kind });
    throw err; // 500 → Stripe retries → refund retried
  }
}
