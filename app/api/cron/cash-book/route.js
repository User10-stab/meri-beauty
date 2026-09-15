import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoOpenCashSession, autoCloseCashSession } from "@/lib/cash-book/auto-session";
import { isValidCronSecret } from "@/lib/cron-auth";
import { captureCriticalError } from "@/lib/monitoring";
import { recordExternalJobRun } from "@/lib/background-jobs";

/**
 * Livre de caisse auto-open / auto-close cron endpoint.
 *
 * Both are safe to call on every tick regardless of cadence: autoOpenCashSession
 * checks the salon's opening time and no-ops before it, or if a session is
 * already open; autoCloseCashSession no-ops if nothing is open. There is no
 * "once per day" state to coordinate here the way monthly billing needs —
 * that's the in-process interval's job (its own 24h cooldown, see
 * lib/background-jobs.js), this endpoint just runs both unconditionally.
 *
 * Secured identically to the other cron routes:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Intended schedule: every few minutes (e.g. "*\/5 * * * *"), same as the
 * general /api/cron endpoint.
 */
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lockResult = await prisma.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext('meri-beauty-cron-cash-book')) AS locked
  `;
  const locked = lockResult[0]?.locked;

  if (!locked) {
    return NextResponse.json(
      { success: true, skipped: "A previous cash-book run is still in progress." },
      { status: 200 }
    );
  }

  const startedAt = Date.now();
  const failedJobs = [];
  let autoOpen = null;
  let autoClose = null;

  try {
    try {
      autoOpen = await autoOpenCashSession();
    } catch (err) {
      failedJobs.push("autoOpenCashSession");
      captureCriticalError(err, { area: "background-jobs", job: "autoOpenCashSession", trigger: "http-cron" });
    }

    try {
      autoClose = await autoCloseCashSession();
    } catch (err) {
      failedJobs.push("autoCloseCashSession");
      captureCriticalError(err, { area: "background-jobs", job: "autoCloseCashSession", trigger: "http-cron" });
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('meri-beauty-cron-cash-book'))`.catch(() => {});
  }

  recordExternalJobRun({ startedAt, failedJobs });

  return NextResponse.json(
    { success: failedJobs.length === 0, autoOpen, autoClose, failedJobs },
    { status: failedJobs.length > 0 ? 207 : 200 }
  );
}
