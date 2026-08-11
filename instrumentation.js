import * as Sentry from "@sentry/nextjs";

/**
 * Next.js server-startup hook (stable since Next 15, runs once per process,
 * before any request is handled). Used here to start the in-process job
 * scheduler — see lib/background-jobs.js for what it runs and why — and to
 * initialize Sentry error monitoring.
 *
 * Guarded to the Node.js runtime only: this file is also invoked once for
 * the Edge runtime in some setups, and setInterval + Prisma have no business
 * running there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Every appointment/workshop/formation time is booked, checked, and
    // displayed as Brussels wall-clock (staff working-hours "HH:mm" strings,
    // closures, reminders — see lib/slot-availability.js and
    // lib/appointment-scheduling.js) via JS Date's *local* getHours/setHours/
    // getFullYear. That's only correct if the process's system timezone is
    // actually Europe/Brussels — a bare VPS or container defaults to UTC,
    // which would silently book and display every appointment 1-2h off, by a
    // *different* amount in summer vs winter since Brussels alternates
    // CET/CEST. Pin it explicitly here, once, before anything touches a
    // Date, rather than relying on the host's `/etc/timezone`.
    process.env.TZ = process.env.TZ || "Europe/Brussels";

    await import("./sentry.server.config");
    const { startBackgroundJobs } = await import("@/lib/background-jobs");
    startBackgroundJobs();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Catches errors Next.js's own request pipeline surfaces (render, route
// handler, Server Action, proxy) that never reach a try/catch of ours —
// the automatic half of "server errors" from the error-monitoring rollout.
export const onRequestError = Sentry.captureRequestError;
