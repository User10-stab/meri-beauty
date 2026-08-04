import crypto from "crypto";

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // Fail hard rather than falling back to a publicly-known constant — a
    // silent fallback here means anyone can forge a valid autologin token
    // (passwordless login as any email) the moment AUTH_SECRET is unset.
    throw new Error("AUTH_SECRET is not set — cannot generate or verify autologin tokens.");
  }
  return secret;
}

/**
 * Generates a short-lived cryptographically signed token for automatic login.
 * Valid for 10 minutes.
 *
 * @param {string} email
 * @returns {string} The formatted token: "expiresAt:hmac"
 */
export function generateAutologinToken(email) {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity
  const data = `${email}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
  return `${expiresAt}:${hmac}`;
}

/**
 * Verifies the validity of an autologin token.
 *
 * @param {string} email
 * @param {string} token
 * @returns {boolean} True if the token is valid and not expired, false otherwise.
 */
export function verifyAutologinToken(email, token) {
  if (!email || !token) return false;
  try {
    const [expiresAtStr, hmac] = token.split(":");
    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) {
      return false; // Token expired
    }
    const data = `${email}:${expiresAt}`;
    const expectedHmac = crypto.createHmac("sha256", getSecret()).update(data).digest("hex");

    // timingSafeEqual requires equal-length buffers, and throws otherwise —
    // an attacker-controlled hmac of the wrong length must fail closed, not
    // crash into the catch block below in a way that could leak timing.
    const provided = Buffer.from(hmac ?? "", "hex");
    const expected = Buffer.from(expectedHmac, "hex");
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch (e) {
    return false;
  }
}
