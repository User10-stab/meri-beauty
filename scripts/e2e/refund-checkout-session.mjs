import Stripe from "stripe";

const sessionId = process.argv[2];
if (!sessionId) throw new Error("Usage: node scripts/e2e/refund-checkout-session.mjs <checkoutSessionId>");
if (process.env.NODE_ENV === "production") throw new Error("This E2E helper is disabled in production.");
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("A Stripe test secret key is required.");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const checkout = await stripe.checkout.sessions.retrieve(sessionId);
if (!checkout.payment_intent) throw new Error("Checkout has no payment intent.");
const refund = await stripe.refunds.create({ payment_intent: checkout.payment_intent });
console.log(JSON.stringify({ sessionId, paymentIntentId: checkout.payment_intent, refundId: refund.id, status: refund.status }));
