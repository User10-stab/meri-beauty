import { NextResponse } from "next/server";
import { expireStaleOrders } from "@/actions/boutique/orders";
import { sendWorkshopReservationReminders } from "@/actions/workshops/send-reminders";
import { sendFormationReservationReminders } from "@/actions/formations/send-reminders";
import { isValidCronSecret } from "@/lib/cron-auth";

/**
 * Secured job runner — boutique order expiry + atelier/formation reminders.
 *
 * Appointment-side jobs (reminders, etc.) live in
 * app/api/cron/appointments/route.js instead — separate endpoint, same auth
 * helper, so each domain's jobs can be triggered/monitored independently.
 *
 * Deliberately not wired through vercel.json's `crons` config: the plan is
 * to move off Vercel to a dedicated OVH host, and a vercel.json cron
 * schedule wouldn't survive that move. Instead this is a plain endpoint an
 * external scheduler calls periodically (cron-job.org, a GitHub Actions
 * scheduled workflow, or eventually the OVH box's own crontab running
 * `curl`) — whatever's triggering it, it always needs the same header:
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * CRON_SECRET must be set in the environment (added to .env locally; also
 * needs adding to Vercel's project env vars for the deployed site — that's
 * a dashboard action, not something this code can do).
 */
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [orders, workshopReminders, formationReminders] = await Promise.all([
      expireStaleOrders(),
      sendWorkshopReservationReminders(),
      sendFormationReservationReminders(),
    ]);

    return NextResponse.json({
      success: true,
      ordersExpired: orders.expiredCount,
      workshopRemindersSent: workshopReminders.sentCount,
      formationRemindersSent: formationReminders.sentCount,
    });
  } catch (error) {
    console.error("[api/cron] job failed:", error);
    return NextResponse.json({ error: "Job failed" }, { status: 500 });
  }
}
