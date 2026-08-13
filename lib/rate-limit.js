import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** Hashes a rate-limit key (email, IP) before it's stored as ApiRateLimitBucket.key — avoids persisting raw PII in that table. */
export function hashRateLimitValue(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * In-memory sliding-window rate limiter, namespaced so unrelated call sites
 * (login, forgot-password, verify-email) never share buckets.
 *
 * Known limitation: per-instance only — under a multi-instance deployment
 * each instance gets its own counter, so the effective limit is N ×
 * instances. Fine for a single-instance deploy; move to a shared store
 * (Upstash Redis, Vercel KV) before scaling out.
 */
const namespaces = new Map();

function bucket(namespace) {
  if (!namespaces.has(namespace)) namespaces.set(namespace, new Map());
  return namespaces.get(namespace);
}

/**
 * Real client IP from the proxy-set header.
 *
 * Production runs behind a SINGLE trusted reverse proxy (Nginx on the OVH
 * VPS), which appends the actual TCP remote address to X-Forwarded-For via
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`. The
 * trustworthy hop is therefore the RIGHTMOST entry. The leftmost is fully
 * client-controlled — trusting it (the old `split(",")[0]`) let anyone spoof
 * a fresh IP per request and bypass every per-IP rate limit (login brute
 * force, password-reset / verify-email e-mail bombing, etc.).
 *
 * If a second proxy or CDN (e.g. Cloudflare) is ever put in front, the
 * rightmost entry stops being trustworthy on its own — switch to validating
 * against a known trusted-proxy IP range (or an explicit hop count) instead
 * of assuming a single hop.
 */
export async function getClientIp() {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return h.get("x-real-ip") || "unknown";
}

/** True if `key` has already hit `max` hits within `windowMs`, in `namespace`. */
export function isRateLimited(namespace, key, { windowMs, max }) {
  const store = bucket(namespace);
  const now = Date.now();
  const recent = (store.get(key) || []).filter((ts) => now - ts < windowMs);
  // Evict dead keys the moment their window empties — otherwise a burst of
  // unique keys (e.g. rotated IPs on login) would accumulate forever. No
  // sweep timer needed: this runs on the same access that discovered the
  // emptiness.
  if (recent.length === 0) {
    store.delete(key);
  } else {
    store.set(key, recent);
  }
  return recent.length >= max;
}

/** Records one hit for `key` in `namespace` — call after isRateLimited() passes. */
export function recordRateLimitHit(namespace, key) {
  const store = bucket(namespace);
  const now = Date.now();
  const recent = store.get(key) || [];
  recent.push(now);
  store.set(key, recent);
}

/**
 * Atomically consumes one fixed-window request from a database-backed bucket.
 * This protects multi-instance deployments. If the shared store is briefly
 * unavailable, the existing per-instance limiter remains as a safe fallback.
 */
export async function consumeSharedRateLimit(namespace, key, { windowMs, max }) {
  const bucketKey = `${namespace}:${key}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowMs);

  try {
    const rows = await prisma.$queryRaw`
      INSERT INTO "ApiRateLimitBucket" ("key", "windowStart", "count", "updatedAt")
      VALUES (${bucketKey}, ${now}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "windowStart" = CASE
          WHEN "ApiRateLimitBucket"."windowStart" <= ${cutoff} THEN ${now}
          ELSE "ApiRateLimitBucket"."windowStart"
        END,
        "count" = CASE
          WHEN "ApiRateLimitBucket"."windowStart" <= ${cutoff} THEN 1
          ELSE "ApiRateLimitBucket"."count" + 1
        END,
        "updatedAt" = ${now}
      RETURNING "count"
    `;
    return Number(rows[0]?.count ?? max + 1) > max;
  } catch (error) {
    console.error("[consumeSharedRateLimit] shared store unavailable", error);
    if (isRateLimited(namespace, key, { windowMs, max })) return true;
    recordRateLimitHit(namespace, key);
    return false;
  }
}
