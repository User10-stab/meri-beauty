import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

// 1 Sep 2026: reconcileMissedCheckouts was wired into the HTTP /api/cron
// route but not into lib/background-jobs.js — the in-process scheduler that
// actually runs every 5 minutes on the self-hosted VPS (see its own comment:
// "a self-hosted single Node process doesn't need an external scheduler at
// all"). The HTTP route only gets hit by a manual trigger or an external
// service that was never configured, so the real fix sat inert in production
// until this was caught during a deploy audit.
describe("reconcileMissedCheckouts runs on the real production scheduler, not just the HTTP route", () => {
  const jobsSource = source("lib/background-jobs.js");

  test("is imported and registered in the in-process JOBS list", () => {
    expect(jobsSource).toContain('import { reconcileMissedCheckouts } from "@/lib/payments/reconcile-missed-checkouts"');
    expect(jobsSource).toContain('["reconcileMissedCheckouts", reconcileMissedCheckouts]');
  });

  test("its failures are surfaced, not swallowed", () => {
    expect(jobsSource).toContain("missedCheckouts?.failures?.length > 0");
    expect(jobsSource).toContain('console.error("[background-jobs] reconcileMissedCheckouts had failures:"');
  });

  test("also still registered on the HTTP /api/cron route (manual trigger / monitoring)", () => {
    const cronSource = source("app/api/cron/route.js");
    expect(cronSource).toContain('import { reconcileMissedCheckouts } from "@/lib/payments/reconcile-missed-checkouts"');
    expect(cronSource).toContain('["reconcileMissedCheckouts", reconcileMissedCheckouts]');
  });
});
