import crypto from "crypto";

/**
 * Generates a short-lived cryptographically signed token for automatic login.
 * Valid for 10 minutes.
 * 
 * @param {string} email 
 * @returns {string} The formatted token: "expiresAt:hmac"
 */
export function generateAutologinToken(email) {
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes validity
  const secret = process.env.AUTH_SECRET || "fallback_secret";
  const data = `${email}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
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
    const secret = process.env.AUTH_SECRET || "fallback_secret";
    const data = `${email}:${expiresAt}`;
    const expectedHmac = crypto.createHmac("sha256", secret).update(data).digest("hex");
    return hmac === expectedHmac;
  } catch (e) {
    return false;
  }
}
