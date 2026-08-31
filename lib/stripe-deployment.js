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
 *
 * 31 Aug 2026 — the same failure, one layer down: the stamp was the *host*
 * alone, and every developer's machine is "localhost:3000". Two people
 * running the app locally against the same Stripe test key therefore looked
 * identical to this guard, so each one's webhook processed the other's
 * payments, found no such reservation/order in its own database, and refunded
 * them. A real workshop deposit was captured and refunded ~2s later while the
 * booking showed CONFIRMED with a valid ticket. A loopback host is only
 * unique per machine, so the machine has to be part of the identity.
 */

import { hostname } from "node:os";

export const DEPLOYMENT_METADATA_KEY = "appEnv";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/** Strips a trailing :port, leaving "[::1]" and "localhost" intact. */
function hostnameOf(host) {
  return host.replace(/:\d+$/, "");
}

/**
 * True for hosts that identify a machine-local server rather than a
 * deployment: they are identical on every developer's machine.
 */
function isLoopbackHost(host) {
  const name = hostnameOf(host);
  return LOOPBACK_HOSTNAMES.has(name) || name.endsWith(".local") || name.endsWith(".localhost");
}

/**
 * What distinguishes one developer's machine from another's. The OS hostname
 * is stable across restarts and shared by every worker of the same process
 * group, so it can't split one deployment into several identities the way a
 * random per-boot id would.
 */
function machineId() {
  try {
    return hostname().trim().toLowerCase() || "unknown-machine";
  } catch {
    return "unknown-machine";
  }
}

/**
 * Stable identifier for this deployment, derived from the app URL that is
 * already configured everywhere (localhost:3000 vs meribeautystudio.com).
 * Host only, so an http/https or trailing-slash difference between
 * environments can't make a deployment look foreign to itself.
 *
 * For a loopback host the machine name is appended, because "localhost:3000"
 * on its own is not an identity — it is the same string for everyone sharing
 * the Stripe test key. Deployments reachable by a real hostname are already
 * unique and keep the bare host, so production's stamp is unchanged.
 *
 * Set STRIPE_DEPLOYMENT_ID to override entirely — needed only when two
 * instances with separate databases run on one machine.
 *
 * @returns {string} lowercase identifier, or "" when NEXT_PUBLIC_APP_URL is unset.
 */
export function getDeploymentId() {
  const explicit = (process.env.STRIPE_DEPLOYMENT_ID ?? "").trim();
  if (explicit) return explicit.toLowerCase();

  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return "";

  let host;
  try {
    host = new URL(raw).host.toLowerCase();
  } catch {
    host = raw.toLowerCase();
  }
  if (!host) return "";

  return isLoopbackHost(host) ? `${host}@${machineId()}` : host;
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
 *
 * A session carrying a *bare* loopback stamp ("localhost:3000") is the one
 * ambiguity resolved the other way: it is foreign to every machine now that
 * ids carry one, because it could equally have come from any of them. That
 * only affects local sessions created before this change was deployed, and
 * ignoring such a session merely leaves the payment unfulfilled — the
 * alternative reading is what refunded a real customer's deposit.
 */
export function isForeignCheckoutSession(session) {
  const stamped = session?.metadata?.[DEPLOYMENT_METADATA_KEY];
  if (!stamped) return false;

  const deploymentId = getDeploymentId();
  if (!deploymentId) return false;

  return stamped.toLowerCase() !== deploymentId;
}
