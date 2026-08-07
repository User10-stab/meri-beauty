import { expireStaleOrders } from "@/actions/boutique/orders";
import { sendWorkshopReservationReminders } from "@/actions/workshops/send-reminders";
import { sendFormationReservationReminders } from "@/actions/formations/send-reminders";
import { sendAppointmentReminders } from "@/actions/appointment/reminders";

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
    const [orders, workshopReminders, formationReminders, appointmentReminders] = await Promise.all([
      expireStaleOrders(),
      sendWorkshopReservationReminders(),
      sendFormationReservationReminders(),
      sendAppointmentReminders(),
    ]);
    if (orders.expiredCount || workshopReminders.sentCount || formationReminders.sentCount || appointmentReminders.sentCount) {
      console.log(
        `[background-jobs] expired ${orders.expiredCount} order(s), sent ${workshopReminders.sentCount} workshop + ${formationReminders.sentCount} formation + ${appointmentReminders.sentCount} appointment reminder(s)`
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
