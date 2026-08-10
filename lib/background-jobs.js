import { expireStaleOrders } from "@/lib/orders/expire-stale-orders";
import { sendWorkshopReservationReminders } from "@/lib/reminders/send-workshop-reminders";
import { sendFormationReservationReminders } from "@/lib/reminders/send-formation-reminders";
import { sendAppointmentReminders } from "@/lib/reminders/send-appointment-reminders";
import { expireStaleWorkshopHolds } from "@/lib/workshops/expire-stale-holds";
import { expireStaleFormationHolds } from "@/lib/formations/expire-stale-holds";
import { retryFailedRefunds } from "@/lib/payments/retry-failed-refunds";

// Same jobs app/api/cron/route.js + app/api/cron/appointments/route.js
// expose over HTTP, run in-process instead. A self-hosted single Node
// process (the planned OVH target) doesn't need an external scheduler at
// all — this just calls the DB directly on an interval, same as any other
// server-side code. The HTTP routes stay too: still useful for a manual
// trigger, a GitHub Actions workflow, or monitoring, and every job here is
// safe to run concurrently with its own HTTP-triggered run — expireStaleOrders
// claims each order atomically (`updateMany` gated on current status), and
// both reminder jobs dedupe via a Notification row per window, so whichever
// run gets there first wins and the other is a no-op.
const INTERVAL_MS = 5 * 60 * 1000;

async function runJobs() {
  try {
    const [orders, workshopReminders, formationReminders, appointmentReminders, workshopHolds, formationHolds, refundRetries] = await Promise.all([
      expireStaleOrders(),
      sendWorkshopReservationReminders(),
      sendFormationReservationReminders(),
      sendAppointmentReminders(),
      expireStaleWorkshopHolds(),
      expireStaleFormationHolds(),
      retryFailedRefunds(),
    ]);
    if (
      orders.expiredCount ||
      workshopReminders.sentCount ||
      formationReminders.sentCount ||
      appointmentReminders.sentCount ||
      workshopHolds.expiredCount ||
      formationHolds.expiredCount ||
      refundRetries.retried
    ) {
      console.log(
        `[background-jobs] expired ${orders.expiredCount} order(s), ${workshopHolds.expiredCount} workshop hold(s), ${formationHolds.expiredCount} formation hold(s), sent ${workshopReminders.sentCount} workshop + ${formationReminders.sentCount} formation + ${appointmentReminders.sentCount} appointment reminder(s), retried ${refundRetries.retried} refund(s) (${refundRetries.succeeded} recovered, ${refundRetries.exhausted} exhausted)`
      );
    }
  } catch (error) {
    console.error("[background-jobs] run failed:", error);
  }
}

/**
 * Starts the interval once per server process. Guarded on `globalThis`
 * because Next dev's hot module reloading re-imports this module on every
 * edit without restarting the process — without the guard, each edit would
 * stack another interval running the same jobs.
 */
export function startBackgroundJobs() {
  if (globalThis.__meriBackgroundJobsStarted) return;
  globalThis.__meriBackgroundJobsStarted = true;

  console.log(`[background-jobs] started, running every ${INTERVAL_MS / 60000} min`);
  runJobs();
  setInterval(runJobs, INTERVAL_MS);
}
