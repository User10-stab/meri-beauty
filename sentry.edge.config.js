import * as Sentry from "@sentry/nextjs";

// Edge runtime (proxy.js / middleware). Kept separate from
// sentry.server.config.js because the Edge runtime can't use every Node API
// the Sentry SDK otherwise relies on.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  sampleRate: 1.0,
});
