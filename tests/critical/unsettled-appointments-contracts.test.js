import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// No job ever existed to surface or bound a CONFIRMED appointment whose time
// has passed: it stayed cancellable-with-a-full-automatic-refund forever,
// and nothing ever told staff a balance was never collected.
describe("stale CONFIRMED appointments are surfaced, never auto-completed, and eventually un-cancellable-with-refund", () => {
  const job = source("lib/appointments/notify-unsettled-appointments.js");
  const manageAppointment = source("actions/appointment/manage-appointment.js");

  test("the digest job lists stale appointments and dedupes to roughly once a day", () => {
    expect(job).toContain('status: "CONFIRMED"');
    expect(job).toContain("endTime: { lt: staleCutoff }");
    // Never writes a COMPLETED/CANCELLED status — only reads and e-mails.
    expect(job).not.toContain("appointment.update");
    expect(job).toContain("unsettledAppointmentsDigestSentAt");
    // Atomic claim against the Salon marker, gated so a second concurrent
    // runner (in-process interval racing an HTTP-triggered cron) sees
    // claim.count === 0 instead of both sending the same digest.
    expect(job).toContain("salon.updateMany");
    expect(job).toContain("if (claim.count === 0)");
  });

  test("is wired into both the HTTP cron route and the in-process job runner", () => {
    const httpRoute = source("app/api/cron/appointments/route.js");
    expect(httpRoute).toContain("notifyUnsettledAppointments");

    const backgroundJobs = source("lib/background-jobs.js");
    expect(backgroundJobs).toContain("notifyUnsettledAppointments");
  });

  test("rejectAppointment refuses a cancel-with-refund once the appointment is more than 7 days past", () => {
    expect(manageAppointment).toContain("STALE_CANCELLATION_GUARD_DAYS = 7");
    expect(manageAppointment).toContain("Date.now() - appointment.endTime.getTime()");
    expect(manageAppointment).toContain("Marquer absente");
  });
});
