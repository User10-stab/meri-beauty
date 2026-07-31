"use server";

import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "meri_site_access";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Unlocks the site when the correct password is provided.
 * The gate is only active when SITE_ACCESS_PASSWORD is set in the environment.
 * @param {string} password
 */
export async function unlockSite(password) {
  const expected = process.env.SITE_ACCESS_PASSWORD;

  if (!expected) {
    // Gate disabled — nothing to unlock.
    return { success: true };
  }

  if (typeof password !== "string" || password.trim() === "") {
    return { success: false, message: "Veuillez saisir le mot de passe." };
  }

  const inputHash = Buffer.from(sha256Hex(password), "hex");
  const expectedHash = Buffer.from(sha256Hex(expected), "hex");

  if (!timingSafeEqual(inputHash, expectedHash)) {
    return { success: false, message: "Mot de passe incorrect. Veuillez réessayer." };
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, inputHash.toString("hex"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return { success: true };
}
