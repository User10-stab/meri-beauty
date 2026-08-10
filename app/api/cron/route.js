import { NextResponse } from "next/server";
import { expireStaleOrders } from "@/lib/orders/expire-stale-orders";
import { sendWorkshopReservationReminders } from "@/lib/reminders/send-workshop-reminders";
import { sendFormationReservationReminders } from "@/lib/reminders/send-formation-reminders";
import { expireStaleWorkshopHolds } from "@/lib/workshops/expire-stale-holds";
import { expireStaleFormationHolds } from "@/lib/formations/expire-stale-holds";
import { retryFailedRefunds } from "@/lib/payments/retry-failed-refunds";
import { reconcileMissedRefunds } from "@/lib/payments/reconcile-missed-refunds";
import { isValidCronSecret } from "@/lib/cron-auth";
import { captureCriticalError } from "@/lib/monitoring";

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
const JOBS = [
  ["expireStaleOrders", expireStaleOrders],
  ["sendWorkshopReservationReminders", sendWorkshopReservationReminders],
  ["sendFormationReservationReminders", sendFormationReservationReminders],
  ["expireStaleWorkshopHolds", expireStaleWorkshopHolds],
  ["expireStaleFormationHolds", expireStaleFormationHolds],
  ["retryFailedRefunds", retryFailedRefunds],
  ["reconcileMissedRefunds", reconcileMissedRefunds],
];

export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // allSettled, not all: one job throwing (e.g. a stale Stripe Connect
  // account inside reconcileMissedRefunds) must never mask whether the other
  // six actually ran — a single bad account previously turned this whole
  // endpoint into a 500 with no way to tell which job(s) were the problem.
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
    ordersExpired: results.expireStaleOrders?.expiredCount ?? null,
    workshopRemindersSent: results.sendWorkshopReservationReminders?.sentCount ?? null,
    formationRemindersSent: results.sendFormationReservationReminders?.sentCount ?? null,
    workshopHoldsExpired: results.expireStaleWorkshopHolds?.expiredCount ?? null,
    formationHoldsExpired: results.expireStaleFormationHolds?.expiredCount ?? null,
    refundsRetried: results.retryFailedRefunds?.retried ?? null,
    refundsRecovered: results.retryFailedRefunds?.succeeded ?? null,
    missedRefundsChecked: results.reconcileMissedRefunds?.checked ?? null,
    missedRefundsRecovered: results.reconcileMissedRefunds?.reconciled ?? null,
    failedJobs: settled
      .map((outcome, i) => (outcome.status === "rejected" ? JOBS[i][0] : null))
      .filter(Boolean),
  }, { status: anyFailed ? 207 : 200 });
}
