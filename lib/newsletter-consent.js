import crypto from "crypto";

// Bump whenever the marketing-consent copy/checkbox text shown at opt-in
// time materially changes, so newsletterConsentVersion on older User rows
// stays an honest record of what they actually agreed to.
export const NEWSLETTER_CONSENT_VERSION = "2026-08-10";

/**
 * Builds the Prisma `data` fragment for a newsletter subscription change —
 * spread into any `user.create`/`user.update` call site instead of setting
 * `newsletterSubscribed` directly, so consent is always timestamped and
 * attributed. Unsubscribing only flips the boolean: the original
 * consentedAt/source/version stay as a historical record of when/how they
 * first opted in, not something to erase on withdrawal.
 *
 * @param {boolean} subscribed
 * @param {string} source - e.g. "registration", "boutique_checkout", "appointment_booking", "account_settings"
 */
export function buildNewsletterConsentUpdate(subscribed, source) {
  if (!subscribed) return { newsletterSubscribed: false };
  return {
    newsletterSubscribed: true,
    newsletterConsentedAt: new Date(),
    newsletterConsentSource: source,
    newsletterConsentVersion: NEWSLETTER_CONSENT_VERSION,
  };
}

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail hard rather than falling back to a publicly-known constant — a
    // silent fallback here means anyone can forge a valid unsubscribe link
    // for any user id the moment AUTH_SECRET is unset. Same reasoning as
    // lib/autologin.js.
    throw new Error("AUTH_SECRET is not set — cannot generate or verify unsubscribe tokens.");
  }
  return secret;
}

/**
 * Signed, non-expiring token for one-click email unsubscribe links — no
 * login required, so the signature itself (tying the token to one specific
 * userId) is the only thing standing between "click the link in your inbox"
 * and "anyone can unsubscribe anyone." Deliberately never expires: unlike
 * autologin (which grants a session), unsubscribing is idempotent and
 * low-risk, and marketing emails often sit unread for weeks.
 */
export function generateUnsubscribeToken(userId) {
  return crypto.createHmac("sha256", getSecret()).update(userId).digest("hex");
}

export function verifyUnsubscribeToken(userId, token) {
  if (!userId || !token) return false;
  try {
    const expected = Buffer.from(generateUnsubscribeToken(userId), "hex");
    const provided = Buffer.from(token, "hex");
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export function buildUnsubscribeUrl(baseUrl, userId) {
  const token = generateUnsubscribeToken(userId);
  return `${baseUrl}/newsletter/desabonnement?u=${encodeURIComponent(userId)}&t=${token}`;
}
