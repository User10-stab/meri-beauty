import { headers } from "next/headers";

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

/** Real client IP from the proxy-set header, not a hardcoded placeholder. */
export async function getClientIp() {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
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
