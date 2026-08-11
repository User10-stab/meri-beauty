import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendAppointmentReminders } from "@/lib/reminders/send-appointment-reminders";
import { isValidCronSecret } from "@/lib/cron-auth";

/**
 * Secured job runner — appointment reminders (24h + 2h windows). Split from
 * app/api/cron/route.js (boutique/workshops/formations) so appointment jobs
 * can be triggered/monitored independently; same CRON_SECRET, same header:
 *
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Non-blocking: if a previous invocation is still running (the external
  // scheduler firing again before the last run finished), skip this one
  // rather than let both send the same reminder twice. Own lock key —
  // independent from app/api/cron/route.js's runner, which may legitimately
  // run at the same time as this one, just not overlap with itself.
  return prisma.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext('meri-beauty-cron-appointments-runner')) AS locked`;
      if (!locked) {
        return NextResponse.json({ success: true, skipped: "A previous run is still in progress." }, { status: 200 });
      }

      try {
        const result = await sendAppointmentReminders();
        return NextResponse.json({ success: true, remindersSent: result.sentCount });
      } catch (error) {
        console.error("[api/cron/appointments] job failed:", error);
        return NextResponse.json({ error: "Job failed" }, { status: 500 });
      }
    },
    { timeout: 30_000, maxWait: 5_000 }
  );
}
