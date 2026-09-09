import { expireStaleOrders, releaseUnverifiedPickups } from "@/lib/orders/expire-stale-orders";
import { notifyStaleOrderFulfilment } from "@/lib/orders/notify-stale-fulfilment";
import { sendWorkshopReservationReminders } from "@/lib/reminders/send-workshop-reminders";
import { sendFormationReservationReminders } from "@/lib/reminders/send-formation-reminders";
import { sendAppointmentReminders } from "@/lib/reminders/send-appointment-reminders";
import { notifyUnsettledAppointments } from "@/lib/appointments/notify-unsettled-appointments";
import { expireStalePendingAppointments } from "@/lib/appointments/expire-stale-appointments";
import { expireStaleWorkshopHolds } from "@/lib/workshops/expire-stale-holds";
import { expireStaleFormationHolds } from "@/lib/formations/expire-stale-holds";
import { reconcileMissedRefunds } from "@/lib/payments/reconcile-missed-refunds";
import { reconcileMissedCheckouts } from "@/lib/payments/reconcile-missed-checkouts";
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

/**
 * Which scheduler actually runs the jobs. There are two mechanisms in this
 * codebase — this in-process interval, and the two secured /api/cron
 * endpoints an external scheduler calls — and until now both ran at once
 * whenever an external scheduler was configured. Every job is idempotent
 * (status-gated claims plus an advisory lock on the cron runner), so that was
 * safe rather than broken, but it doubled the work and left nobody able to say
 * which mechanism production actually depends on.
 *
 *   JOBS_RUNNER=external  -> the interval does not start; /api/cron and
 *                            /api/cron/appointments are the schedule.
 *   anything else         -> in-process interval (the default, so an existing
 *                            deployment that sets nothing keeps working).
 *
 * The default is deliberately the running one: a typo in this variable must
 * not silently stop every reminder and expiry job.
 */
export const JOBS_RUNNER = process.env.JOBS_RUNNER === "external" ? "external" : "in-process";

/**
 * How long the heartbeat may go quiet in external mode before /api/health
 * calls the scheduler down. The external cadence is chosen outside this
 * codebase, so it cannot be derived from INTERVAL_MS — 30 minutes is a
 * deliberately loose default that still catches "the scheduler stopped
 * calling us", which is the failure that matters.
 */
const EXTERNAL_MAX_SILENCE_MS = Math.max(
  Number(process.env.JOBS_EXTERNAL_MAX_SILENCE_MINUTES) || 30,
  5,
) * 60 * 1000;

