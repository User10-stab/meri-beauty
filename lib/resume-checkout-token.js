import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived capability that authorizes the manual "Réessayer le
 * paiement" button to resume a specific checkout after e-mail verification.
 *
 * At resume time there is NO authenticated session yet (verifyEmail sets
 * emailVerified and e-mails credentials, but never signs the user in), so an
 * auth() + resource.userId ownership check is impossible — the proof has to
 * be an unforgeable capability bound to the resource. This token is only ever
 * minted server-side inside verifyEmail(), from the validated
 * EmailVerificationToken row, the instant the address is confirmed.
 *
 * Stateless (HMAC over AUTH_SECRET) — no DB row, no migration. Modeled on
 * lib/stripe-oauth.js (same secret, same base64url payload + timingSafeEqual
 * pattern). Format:  payload.signature
 *   payload   = base64url(JSON{ purpose, resumeType, resumeId, email, nonce, exp })
 *   signature = HMAC-SHA256(payload, AUTH_SECRET)
 *
 * The token rides in the verify-email page props and is submitted back by the
 * client retry button. Even if intercepted, it only lets the holder resume
 * THIS order/reservation's payment within its 30-minute window — not anyone
 * else's.
 */

const RESUME_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESUME_PURPOSE = "resume-checkout";

function getSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Fail hard — a silent fallback would let anyone forge valid tokens the
    // moment AUTH_SECRET is unset. Siblings (lib/autologin.js,
    // lib/stripe-oauth.js) enforce the same.
    throw new Error("AUTH_SECRET is not configured — cannot sign resume-checkout tokens.");
  }
  return secret;
}

function sign(payload) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Mint a resume-checkout token binding a specific checkout to the just-verified
 * e-mail address.
 *
 * @param {{ resumeType: "ORDER"|"WORKSHOP"|"FORMATION", resumeId: string, email: string }} input
 * @returns {string} Opaque token to thread through the verify-email page props.
 */
export function createResumeCheckoutToken({ resumeType, resumeId, email }) {
  if (!resumeType || !resumeId || !email) {
    throw new Error("createResumeCheckoutToken: resumeType, resumeId and email are required.");
  }
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + RESUME_TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ purpose: RESUME_PURPOSE, resumeType, resumeId, email, nonce, exp })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a resume-checkout token for the given (resumeType, resumeId).
 *
 * Returns { ok: true, email } only when the signature is valid, the purpose
 * matches, the token has not expired, and the bound resumeType/resumeId match
 * the caller's arguments. Returns { ok: false } in every other case
 * (fail-closed) — a missing or tampered token never reaches the checkout
 * builders.
 *
 * @param {string} token
 * @param {{ resumeType: string, resumeId: string }} expected
 * @returns {{ ok: true, email: string } | { ok: false }}
 */
export function verifyResumeCheckoutToken(token, { resumeType, resumeId }) {
  if (typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false };
  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length) return { ok: false };
  if (!timingSafeEqual(expected, received)) return { ok: false };

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false };
  }

  if (!data || typeof data !== "object") return { ok: false };
  if (data.purpose !== RESUME_PURPOSE) return { ok: false };
  if (data.resumeType !== resumeType) return { ok: false };
  if (data.resumeId !== resumeId) return { ok: false };
  if (typeof data.email !== "string" || !data.email) return { ok: false };
  if (typeof data.exp !== "number" || data.exp < Date.now()) return { ok: false };
  return { ok: true, email: data.email };
}

/**
 * Authorization gate for a checkout-session builder.
 *
 * Each of `createOrderCheckoutSession`, `resumeOrderAfterVerification`,
 * `createWorkshopReservationCheckoutSession` and
 * `createFormationReservationCheckoutSession` is exported from a `"use server"`
 * file, so Next.js exposes it as a callable server action that takes a bare
 * resource id — which on its own proves nothing. A caller is authorized iff
 * EITHER it presents a valid signed token bound to this resource (guest
 * checkout / post-verification resume, where there is no session yet) OR it is
 * signed in as the resource's owner.
 *
 * @param {{ userId?: string | null, customerId?: string | null } | null} resource
 *   The fetched order or reservation (orders carry `userId`, reservations carry `customerId`).
 * @param {{ resumeType: string, resumeId: string, checkoutToken?: string | null, sessionUserId?: string | null }} input
 * @returns {boolean}
 */
export function isCheckoutAuthorized(resource, { resumeType, resumeId, checkoutToken, sessionUserId }) {
  if (checkoutToken && verifyResumeCheckoutToken(checkoutToken, { resumeType, resumeId }).ok) return true;
  const ownerId = resource?.userId ?? resource?.customerId ?? null;
  return !!sessionUserId && !!ownerId && sessionUserId === ownerId;
}
