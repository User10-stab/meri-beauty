import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoCloseCashSession } from "@/lib/cash-book/auto-session";
import { isValidCronSecret } from "@/lib/cron-auth";
import { captureCriticalError } from "@/lib/monitoring";
import { recordExternalJobRun } from "@/lib/background-jobs";

/**
 * Livre de caisse auto-close cron endpoint.
 *
 * Safe to call on every tick: autoCloseCashSession refuses to close a session
 * opened on the current Brussels day, so it is a no-op until the day rolls
 * over. That check lives in the job itself precisely so no caller — this
 * endpoint or the in-process interval — has to coordinate a cadence.
 *
 * It used to call autoOpenCashSession first, and the two together were the
 * bug: open created a session, close shut it in the same request, and an
 * every-5-minute schedule turned that into 52 empty sessions in one day. The
 * till is not opened on a timer at all any more — the first cash-taking
 * action opens it via ensureCashSessionOpen.
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
  let autoClose = null;

  try {
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
    { success: failedJobs.length === 0, autoClose, failedJobs },
    { status: failedJobs.length > 0 ? 207 : 200 }
  );
}
