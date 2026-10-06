import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Signed, short-lived capability that authorizes a customer to submit a review
 * for a specific reservation/appointment after it's been completed.
 *
 * Stateless (HMAC over AUTH_SECRET) — no DB row, no migration.
 * Format:  payload.signature
 *   payload   = base64url(JSON{ purpose, reservationType, reservationId, email, nonce, exp })
 *   signature = HMAC-SHA256(payload, AUTH_SECRET)
 *
 * The token rides in the review email link and is submitted back by the client.
 * Even if intercepted, it only lets the holder submit a review for THIS
 * reservation within its 7-day window — not anyone else's.
 */

const REVIEW_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REVIEW_PURPOSE = "review";

function getSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not configured — cannot sign review tokens."
    );
  }
  return secret;
}

function sign(payload) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Mint a review token binding a specific reservation/appointment to the
 * customer's e-mail address.
 *
 * @param {{ reservationType: "APPOINTMENT"|"WORKSHOP"|"FORMATION", reservationId: string, email: string }} input
 * @returns {string} Opaque token to thread through the review email link.
 */
export function createReviewToken({ reservationType, reservationId, email }) {
  if (!reservationType || !reservationId || !email) {
    throw new Error(
      "createReviewToken: reservationType, reservationId and email are required."
    );
  }
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + REVIEW_TOKEN_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({
      purpose: REVIEW_PURPOSE,
      reservationType,
      reservationId,
      email,
      nonce,
      exp,
    })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a review token for the given (reservationType, reservationId).
 *
 * Returns { ok: true, email } only when the signature is valid, the purpose
 * matches, the token has not expired, and the bound reservationType/reservationId
 * match the caller's arguments. Returns { ok: false } in every other case
 * (fail-closed) — a missing or tampered token never allows a review submission.
 *
 * @param {string} token
 * @param {{ reservationType: string, reservationId: string }} expected
 * @returns {{ ok: true, email: string } | { ok: false }}
 */
export function verifyReviewToken(token, { reservationType, reservationId }) {
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
  if (data.purpose !== REVIEW_PURPOSE) return { ok: false };
  if (data.reservationType !== reservationType) return { ok: false };
  if (data.reservationId !== reservationId) return { ok: false };
  if (typeof data.email !== "string" || !data.email) return { ok: false };
  if (typeof data.exp !== "number" || data.exp < Date.now())
    return { ok: false };
  return { ok: true, email: data.email };
}