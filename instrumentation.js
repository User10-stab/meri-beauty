import * as Sentry from "@sentry/nextjs";

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
    // Sentry server init was accidentally dropped (with the background-jobs
    // start below) when this file was rewritten — restore it before anything
    // else so boot-time errors are captured too.
    try {
      await import("./sentry.server.config");
    } catch (err) {
      console.error("[instrumentation] sentry.server.config failed on boot:", err);
    }

    try {
      const { refreshSalonBranding } = await import("@/lib/email-templates");
      await refreshSalonBranding();
    } catch (err) {
      console.error("[instrumentation] refreshSalonBranding failed on boot:", err);
    }

    // In-process scheduler (reminders, expiry, refund reconciliation) — read by
    // /api/health's heartbeat. Each step is guarded so one failure can't
    // silently keep the jobs from starting.
    try {
      const { startBackgroundJobs } = await import("@/lib/background-jobs");
      startBackgroundJobs();
    } catch (err) {
      console.error("[instrumentation] startBackgroundJobs failed on boot:", err);
    }

    // Initialize Instagram tokens from DB (or env fallback) so the refresh
    // job can work immediately. This also sets up __meriInstagramToken in memory.
    try {
      const { initInstagramTokens } = await import("@/lib/instagram");
      // Try to load from prisma first; if DB not ready yet, fallback to env
      let prismaToken = null;
      let prismaRefresh = null;
      let prismaExpires = null;
      try {
        const { prisma } = await import("@/lib/prisma");
        const salon = await prisma.salon.findUnique({ where: { id: "main-salon" } });
        if (salon?.instagramAccessToken) {
          prismaToken = salon.instagramAccessToken;
          prismaRefresh = salon.instagramRefreshToken;
          prismaExpires = salon.instagramTokenExpiresAt;
        }
      } catch (e) {
        // DB not ready yet — ignore, env fallback will handle it
        console.debug("[instrumentation] Instagram DB not ready on boot, using env fallback");
      }
      await initInstagramTokens({
        accessToken: prismaToken,
        refreshToken: prismaRefresh,
        expiresAt: prismaExpires,
      });
    } catch (err) {
      console.error("[instrumentation] initInstagramTokens failed on boot:", err);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Catches errors Next.js's own request pipeline surfaces (render, route
// handler, Server Action, proxy) that never reach a try/catch of ours.
export const onRequestError = Sentry.captureRequestError;
