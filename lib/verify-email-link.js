import crypto from "crypto";

// Marker lifetime matches the verification token itself (24 h) so a fresh
// reservation link always carries a fresh marker.
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set — cannot sign verification return links.");
  }
  return secret;
}

function hasUnsafeChars(raw) {
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    // Control characters, DEL and backslash (mirrors lib/safe-callback-url.js,
    // which additionally rejects an encoded %5c — checked below).
    if (code <= 0x1f || code === 0x7f || ch === "\\") return true;
  }
  return false;
}

/**
 * Strict same-origin relative path check for post-verification redirects.
 * Mirrors lib/safe-callback-url.js rules so a hand-edited link can never
 * turn the verification page into an open redirect. Query strings are
 * allowed (the reservation flow needs ?booking=…&verified=1).
 */
export function isSafeReturnPath(value) {
  const raw = String(value ?? "");
  if (!raw || raw.length > 500) return false;
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  if (hasUnsafeChars(raw)) return false;
  if (raw.toLowerCase().includes("%5c")) return false;
  return true;
}

/**
 * Signs a post-verification return path. The signature binds the exact path
 * plus an expiry to AUTH_SECRET, so the /verify-email page can tell a
 * genuine reservation link from a hand-edited one without touching the
 * database (no token consumption on GET).
 */
export function signReservationReturn(returnTo) {
  return signReturn("reservation", returnTo);
}

/** Validates a signed reservation return marker. Fail-closed on anything. */
export function checkReservationReturn(returnTo, exp, sig) {
  return checkReturn("reservation", returnTo, exp, sig);
}

function signReturn(scope, returnTo) {
  const exp = Date.now() + MARKER_TTL_MS;
  const payload = `${scope}|${returnTo}|${exp}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return { exp: String(exp), sig };
}

function checkReturn(scope, returnTo, exp, sig) {
  if (!isSafeReturnPath(returnTo)) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || Date.now() > expNum) return false;
  if (!sig || typeof sig !== "string") return false;
  let expected;
  try {
    expected = crypto.createHmac("sha256", getSecret()).update(`${scope}|${returnTo}|${exp}`).digest("hex");
  } catch {
    return false;
  }
  const provided = Buffer.from(sig, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (provided.length !== wanted.length) return false;
  return crypto.timingSafeEqual(provided, wanted);
}

/**
 * Builds the /verify-email link. Tokens that carry an app return context
 * (appointment-reservation "RESERVATION", post-signup "SIGNUP") additionally
 * get a signed one-click marker plus the validated return path; every other
 * caller gets the exact URL shape as before.
 */
export function buildVerifyEmailUrl(token, { resumeType = null, resumeId = null } = {}) {
  const base = `${
    process.env.NEXTAUTH_URL || "http://localhost:3000"
  }/verify-email?token=${encodeURIComponent(token)}`;
  if ((resumeType === "RESERVATION" || resumeType === "SIGNUP") && isSafeReturnPath(resumeId)) {
    const { exp, sig } = signReturn("reservation", resumeId);
    return `${base}&flow=r&ret=${encodeURIComponent(resumeId)}&exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
  }
  return base;
}

/**
 * Builds the /reset-password link. When the reset was requested mid
 * reservation (validated returnTo), the link carries a signed marker under
 * its own scope ("pwreset" — never interchangeable with verification
 * markers) so the reset page can bring the customer straight back to their
 * booking afterwards. Normal resets get the exact URL shape as before.
 */
export function buildResetPasswordUrl(token, returnTo = null) {
  const base = `${
    process.env.NEXTAUTH_URL || "http://localhost:3000"
  }/reset-password?token=${encodeURIComponent(token)}`;
  if (!isSafeReturnPath(returnTo)) return base;
  const { exp, sig } = signReturn("pwreset", returnTo);
  return `${base}&flow=pw&ret=${encodeURIComponent(returnTo)}&exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
}

/** Validates a signed password-reset return marker. Fail-closed on anything. */
export function checkResetReturn(returnTo, exp, sig) {
  return checkReturn("pwreset", returnTo, exp, sig);
}
