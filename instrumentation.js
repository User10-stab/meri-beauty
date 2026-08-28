/**
 * Next.js instrumentation hook. Runs once when the server process boots
 * (both `next start` and `next dev`), in the Node.js runtime — the right
 * place to pin the process timezone and warm any process-wide caches that
 * every request later reads.
 *
 * Timezone: the whole app treats staff-entered "HH:mm" working hours and
 * Brussels wall-clock times as Europe/Brussels (see tests/critical/
 * timezone.test.js). If a container/VPS defaults to UTC (or any fixed offset),
 * every stored UTC instant from those times is silently wrong across DST. Pin
 * it before anything else runs.
 *
 * We also preload the salon branding (logo / phone / address) used by the
 * email shell so the very first email goes out with the full header rather
 * than degrading to the wordmark-only fallback. If the DB isn't reachable
 * yet (edge of boot order), htmlWrapper still degrades gracefully and the
 * next refresh attempt (and the next process) recovers it.
 */
export async function register() {
  // Pin the timezone to Brussels. A previously-set TZ (e.g. in a test) wins,
  // so this is idempotent and never overrides an explicit override.
  process.env.TZ = process.env.TZ || "Europe/Brussels";

  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { refreshSalonBranding } = await import("@/lib/email-templates");
      await refreshSalonBranding();
    } catch (err) {
      console.error("[instrumentation] refreshSalonBranding failed on boot:", err);
    }
  }
}
