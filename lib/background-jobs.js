import { expireStaleOrders } from "@/lib/orders/expire-stale-orders";
import { sendWorkshopReservationReminders } from "@/lib/reminders/send-workshop-reminders";
import { sendFormationReservationReminders } from "@/lib/reminders/send-formation-reminders";
import { sendAppointmentReminders } from "@/lib/reminders/send-appointment-reminders";
import { notifyUnsettledAppointments } from "@/lib/appointments/notify-unsettled-appointments";
import { expireStaleWorkshopHolds } from "@/lib/workshops/expire-stale-holds";
import { expireStaleFormationHolds } from "@/lib/formations/expire-stale-holds";
import { retryFailedRefunds } from "@/lib/payments/retry-failed-refunds";
import { reconcileMissedRefunds } from "@/lib/payments/reconcile-missed-refunds";
import { captureCriticalError } from "@/lib/monitoring";

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

const JOBS = [
  ["expireStaleOrders", expireStaleOrders],
  ["sendWorkshopReservationReminders", sendWorkshopReservationReminders],
  ["sendFormationReservationReminders", sendFormationReservationReminders],
  ["sendAppointmentReminders", sendAppointmentReminders],
  ["notifyUnsettledAppointments", notifyUnsettledAppointments],
  ["expireStaleWorkshopHolds", expireStaleWorkshopHolds],
  ["expireStaleFormationHolds", expireStaleFormationHolds],
  ["retryFailedRefunds", retryFailedRefunds],
  ["reconcileMissedRefunds", reconcileMissedRefunds],
];

/**
 * Last-run heartbeat, read by app/api/health/route.js.
 *
 * The scheduler is in-process: if PM2 restarts the app and something throws
 * before startBackgroundJobs() is reached, or the interval is silently lost,
 * nothing anywhere says so — reminders and order expiry would just stop, and
 * the first symptom would be a customer not receiving a reminder. Recording
 * the heartbeat on `globalThis` (not a module-level `let`) so Next dev's hot
 * reload, which re-imports this module, can't reset it out from under the
 * health route.
 */
function heartbeat() {
  globalThis.__meriJobsHeartbeat ??= {
    startedAt: null,
    lastRunAt: null,
    lastDurationMs: null,
    runCount: 0,
    lastFailedJobs: [],
  };
  return globalThis.__meriJobsHeartbeat;
}

export function getJobsHeartbeat() {
  const beat = globalThis.__meriJobsHeartbeat ?? null;
  if (!beat?.lastRunAt) {
    return { running: false, ...(beat ?? {}), intervalMs: INTERVAL_MS };
  }
  const msSinceLastRun = Date.now() - beat.lastRunAt;
  return {
    // Two missed ticks before calling it dead — one slow run (a large refund
    // reconciliation batch) shouldn't page anyone.
    running: msSinceLastRun < INTERVAL_MS * 2 + 60_000,
    msSinceLastRun,
    intervalMs: INTERVAL_MS,
    ...beat,
  };
}

async function runJobs() {
  const startedAt = Date.now();
  // allSettled, not all: one job throwing (e.g. a stale Stripe Connect
  // account inside reconcileMissedRefunds) must never prevent the other
  // seven from running or being reported — a single bad account previously
  // silently skipped order expiry, both reminder jobs, and refund retries
  // on every 5-minute tick until fixed.
  const settled = await Promise.allSettled(JOBS.map(([, run]) => run()));

  const results = {};
  const failedJobs = [];
  settled.forEach((outcome, i) => {
    const [name] = JOBS[i];
    if (outcome.status === "fulfilled") {
      results[name] = outcome.value;
    } else {
      results[name] = null;
      failedJobs.push(name);
      captureCriticalError(outcome.reason, { area: "background-jobs", job: name });
    }
  });

  // Written after allSettled, so a thrown job still counts as a live tick —
  // the heartbeat answers "is the scheduler running", and lastFailedJobs
  // separately answers "is it healthy".
  const beat = heartbeat();
  beat.lastRunAt = Date.now();
  beat.lastDurationMs = beat.lastRunAt - startedAt;
  beat.runCount += 1;
  beat.lastFailedJobs = failedJobs;

  const orders = results.expireStaleOrders;
  const workshopReminders = results.sendWorkshopReservationReminders;
  const formationReminders = results.sendFormationReservationReminders;
  const appointmentReminders = results.sendAppointmentReminders;
  const unsettledDigest = results.notifyUnsettledAppointments;
  const workshopHolds = results.expireStaleWorkshopHolds;
  const formationHolds = results.expireStaleFormationHolds;
  const refundRetries = results.retryFailedRefunds;
  const missedRefunds = results.reconcileMissedRefunds;

  if (
    orders?.expiredCount ||
    workshopReminders?.sentCount ||
    formationReminders?.sentCount ||
    appointmentReminders?.sentCount ||
    unsettledDigest?.emailSent ||
    workshopHolds?.expiredCount ||
    formationHolds?.expiredCount ||
    refundRetries?.retried ||
    missedRefunds?.reconciled
  ) {
    console.log(
      `[background-jobs] expired ${orders?.expiredCount ?? 0} order(s), ${workshopHolds?.expiredCount ?? 0} workshop hold(s), ${formationHolds?.expiredCount ?? 0} formation hold(s), sent ${workshopReminders?.sentCount ?? 0} workshop + ${formationReminders?.sentCount ?? 0} formation + ${appointmentReminders?.sentCount ?? 0} appointment reminder(s), ${unsettledDigest?.emailSent ? `sent unsettled-appointments digest (${unsettledDigest.staleCount})` : "no unsettled-appointments digest due"}, retried ${refundRetries?.retried ?? 0} refund(s) (${refundRetries?.succeeded ?? 0} recovered, ${refundRetries?.exhausted ?? 0} exhausted), recovered ${missedRefunds?.reconciled ?? 0} missed Stripe refund(s) out of ${missedRefunds?.checked ?? 0} checked`
    );
  }
  if (missedRefunds?.failures?.length > 0) {
    console.error("[background-jobs] reconcileMissedRefunds had failures:", missedRefunds.failures);
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

  heartbeat().startedAt = Date.now();
  console.log(`[background-jobs] started, running every ${INTERVAL_MS / 60000} min`);
  runJobs();
  // unref() so the interval never holds the process open on its own: PM2's
  // graceful restart sends SIGINT and waits, and a live 5-minute timer would
  // otherwise keep the old process alive until the kill timeout on every
  // single deploy.
  setInterval(runJobs, INTERVAL_MS).unref();
}
