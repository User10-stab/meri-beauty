import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Dedicated, temporary appointment-confirmation capability.
 *
 * This is NOT a login/session token — it is a stateless, signed capability
 * that authorizes one thing only: confirming the payment choice for the exact
 * appointment it was minted for. It is only ever created server-side inside
 * acceptAppointment() and delivered exclusively inside the acceptance email
 * to the appointment owner's own address.
 *
 * Modeled on lib/resume-checkout-token.js (same secret, same base64url
 * payload + timingSafeEqual pattern). Format:  payload.signature
 *   payload   = base64url(JSON{ purpose, appointmentId, email, nonce, exp })
 *   signature = HMAC-SHA256(payload, AUTH_SECRET)
 *
 * The token rides in the confirmation link querystring
 * (/appointment/<id>/payment?confirm=<token>) — no email or user identifier
 * appears in the URL. Even if the token is intercepted, it only lets the
 * holder confirm THIS appointment within its validity window, not anyone
 * else's, and it grants no general account access.
 */

const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CONFIRM_PURPOSE = "appointment-confirm";

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail hard — a silent fallback would let anyone forge valid tokens the
    // moment AUTH_SECRET is unset. Siblings (lib/autologin.js,
    // lib/resume-checkout-token.js) enforce the same.
    throw new Error("AUTH_SECRET is not configured — cannot sign appointment-confirm tokens.");
  }
  return secret;
}

function sign(payload) {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Mint an appointment-confirmation token binding the confirmation to the
 * exact appointment (and its owner's email, kept out of the URL).
 *
 * @param {{ appointmentId: string, email: string }} input
 * @returns {string} Opaque token for the ?confirm= querystring.
 */
export function createAppointmentConfirmToken({ appointmentId, email }) {
  if (!appointmentId || !email) {
    throw new Error("createAppointmentConfirmToken: appointmentId and email are required.");
  }
  const nonce = randomBytes(16).toString("hex");
  const exp = Date.now() + CONFIRM_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({ purpose: CONFIRM_PURPOSE, appointmentId, email, nonce, exp })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify an appointment-confirmation token for the given appointment.
 *
 * Returns { ok: true, email } only when the signature is valid, the purpose
 * matches, the token has not expired, and the bound appointmentId matches the
 * caller's argument. Returns { ok: false } in every other case (fail-closed).
 *
 * @param {string} token
 * @param {{ appointmentId: string }} expected
 * @returns {{ ok: true, email: string } | { ok: false }}
 */
export function verifyAppointmentConfirmToken(token, { appointmentId }) {
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
  if (data.purpose !== CONFIRM_PURPOSE) return { ok: false };
  if (data.appointmentId !== appointmentId) return { ok: false };
  if (typeof data.email !== "string" || !data.email) return { ok: false };
  if (typeof data.exp !== "number" || data.exp < Date.now()) return { ok: false };
  return { ok: true, email: data.email };
}
