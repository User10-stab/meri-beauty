"use server";

import { createHash } from "node:crypto";
import { isValidVatFormat, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";
import { consumeSharedRateLimit, getClientIp } from "@/lib/rate-limit";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_PER_IP = 5;
const RATE_LIMIT_MAX_PER_VAT_NUMBER = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const resultCache = new Map();

function hashRateLimitValue(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function cachedResult(vatNumber) {
  const entry = resultCache.get(vatNumber);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    resultCache.delete(vatNumber);
    return null;
  }
  return entry.result;
}

function cacheResult(vatNumber, result) {
  if (resultCache.size >= CACHE_MAX_ENTRIES) {
    resultCache.delete(resultCache.keys().next().value);
  }
  resultCache.set(vatNumber, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Public lookup — checking whether a VAT number is registered is public
 * registry data (VIES itself requires no auth), so this is callable from
 * both the dashboard (Salon's own number) and public reservation forms
 * (a customer's B2B number) without a session.
 *
 * @param {string} vatNumber
 * @returns {Promise<{ success: boolean, valid?: boolean, name?: string, address?: string, message?: string }>}
 */
export async function verifyVatNumber(vatNumber) {
  if (!vatNumber || !vatNumber.trim()) {
    return { success: false, message: "Numéro de TVA manquant." };
  }

  const normalized = normalizeVatNumber(vatNumber);
  if (!isValidVatFormat(normalized)) {
    return { success: true, valid: false, message: "Format de numéro de TVA invalide." };
  }

  const cached = cachedResult(normalized);
  if (cached) return { ...cached, cached: true };

  const ip = await getClientIp();
  const ipLimited = await consumeSharedRateLimit("verify-vat-ip", hashRateLimitValue(ip), {
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_PER_IP,
  });
  if (ipLimited) {
    return { success: false, rateLimited: true, message: "Trop de vérifications depuis cette connexion. Réessayez dans 10 minutes." };
  }

  const vatLimited = await consumeSharedRateLimit("verify-vat-number", hashRateLimitValue(normalized), {
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX_PER_VAT_NUMBER,
  });
  if (vatLimited) {
    return { success: false, rateLimited: true, message: "Ce numéro a été vérifié trop souvent. Réessayez dans 10 minutes." };
  }

  const result = await verifyVatWithVies(normalized);
  if (result.success) {
    cacheResult(normalized, result);
  }
  return result;
}
