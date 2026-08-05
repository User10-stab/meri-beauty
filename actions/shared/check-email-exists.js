"use server";

import { prisma } from "@/lib/prisma";

/**
 * Returns whether an email address already belongs to a usable account —
 * verified, active, and not deleted. An unverified account isn't something
 * the person can actually log into yet, so it's deliberately excluded here:
 * callers should treat that case the same as a brand-new email (falls
 * through to whatever "new customer" flow they run), not nudge someone
 * toward a login that would just fail.
 *
 * @param {string} email
 * @returns {Promise<{ exists: boolean }>}
 */
export async function checkEmailExists(email) {
  if (!email || typeof email !== "string") return { exists: false };

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isDeleted: true, emailVerified: true, isActive: true },
  });

  return { exists: Boolean(user && !user.isDeleted && user.emailVerified && user.isActive) };
}
