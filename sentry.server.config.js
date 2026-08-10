import * as Sentry from "@sentry/nextjs";

// Node.js runtime (Server Actions, API routes, server-rendered pages).
// See instrumentation.js for how this gets loaded.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Low sample rate — this is a low-traffic salon site, not a target for
  // heavy performance-trace volume, and Sentry's free tier caps event count.
  tracesSampleRate: 0.1,

  // Errors are the whole point here; don't drop any of them to sampling.
  sampleRate: 1.0,
});
