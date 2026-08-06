import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Stripe Connect OAuth helpers
 *
 * Provides the building blocks for the "Connect an existing Stripe account"
 * flow (Stripe Connect OAuth), independently from the existing
 * "Create a new Stripe account" flow.
 *
 * The OAuth `state` parameter is a signed, expiring, stateless token:
 *   payload.signature
 *
 *   payload   = base64url(JSON{ purpose, staffId, nonce, exp })
 *   signature = HMAC-SHA256(payload, AUTH_SECRET)
 *
 * The `purpose` field tags which flow the token belongs to. It is validated
 * on the callback side, so a token minted for one flow cannot be reused for
 * another. This keeps the door open for future OAuth flows (e.g. connecting
 * a different provider) without changing the token format.
 *
 * Because the payload is signed with the server secret, the callback never
 * trusts the raw `state` value: it verifies the signature, the purpose and
 * the expiry before reading `staffId` from it. This protects against CSRF
 * and against forged callbacks.
 *
 * No database storage is needed, so this flow requires no schema migration.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Purpose tag for the "connect existing Stripe account" flow. */
export const OAUTH_STATE_PURPOSE = "stripe-connect";

const AUTHORIZE_URL = "https://connect.stripe.com/oauth/authorize";

/**
 * Resolve the secret used to sign OAuth state tokens.
 * Reuses AUTH_SECRET (same fallback as middleware.js) — no new env var.
 * @returns {string}
 */
function getStateSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured.");
  }
  return secret;
}

/**
 * Sign a base64url payload with the server secret.
 * @param {string} payload
 * @returns {string}
 */
function sign(payload) {
  return createHmac("sha256", getStateSecret())
    .update(payload)
    .digest("base64url");
}

/**
 * Create a signed OAuth state token bound to a staff member.
 *
 * The token encodes which staff member initiated the flow so the callback
 * can resolve the target without relying on the (possibly expired) session.
 *
 * @param {string} staffId - The staff member initiating the connection.
 * @param {string} [purpose] - Flow tag embedded in the token
 *   (defaults to OAUTH_STATE_PURPOSE).
 * @returns {string} - The opaque `state` value to send to Stripe.
 */
export function createStripeOAuthState(staffId, purpose = OAUTH_STATE_PURPOSE) {
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + STATE_TTL_MS;

  const payload = Buffer.from(
    JSON.stringify({ purpose, staffId, nonce, exp })
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/**
 * Verify and decode an OAuth state token returned by Stripe.
 *
 * Returns the decoded payload only when the signature is valid, the purpose
 * matches the expected flow, and the token has not expired. Returns null in
 * every other case.
 *
 * @param {string} state - The raw `state` value received in the callback.
 * @param {string} [expectedPurpose] - Purpose the token must carry
 *   (defaults to OAUTH_STATE_PURPOSE).
 * @returns {{ staffId: string } | null}
 */
export function verifyStripeOAuthState(state, expectedPurpose = OAUTH_STATE_PURPOSE) {
  if (typeof state !== "string") return null;

  const parts = state.split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);

  if (expected.length !== received.length) return null;
  if (!timingSafeEqual(expected, received)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") return null;
  if (data.purpose !== expectedPurpose) return null;
  if (typeof data.staffId !== "string" || !data.staffId) return null;
  if (typeof data.exp !== "number" || data.exp < Date.now()) return null;

  return { staffId: data.staffId };
}

/**
 * Build the Stripe Connect OAuth authorization URL.
 *
 * Reads STRIPE_CONNECT_CLIENT_ID and STRIPE_OAUTH_REDIRECT_URI from the
 * environment (already configured). Throws if either is missing.
 *
 * @param {{ staffId: string }} params
 * @returns {string} - The full authorization URL to redirect the user to.
 */
export function buildStripeOAuthUrl({ staffId }) {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const redirectUri = process.env.STRIPE_OAUTH_REDIRECT_URI;

  if (!clientId) {
    throw new Error("STRIPE_CONNECT_CLIENT_ID is not configured.");
  }
  if (!redirectUri) {
    throw new Error("STRIPE_OAUTH_REDIRECT_URI is not configured.");
  }

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", createStripeOAuthState(staffId));

  return url.toString();
}
