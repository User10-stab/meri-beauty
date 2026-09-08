import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getJobsHeartbeat } from "@/lib/background-jobs";
import { isValidCronSecret } from "@/lib/cron-auth";

/**
 * Liveness + scheduler heartbeat.
 *
 * The background jobs (reminders, order/hold expiry, refund reconciliation) run
 * one of two ways, chosen by JOBS_RUNNER (see lib/background-jobs.js):
 * in-process on a 5-minute interval started from instrumentation.js, or from
 * an external scheduler calling /api/cron and /api/cron/appointments. Either
 * way was unobservable: if the process came back without the scheduler, or the
 * external scheduler stopped calling, nothing anywhere said so and the first
 * symptom would have been a customer never receiving their reminder.
 *
 * Both runners write the same heartbeat, so this endpoint means the same thing
 * in both modes; `scheduler.mode` says which one is expected to be feeding it.
 *
 * Two response shapes on purpose:
 *
 *  - Public (no auth): `{ status, scheduler: "up"|"down" }` only. Enough for an
 *    uptime monitor to alert on, with nothing worth harvesting.
 *  - With `Authorization: Bearer <CRON_SECRET>`: full detail — last run, how
 *    long it took, how many ticks so far, which jobs threw last time.
 *
 * Returns 503 when the database is unreachable or the scheduler has missed two
 * consecutive ticks, so a plain HTTP status check is meaningful on its own.
 */
export const dynamic = "force-dynamic";

export async function GET(req) {
  const detailed = isValidCronSecret(req.headers.get("authorization"), process.env.CRON_SECRET);

  let databaseUp = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    databaseUp = false;
    console.error("[health] database unreachable:", error?.message ?? error);
  }

  const heartbeat = getJobsHeartbeat();
  const healthy = databaseUp && heartbeat.running;
  const status = healthy ? 200 : 503;

  if (!detailed) {
    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        database: databaseUp ? "up" : "down",
        scheduler: heartbeat.running ? "up" : "down",
        // Safe to expose: it says which mechanism should be feeding the
        // heartbeat, not how to reach or trigger it.
        schedulerMode: heartbeat.mode,
      },
      { status }
    );
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database: databaseUp ? "up" : "down",
      scheduler: {
        running: heartbeat.running,
        mode: heartbeat.mode,
        maxSilenceMs: heartbeat.maxSilenceMs ?? null,
        startedAt: heartbeat.startedAt ? new Date(heartbeat.startedAt).toISOString() : null,
        lastRunAt: heartbeat.lastRunAt ? new Date(heartbeat.lastRunAt).toISOString() : null,
        msSinceLastRun: heartbeat.msSinceLastRun ?? null,
        lastDurationMs: heartbeat.lastDurationMs ?? null,
        intervalMs: heartbeat.intervalMs,
        runCount: heartbeat.runCount ?? 0,
        lastFailedJobs: heartbeat.lastFailedJobs ?? [],
      },
    },
    { status }
  );
}
