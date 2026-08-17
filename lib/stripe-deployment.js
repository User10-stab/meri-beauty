/**
 * Cross-deployment Stripe event isolation.
 *
 * One Stripe account (test mode especially) is routinely shared by several
 * deployments at once — a developer's localhost, the staging VPS, and later
 * production. Stripe fans every event out to *every* registered endpoint, so
 * a Checkout Session created on localhost is also delivered to the VPS, whose
 * database has never heard of that orderId. The webhook handlers correctly
 * read "payment cleared for something that doesn't exist here" as a failed
 * sale and refund it — silently refunding a payment another deployment just
 * fulfilled perfectly.
 *
 * That is not a hypothetical: on 17 Aug 2026 every local test purchase was
 * refunded within ~2s by the staging VPS, while localhost showed the order
 * paid and invoiced. The refunds carried no metadata, no explicit amount and
 * an auto-generated idempotency key — the signature of the `!order` refund
 * branch in lib/orders/fulfill-order-payment.js running somewhere else.
 *
 * Stamping each session we create with the deployment that created it, and
 * ignoring sessions stamped for somewhere else, keeps each deployment
 * reacting only to its own payments.
 */

export const DEPLOYMENT_METADATA_KEY = "appEnv";

/**
 * Stable identifier for this deployment, derived from the app URL that is
 * already configured everywhere (localhost:3000 vs meribeautystudio.com).
 * Host only, so an http/https or trailing-slash difference between
 * environments can't make a deployment look foreign to itself.
 *
 * @returns {string} lowercase host, or "" when NEXT_PUBLIC_APP_URL is unset.
 */
export function getDeploymentId() {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * Adds this deployment's stamp to Checkout Session metadata.
 * Applied centrally in lib/stripe.js, not at each call site.
 */
export function withDeploymentStamp(metadata = {}) {
  const deploymentId = getDeploymentId();
  if (!deploymentId) return { ...metadata };
  return { ...metadata, [DEPLOYMENT_METADATA_KEY]: deploymentId };
}

/**
 * True when this Checkout Session was demonstrably created by a *different*
 * deployment sharing the same Stripe account.
 *
 * Deliberately fails open (returns false) when either side is unknown — an
 * unstamped session predates this guard, and a deployment with no
 * NEXT_PUBLIC_APP_URL can't judge ownership. Ignoring a real payment is far
 * worse than the cross-talk this prevents, so anything ambiguous is treated
 * as ours and processed normally.
 */
export function isForeignCheckoutSession(session) {
  const stamped = session?.metadata?.[DEPLOYMENT_METADATA_KEY];
  if (!stamped) return false;

  const deploymentId = getDeploymentId();
  if (!deploymentId) return false;

  return stamped.toLowerCase() !== deploymentId;
}
