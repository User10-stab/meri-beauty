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
import { sendScheduledCampaigns } from "@/lib/campaigns/send-campaign";
import { sendDailyStaffInvoices, todayInBrussels } from "@/lib/staff-monthly-billing";
import { autoCloseCashSession } from "@/lib/cash-book/auto-session";
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

/** "2026-10-01" — the Brussels calendar day, the unit staff billing runs on. */
function brusselsDayKey() {
  const { year, month, day } = todayInBrussels();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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
  // Campagnes planifiées : claim atomique interne (bail 10 min) contre le
  // run concurrent de /api/cron — pas de double envoi, cf. lib/campaigns/.
  ["sendScheduledCampaigns", sendScheduledCampaigns],
  // Instagrams long-lived token expire after ~60 jours. On rafraîchit
  // le token s'il reste moins de 7 jours avant expiration, pour éviter
  // les interruptions toutes les 2 mois.
  ["refreshInstagramToken", refreshInstagramToken],
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
    lastBillingRunAt: null,
    lastBillingDay: null,
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

  // Staff monthly billing — once per Brussels day, checks nextInvoiceDate <= today.
  // Generation only: invoices are never emailed automatically, the admin
  // sends them manually from the dashboard. Runs on the first tick of each
  // new day (≤ 5 min after midnight) and once at boot. It used to be a 24h
  // cooldown counted from the last restart, so a rent due on the 1st only
  // appeared at whatever hour the app was last deployed (user, 2026-10-01).
  // A failed run leaves lastBillingDay unset: the next tick retries.
  const billingHeartbeat = heartbeat();
  const billingDay = brusselsDayKey();

  if (billingHeartbeat.lastBillingDay !== billingDay) {
    try {
      const billing = await sendDailyStaffInvoices();
      results.sendDailyStaffInvoices = billing;
      billingHeartbeat.lastBillingRunAt = Date.now();
      billingHeartbeat.lastBillingDay = billingDay;
      if (billing.errors > 0) {
        console.error(`[background-jobs] sendDailyStaffInvoices: ${billing.errors} error(s) — check admin invoice history`);
      }
    } catch (err) {
      failedJobs.push("sendDailyStaffInvoices");
      captureCriticalError(err, { area: "background-jobs", job: "sendDailyStaffInvoices" });
    }
  }

  // Livre de caisse auto-close — always at midnight Brussels time, regardless
  // of the salon's listed closing time (real sales still happen past 10pm).
  //
  // No cooldown, deliberately. autoCloseCashSession now refuses to close a
  // session opened on the current Brussels day, which is a far stronger gate
  // than a 24h in-memory timer: the timer reset on every process restart, and
  // stopped being written at all when the job threw after its DB work (see
  // revalidate-caisse.js). Both failure modes produced an open/close cycle
  // every 5 minutes. Calling it unconditionally is now simply a no-op until
  // the day actually rolls over.
  //
  // There is no auto-OPEN counterpart any more: the till opens on the first
  // cash-taking action via ensureCashSessionOpen, never on a timer.
  try {
    results.autoCloseCashSession = await autoCloseCashSession();
  } catch (err) {
    failedJobs.push("autoCloseCashSession");
    captureCriticalError(err, { area: "background-jobs", job: "autoCloseCashSession" });
  }

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
  const staffInvoicing = results.sendDailyStaffInvoices;
  const cashAutoClose = results.autoCloseCashSession;

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
    missedCheckouts?.flagged ||
    staffInvoicing?.generated > 0 ||
    cashAutoClose?.closed
  ) {
    console.log(
      `[background-jobs] expired ${orders?.expiredCount ?? 0} order(s), released ${releasedPickups?.releasedCount ?? 0} unverified pickup(s), notified staff of ${staleFulfilment?.notifiedCount ?? 0} stalled order(s), ${stalePendingAppointments?.expiredCount ?? 0} stale pending appointment(s), ${workshopHolds?.expiredCount ?? 0} workshop hold(s), ${formationHolds?.expiredCount ?? 0} formation hold(s), sent ${workshopReminders?.sentCount ?? 0} workshop + ${formationReminders?.sentCount ?? 0} formation + ${appointmentReminders?.sentCount ?? 0} appointment reminder(s), ${unsettledDigest?.emailSent ? `sent unsettled-appointments digest (${unsettledDigest.staleCount})` : "no unsettled-appointments digest due"}, recovered ${missedRefunds?.reconciled ?? 0} missed Stripe refund(s) out of ${missedRefunds?.checked ?? 0} checked, recovered ${missedCheckouts?.reconciled ?? 0} missed checkout confirmation(s) out of ${missedCheckouts?.checked ?? 0} checked, flagged ${missedCheckouts?.flagged ?? 0} for manual review${staffInvoicing?.generated > 0 ? `, generated ${staffInvoicing.generated} staff invoice(s) (${staffInvoicing.skipped} skipped, ${staffInvoicing.emailFailed} email-failed, ${staffInvoicing.errors} error(s))` : ""}${cashAutoClose?.closed ? `, auto-closed the till (expected ${cashAutoClose.expectedCash})` : ""}`
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
 * Refreshes the Instagram access token using the stored refresh token.
 * Only actually refreshes if the current token is within 7 days of expiry.
 * Runs on every 5-minute tick — the function itself is a no-op when the
 * token is fresh, so there's no performance concern.
 */
export async function refreshInstagramToken() {
  const token = globalThis.__meriInstagramToken;
  const refreshToken = globalThis.__meriInstagramRefreshToken;

  if (!token || !refreshToken) {
    // No tokens available yet — nothing to do
    return;
  }

  // If the token has more than 7 days before expiry, skip the refresh
  const now = Date.now();
  if (token.expiresAt && now + 7 * 24 * 60 * 60 * 1000 < token.expiresAt) {
    return; // token is fresh enough
  }

  // Re-use the refresh logic from lib/instagram.js
  try {
    const { igFetch } = await import("@/lib/instagram");
    // igFetch uses the access_token from env, but we need to temporarily
    // set a new one. Instead, directly call the refresh endpoint.
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", refreshToken);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url.toString(), {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      console.error(
        "[background-jobs] Instagram token refresh failed HTTP",
        res.status,
        ":",
        body
      );
      return;
    }

    const data = await res.json();

    if (!data.access_token) {
      console.error(
        "[background-jobs] Instagram token refresh missing access_token:",
        data
      );
      return;
    }

    const newExpiresAt = Date.now() + (data.expires_in - 300) * 1000; // 5-min buffer

    // Update in-memory tokens
    globalThis.__meriInstagramToken = {
      accessToken: data.access_token,
      isExpired: false,
      expiresAt: newExpiresAt,
    };

    if (data.refresh_token) {
      globalThis.__meriInstagramRefreshToken = data.refresh_token;
    }

    // Persist to DB
    if (globalThis.__meriPrisma) {
      await globalThis.__meriPrisma.salon.update({
        where: { id: "main-salon" },
        data: {
          instagramAccessToken: data.access_token,
          instagramRefreshToken: data.refresh_token || refreshToken,
          instagramTokenExpiresAt: newExpiresAt,
        },
      });
    }

    console.log(
      "[background-jobs] Instagram token refreshed, new expires at",
      new Date(newExpiresAt)
    );
  } catch (err) {
    console.error("[background-jobs] Instagram token refresh failed:", err.message);
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
