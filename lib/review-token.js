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
  const verified = parseAndVerifyReviewToken(token);
  if (!verified.ok) return { ok: false };
  if (verified.reservationType !== reservationType) return { ok: false };
  if (verified.reservationId !== reservationId) return { ok: false };
  return { ok: true, email: verified.email };
}

/**
 * Parses and verifies a review token signature and expiration.
 *
 * @param {string} token
 * @returns {{ ok: true, reservationType: string, reservationId: string, email: string } | { ok: false, error?: string }}
 */
export function parseAndVerifyReviewToken(token) {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, error: "Token invalide." };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "Token malformé." };
  const [payload, signature] = parts;

  try {
    const expected = Buffer.from(sign(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length) return { ok: false, error: "Signature invalide." };
    if (!timingSafeEqual(expected, received)) return { ok: false, error: "Signature invalide." };

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data || typeof data !== "object") return { ok: false, error: "Données corrompues." };
    if (data.purpose !== REVIEW_PURPOSE) return { ok: false, error: "Usage non autorisé." };
    if (typeof data.exp !== "number" || data.exp < Date.now()) {
      return { ok: false, error: "Le lien a expiré (validité 7 jours)." };
    }
    if (!data.reservationType || !data.reservationId || !data.email) {
      return { ok: false, error: "Informations manquantes." };
    }

    return {
      ok: true,
      reservationType: data.reservationType,
      reservationId: data.reservationId,
      email: data.email,
    };
  } catch {
    return { ok: false, error: "Token invalide." };
  }
}