const JOBS = [
  ["expireStaleOrders", expireStaleOrders],
  ["releaseUnverifiedPickups", releaseUnverifiedPickups],
  ["notifyStaleOrderFulfilment", notifyStaleOrderFulfilment],
  ["sendWorkshopReservationReminders", sendWorkshopReservationReminders],
  ["sendFormationReservationReminders", sendFormationReservationReminders],
  ["sendAppointmentReminders", sendAppointmentReminders],
  ["notifyUnsettledAppointments", notifyUnsettledAppointments],
  ["expireStalePendingAppointments", expireStalePendingAppointments],
  ["expireStaleWorkshopHolds", expireStaleWorkshopHolds],
  ["expireStaleFormationHolds", expireStaleFormationHolds],
  ["reconcileMissedRefunds", reconcileMissedRefunds],
  ["reconcileMissedCheckouts", reconcileMissedCheckouts],
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

/**
 * Records a tick performed by the external scheduler, so one heartbeat — and
 * therefore one /api/health answer — is meaningful whichever runner is in use.
 * Without this, switching to JOBS_RUNNER=external would leave the health
 * endpoint reporting "scheduler down" forever, which is worse than the
 * duplication it replaces.
 */
export function recordExternalJobRun({ failedJobs = [], startedAt = null } = {}) {
  const beat = heartbeat();
  beat.lastRunAt = Date.now();
  beat.lastDurationMs = startedAt ? beat.lastRunAt - startedAt : beat.lastDurationMs;
  beat.runCount += 1;
  beat.lastFailedJobs = failedJobs;
  return beat;
}

export function getJobsHeartbeat() {
  const beat = globalThis.__meriJobsHeartbeat ?? null;
  const maxSilenceMs =
    JOBS_RUNNER === "external" ? EXTERNAL_MAX_SILENCE_MS : INTERVAL_MS * 2 + 60_000;
  if (!beat?.lastRunAt) {
    return { running: false, ...(beat ?? {}), mode: JOBS_RUNNER, intervalMs: INTERVAL_MS, maxSilenceMs };
  }
  const msSinceLastRun = Date.now() - beat.lastRunAt;
  return {
    // In-process: two missed ticks before calling it dead — one slow run (a
    // large refund reconciliation batch) shouldn't page anyone. External: the
    // cadence is set elsewhere, so a flat silence window is used instead.
    running: msSinceLastRun < maxSilenceMs,
    msSinceLastRun,
    mode: JOBS_RUNNER,
    intervalMs: INTERVAL_MS,
    maxSilenceMs,
    ...beat,
  };
}

async function runJobs() {
  const startedAt = Date.now();
  // allSettled, not all: one job throwing (e.g. a stale Stripe Connect
  // account inside reconcileMissedRefunds) must never prevent the other
  // seven from running or being reported — a single bad account previously
  // silently skipped order expiry, both reminder jobs, and refund reconciliation
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
  const releasedPickups = results.releaseUnverifiedPickups;
  const staleFulfilment = results.notifyStaleOrderFulfilment;
  const workshopReminders = results.sendWorkshopReservationReminders;
  const formationReminders = results.sendFormationReservationReminders;
  const appointmentReminders = results.sendAppointmentReminders;
  const unsettledDigest = results.notifyUnsettledAppointments;
  const stalePendingAppointments = results.expireStalePendingAppointments;
  const workshopHolds = results.expireStaleWorkshopHolds;
  const formationHolds = results.expireStaleFormationHolds;
  const missedRefunds = results.reconcileMissedRefunds;
  const missedCheckouts = results.reconcileMissedCheckouts;

  if (
    orders?.expiredCount ||
    releasedPickups?.releasedCount ||
    staleFulfilment?.notifiedCount ||
    workshopReminders?.sentCount ||
    formationReminders?.sentCount ||
    appointmentReminders?.sentCount ||
    unsettledDigest?.emailSent ||
    stalePendingAppointments?.expiredCount ||
    workshopHolds?.expiredCount ||
    formationHolds?.expiredCount ||
    missedRefunds?.reconciled ||
    missedCheckouts?.reconciled ||
    missedCheckouts?.flagged
  ) {
    console.log(
      `[background-jobs] expired ${orders?.expiredCount ?? 0} order(s), released ${releasedPickups?.releasedCount ?? 0} unverified pickup(s), notified staff of ${staleFulfilment?.notifiedCount ?? 0} stalled order(s), ${stalePendingAppointments?.expiredCount ?? 0} stale pending appointment(s), ${workshopHolds?.expiredCount ?? 0} workshop hold(s), ${formationHolds?.expiredCount ?? 0} formation hold(s), sent ${workshopReminders?.sentCount ?? 0} workshop + ${formationReminders?.sentCount ?? 0} formation + ${appointmentReminders?.sentCount ?? 0} appointment reminder(s), ${unsettledDigest?.emailSent ? `sent unsettled-appointments digest (${unsettledDigest.staleCount})` : "no unsettled-appointments digest due"}, recovered ${missedRefunds?.reconciled ?? 0} missed Stripe refund(s) out of ${missedRefunds?.checked ?? 0} checked, recovered ${missedCheckouts?.reconciled ?? 0} missed checkout confirmation(s) out of ${missedCheckouts?.checked ?? 0} checked, flagged ${missedCheckouts?.flagged ?? 0} for manual review`
    );
  }
  if (missedRefunds?.failures?.length > 0) {
    console.error("[background-jobs] reconcileMissedRefunds had failures:", missedRefunds.failures);
  }
  if (missedCheckouts?.failures?.length > 0) {
    console.error("[background-jobs] reconcileMissedCheckouts had failures:", missedCheckouts.failures);
  }
}

/**
 * Starts the interval once per server process. Guarded on `globalThis`
 * because Next dev's hot module reloading re-imports this module on every
 * edit without restarting the process — without the guard, each edit would
 * stack another interval running the same jobs.
 */
export function startBackgroundJobs() {
  if (JOBS_RUNNER === "external") {
    // Not an error and not a silent no-op: this is the one line that tells
    // someone reading the boot log which of the two mechanisms is live.
    console.log("[background-jobs] JOBS_RUNNER=external — interval not started, /api/cron drives the schedule");
    return;
  }
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
