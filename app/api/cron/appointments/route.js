import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAppointmentReminders } from "@/lib/reminders/send-appointment-reminders";
import { notifyUnsettledAppointments } from "@/lib/appointments/notify-unsettled-appointments";
import { isValidCronSecret } from "@/lib/cron-auth";
import { captureCriticalError } from "@/lib/monitoring";

/**
 * Secured job runner — appointment reminders (24h + 2h windows) and the
 * unsettled-appointments digest. Split from app/api/cron/route.js
 * (boutique/workshops/formations) so appointment jobs can be
 * triggered/monitored independently; same CRON_SECRET, same header:
 *
 *   Authorization: Bearer <CRON_SECRET>
 */
const JOBS = [
  ["sendAppointmentReminders", sendAppointmentReminders],
  ["notifyUnsettledAppointments", notifyUnsettledAppointments],
];

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Non-blocking: if a previous invocation is still running (the external
  // scheduler firing again before the last run finished), skip this one
  // rather than let both send the same reminder/digest twice. Own lock key —
  // independent from app/api/cron/route.js's runner, which may legitimately
  // run at the same time as this one, just not overlap with itself.
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('meri-beauty-cron-appointments-runner')) AS locked`;
      if (!locked) {
        return NextResponse.json({ success: true, skipped: "A previous run is still in progress." }, { status: 200 });
      }

      // allSettled, not all: one job throwing must never mask whether the
      // other one actually ran.
      const settled = await Promise.allSettled(JOBS.map(([, run]) => run()));

      const results = {};
      let anyFailed = false;
      settled.forEach((outcome, i) => {
        const [name] = JOBS[i];
        if (outcome.status === "fulfilled") {
          results[name] = outcome.value;
        } else {
          results[name] = null;
          anyFailed = true;
          captureCriticalError(outcome.reason, { area: "background-jobs", job: name, trigger: "http-cron" });
        }
      });

      return NextResponse.json({
        success: !anyFailed,
        remindersSent: results.sendAppointmentReminders?.sentCount ?? null,
        unsettledAppointmentsFound: results.notifyUnsettledAppointments?.staleCount ?? null,
        unsettledDigestSent: results.notifyUnsettledAppointments?.emailSent ?? null,
        failedJobs: settled
          .map((outcome, i) => (outcome.status === "rejected" ? JOBS[i][0] : null))
          .filter(Boolean),
      }, { status: anyFailed ? 207 : 200 });
    },
    { timeout: 30_000, maxWait: 5_000 }
  );
}
