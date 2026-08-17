import Stripe from "stripe";
import { withDeploymentStamp } from "@/lib/stripe-deployment";

export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY,
  {
    apiVersion: "2025-06-30.basil",
  }
);

// Every Checkout Session gets stamped with the deployment that created it,
// centrally rather than at each of the nine call sites — a call site added
// later is then covered automatically instead of silently reintroducing the
// cross-deployment refund bug this guards against (see
// lib/stripe-deployment.js for the full incident).
const createCheckoutSession = stripe.checkout.sessions.create.bind(stripe.checkout.sessions);
stripe.checkout.sessions.create = (params = {}, options) =>
  createCheckoutSession({ ...params, metadata: withDeploymentStamp(params.metadata) }, options);
