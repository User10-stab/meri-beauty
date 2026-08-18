"use server";

import { prisma } from "@/lib/prisma";
import { getClientIp, consumeSharedRateLimit, hashRateLimitValue } from "@/lib/rate-limit";

// This is a public, unauthenticated existence-check with no proof the caller
// owns the email they're asking about — its whole attack shape is one caller
// trying many different addresses, so it's rate-limited per IP alone (not
// per email+IP like login/forgot-password) to actually slow a scraping run
// rather than just capping repeats of one address.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

/**
 * Returns whether an email address already belongs to a usable account —
 * verified, active, and not deleted. An unverified account isn't something
 * the person can actually log into yet, so it's deliberately excluded here:
 * callers should treat that case the same as a brand-new email (falls
 * through to whatever "new customer" flow they run), not nudge someone
 * toward a login that would just fail.
 *
 * Never returns anything beyond the boolean — this used to also hand back
 * the account's phone number for a returning customer's convenience, but
 * with no session and no proof of ownership, that turned an "email
 * exists?" check into an unauthenticated email → phone lookup for anyone
 * who cared to try addresses. `exists` alone is already the same class of
 * enumeration every login/forgot-password flow accepts as a rate-limited
 * tradeoff; a phone number is not.
 *
 * @param {string} email
 * @returns {Promise<{ exists: boolean }>}
 */
export async function checkEmailExists(email) {
  if (!email || typeof email !== "string") return { exists: false };

  const ip = await getClientIp();
  if (await consumeSharedRateLimit("check-email-exists", hashRateLimitValue(ip), { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
    return { exists: false };
  }

  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isDeleted: false },
    select: { isDeleted: true, emailVerified: true, isActive: true },
  });

  const exists = Boolean(user && !user.isDeleted && user.emailVerified && user.isActive);
  return { exists };
}
