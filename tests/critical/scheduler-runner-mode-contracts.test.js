import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Two schedulers existed side by side: the in-process 5-minute interval and
 * the two /api/cron endpoints. Whenever an external scheduler was configured
 * both ran, doing every job twice — safe, because every job claims its rows
 * atomically, but nobody could say which mechanism production depended on,
 * and the two docs in this repo asserted different answers.
 */
describe("one scheduler runs, and it is named", () => {
  const jobs = source("lib/background-jobs.js");

  test("JOBS_RUNNER=external stops the in-process interval", () => {
    expect(jobs).toContain('process.env.JOBS_RUNNER === "external" ? "external" : "in-process"');
    expect(jobs).toContain('if (JOBS_RUNNER === "external") {');
  });

  test("the default keeps the interval running, so a typo cannot stop every job", () => {
    // Any value other than the exact string "external" means in-process. A
    // deployment that sets nothing behaves exactly as it did before.
    expect(jobs).toContain('? "external" : "in-process"');
  });

  test("switching runners does not blind /api/health", () => {
    // Both runners feed one heartbeat; without this, external mode would
    // report "scheduler down" forever and the endpoint would be ignored.
    expect(jobs).toContain("export function recordExternalJobRun");
    for (const route of ["app/api/cron/route.js", "app/api/cron/appointments/route.js"]) {
      expect(source(route), route).toContain("recordExternalJobRun({");
    }
  });

  test("staleness is judged against the runner that is actually expected to tick", () => {
    // The external cadence is set outside this codebase, so it cannot be
    // derived from INTERVAL_MS.
    expect(jobs).toContain("EXTERNAL_MAX_SILENCE_MS");
    expect(jobs).toContain('JOBS_RUNNER === "external" ? EXTERNAL_MAX_SILENCE_MS : INTERVAL_MS * 2 + 60_000');
  });

  test("the external silence window has a floor, so it cannot be set to something meaningless", () => {
    expect(jobs).toContain("Number(process.env.JOBS_EXTERNAL_MAX_SILENCE_MINUTES) || 30");
    expect(jobs).toContain("5,\n) * 60 * 1000");
  });

  test("health reports which runner is expected, in both response shapes", () => {
    const health = source("app/api/health/route.js");
    expect(health).toContain("schedulerMode: heartbeat.mode");
    expect(health).toContain("mode: heartbeat.mode");
  });

  test("the boot log says which mechanism is live", () => {
    expect(jobs).toContain("JOBS_RUNNER=external — interval not started");
  });
});
