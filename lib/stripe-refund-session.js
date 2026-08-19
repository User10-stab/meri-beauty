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
    // Without an idempotency key, a redelivered webhook (line 17's own
    // "500 -> Stripe retries" design) retries this call — if the first
    // stripe.refunds.create actually succeeded on Stripe's side but the
    // response never reached us (timeout/network blip), the retry would
    // create a second, real refund for the same payment_intent. One
    // session always maps to at most one refund here, so the key is
    // stable across retries of the same event.
    await stripe.refunds.create(
      { payment_intent: session.payment_intent },
      { idempotencyKey: `refund-session:${session.id}` }
    );
  } catch (err) {
    // The money question must never be silently swallowed.
    captureCriticalError(err, { area: "refund-reconciliation", sessionId: session.id, kind: session.metadata?.kind });
    throw err; // 500 → Stripe retries → refund retried
  }
}
