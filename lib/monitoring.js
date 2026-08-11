import * as Sentry from "@sentry/nextjs";

/**
 * Thin wrapper around Sentry so call sites don't each decide their own tag
 * shape. `area` groups events by subsystem (stripe-webhook, email,
 * refund-reconciliation, stock-capacity, ...) so a Sentry alert rule can
 * filter on it without touching this file again for every new spot.
 *
 * Safe to call even without SENTRY_DSN configured — Sentry.init() in
 * sentry.server.config.js/instrumentation-client.js sets `enabled: false`
 * in that case, so these become no-ops rather than throwing.
 */

/**
 * A real bug or an operation that failed and needs investigation, but not
 * urgent enough to page someone immediately (e.g. a single email send
 * failure that a retry loop will pick up).
 */
export function captureError(error, { area, ...extra } = {}) {
  console.error(`[monitoring:${area ?? "unknown"}]`, error, extra);
  Sentry.captureException(error, {
    level: "error",
    tags: { area },
    extra,
  });
}

/**
 * Money or data-integrity is at stake — failed Stripe webhook processing,
 * exhausted refund retries, reconciliation failures. Tagged `critical:true`
 * so a Sentry alert rule can page/email on this tag alone, independent of
 * which `area` it came from.
 */
export function captureCriticalError(error, { area, ...extra } = {}) {
  console.error(`[monitoring:${area ?? "unknown"}:CRITICAL]`, error, extra);
  Sentry.captureException(error, {
    level: "fatal",
    tags: { area, critical: true },
    extra,
  });
}

/**
 * An expected business event worth tracking in aggregate (a stock race lost,
 * a workshop selling out between page load and checkout) — not a bug, but a
 * trend worth seeing if it spikes. Never alerts on its own.
 */
export function captureWarning(message, { area, ...extra } = {}) {
  console.warn(`[monitoring:${area ?? "unknown"}]`, message, extra);
  Sentry.captureMessage(message, {
    level: "warning",
    tags: { area },
    extra,
  });
}
