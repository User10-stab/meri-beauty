import { NextResponse } from "next/server";
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

  try {
    const result = await sendAppointmentReminders();
    return NextResponse.json({ success: true, remindersSent: result.sentCount });
  } catch (error) {
    console.error("[api/cron/appointments] job failed:", error);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
