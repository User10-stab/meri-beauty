import crypto from "crypto";

// timingSafeEqual requires equal-length buffers and throws otherwise — an
// attacker-controlled header of the wrong length must fail closed, not
// leak timing information via a length mismatch (see lib/autologin.js).
// Shared by every /api/cron/* route so they all fail closed the same way.
export function isValidCronSecret(authHeader, secret) {
  if (!secret || !authHeader) return false;
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
