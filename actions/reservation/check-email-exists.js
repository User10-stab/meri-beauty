"use server";

import { prisma } from "@/lib/prisma";

/**
 * Returns whether an email address already belongs to an active user.
 * Used by CustomerInfoStep to warn guests before they submit.
 *
 * @param {string} email
 * @returns {Promise<{ exists: boolean }>}
 */
export async function checkEmailExists(email) {
  if (!email || typeof email !== "string") return { exists: false };

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, isDeleted: true },
  });

  return { exists: Boolean(user && !user.isDeleted) };
}
