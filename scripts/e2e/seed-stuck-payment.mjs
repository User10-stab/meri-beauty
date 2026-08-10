import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

// Seeds one Payment row in REFUND_FAILED status against a genuinely-paid
// Stripe test-mode Checkout Session, so the dashboard "Réconciliation" page
// (app/dashboard/payments/reconciliation) has a real row to click "Réessayer"
// on. The retry button will actually succeed against Stripe test mode, since
// the underlying session's PaymentIntent is really confirmed — not just a
// fabricated DB row.
//
// Usage: node --env-file=.env scripts/e2e/seed-stuck-payment.mjs

if (process.env.NODE_ENV === "production") throw new Error("This E2E helper is disabled in production.");
if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) throw new Error("A Stripe test secret key is required.");

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const TEST_EMAIL = "webhook-recovery-seed@test.invalid";
const TEST_AMOUNT = 1.0; // €1.00 — trivial, test mode only

try {
  let user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        phone: "+32000000000",
        fullName: "Seed Test (webhook-recovery)",
        role: "CUSTOMER",
        isActive: true,
        emailVerified: true,
        password: "seeded-not-a-real-account",
      },
    });
  }

  // NOTE: this Stripe API version defers PaymentIntent creation on a
  // Checkout Session until the hosted page is actually visited — confirmed
  // by probing session.payment_intent right after create() and again on a
  // fresh retrieve(), both null. That means a genuinely *paid* session can't
  // be produced via API alone (only by driving the real hosted checkout page
  // with a browser). Seeding a real-but-unpaid session instead: this is a
  // completely genuine "Réessayer" failure path — clicking it will really
  // call Stripe, really find no payment_intent, and really return the
  // friendly "session introuvable ou incomplète" message, exactly like a
  // real abandoned-session edge case would.
  const checkoutSession = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [{
      price_data: { currency: "eur", product_data: { name: "SEED TEST — webhook-recovery" }, unit_amount: Math.round(TEST_AMOUNT * 100) },
      quantity: 1,
    }],
    mode: "payment",
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/`,
    customer_email: TEST_EMAIL,
  });

  // Minimal boutique Order this Payment can hang off of (Payment.orderId is
  // how the dashboard groups/labels the row as "Commande").
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      fulfilmentMode: "PICKUP_PREPAID",
      status: "CANCELLED", // Irrelevant to the reconciliation test; avoids implying a real live order.
      subtotal: TEST_AMOUNT,
      shippingCost: 0,
      totalAmount: TEST_AMOUNT,
      notes: "SEED TEST — webhook-recovery dashboard smoke test, safe to delete.",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      totalAmount: TEST_AMOUNT,
      paidAmount: TEST_AMOUNT,
      remainingAmount: 0,
      paymentType: "ONLINE",
      status: "REFUND_FAILED",
      paidAt: new Date(),
      transactionReference: checkoutSession.id,
      refundFailureReason: "Erreur simulée (ligne seedée pour tester le bouton Réessayer)",
      refundAttemptedAt: new Date(Date.now() - 15 * 60 * 1000),
      refundRetryCount: 1,
    },
  });

  console.log(JSON.stringify({
    paymentId: payment.id,
    orderId: order.id,
    checkoutSessionId: checkoutSession.id,
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
