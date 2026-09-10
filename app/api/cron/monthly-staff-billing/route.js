import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendDailyStaffInvoices } from "@/lib/staff-monthly-billing";
import { isValidCronSecret } from "@/lib/cron-auth";
import { captureCriticalError } from "@/lib/monitoring";
import { recordExternalJobRun } from "@/lib/background-jobs";

/**
 * Anniversary-based daily staff billing cron endpoint.
 *
 * Generates and emails invoices for active staff whose nextInvoiceDate <= today.
 * Each staff member is billed on their individual contract anniversary date,
 * not on a calendar-month boundary.
 *
 * Secured identically to the other cron routes:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Intended schedule: once per day (e.g. "0 6 * * *" in cron-job.org or GitHub Actions).
 * Safe to call multiple times per day — the StaffMonthlyInvoice unique constraint
 * on (staffId, billingYear, billingMonth) guarantees at-most-once per billing period.
 */
export async function GET(req) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!isValidCronSecret(authHeader, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Advisory lock — prevents concurrent HTTP triggers (double-fire from an
  // external scheduler or a manual retry hitting while the first run is still
  // processing). The lock is acquired in a short-lived transaction and
  // immediately released so it does NOT hold a connection open while the
  // billing engine runs (which opens its own connections per-staff internally).
  const lockResult = await prisma.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext('meri-beauty-cron-monthly-billing')) AS locked
  `;
  const locked = lockResult[0]?.locked;

  if (!locked) {
    return NextResponse.json(
      { success: true, skipped: "A previous monthly billing run is still in progress." },
      { status: 200 }
    );
  }

  const startedAt = Date.now();
  let summary;
  let failed = false;

  try {
    summary = await sendDailyStaffInvoices();
  } catch (err) {
    failed = true;
    captureCriticalError(err, { area: "monthly-billing", trigger: "http-cron" });
    return NextResponse.json(
      { success: false, error: err?.message ?? "Monthly billing job failed" },
      { status: 500 }
    );
  } finally {
    // Always release the session-level advisory lock when done, whether the
    // job succeeded or threw, so a crash doesn't leave the lock stranded.
    await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('meri-beauty-cron-monthly-billing'))`.catch(() => {});
  }

  recordExternalJobRun({
    startedAt,
    failedJobs: failed ? ["sendDailyStaffInvoices"] : [],
  });

  return NextResponse.json(
    {
      success: summary.errors === 0,
      billingDate: summary.billingDate,
      processed: summary.processed,
      sent: summary.sent,
      skipped: summary.skipped,
      emailFailed: summary.emailFailed,
      errors: summary.errors,
      initialized: summary.initialized,
    },
    { status: summary.errors > 0 ? 207 : 200 }
  );
}
