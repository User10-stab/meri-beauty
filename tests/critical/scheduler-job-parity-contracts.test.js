import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n");

/**
 * Reads the `const JOBS = [...]` list out of a scheduler module by name.
 * Deliberately source-level: importing these pulls in Prisma, Stripe and the
 * mail client, and the thing being checked is the list itself, not behaviour.
 */
function jobNames(path) {
  const code = source(path);
  const block = code.slice(code.indexOf("const JOBS = ["), code.indexOf("];", code.indexOf("const JOBS = [")));
  return [...block.matchAll(/\["([A-Za-z]+)",/g)].map((match) => match[1]).sort();
}

/**
 * There are two ways these jobs run: the in-process interval scheduler
 * (lib/background-jobs.js) and two secured HTTP endpoints an external
 * scheduler calls. Production is documented as relying on the external one.
 *
 * They drifted once already, and silently: expireStalePendingAppointments was
 * in the in-process list and in neither route, so on an externally-scheduled
 * deploy stale pending appointment requests never expired and kept slots
 * blocked. Nothing failed, nothing logged — the job simply did not exist.
 *
 * This test is the thing that would have caught it. Adding a job to the
 * in-process list now forces a decision about which endpoint runs it.
 */
describe("every scheduled job is reachable from an external scheduler", () => {
  const inProcess = jobNames("lib/background-jobs.js");
  const generalRoute = jobNames("app/api/cron/route.js");
  const appointmentRoute = jobNames("app/api/cron/appointments/route.js");

  test("the lists were actually parsed, so a rename cannot make this test vacuous", () => {
    expect(inProcess.length).toBeGreaterThan(5);
    expect(generalRoute.length).toBeGreaterThan(0);
    expect(appointmentRoute.length).toBeGreaterThan(0);
  });

  test("the two cron routes together run exactly the in-process job list", () => {
    const external = [...new Set([...generalRoute, ...appointmentRoute])].sort();
    expect(external).toEqual(inProcess);
  });

  test("no job is registered on both routes, which would run it twice per tick", () => {
    const onBoth = generalRoute.filter((job) => appointmentRoute.includes(job));
    expect(onBoth).toEqual([]);
  });

  test("both endpoints are secured by the same shared secret", () => {
    for (const route of ["app/api/cron/route.js", "app/api/cron/appointments/route.js"]) {
      const code = source(route);
      expect(code, route).toContain("isValidCronSecret(authHeader, secret)");
      expect(code, route).toContain("process.env.CRON_SECRET");
    }
  });
});
