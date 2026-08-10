import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (path) => readFileSync(`${root}${path}`, "utf8");

describe("business timezone is pinned, not host-dependent", () => {
  test("instrumentation.js pins the process to Europe/Brussels before anything else runs", () => {
    const instrumentation = source("instrumentation.js");
    expect(instrumentation).toMatch(/process\.env\.TZ\s*=\s*process\.env\.TZ\s*\|\|\s*["']Europe\/Brussels["']/);
  });
});

// buildAppointmentWindow (lib/appointment-scheduling.js) turns a staff
// working-hours "HH:mm" string into a Date via JS's *local* setHours — that
// string means Brussels wall-clock time (it's what staff type into the
// working-hours form), so the conversion to a stored UTC instant is only
// correct if the process's timezone actually is Europe/Brussels. This suite
// pins it exactly the way instrumentation.js does in production, then proves
// the same wall-clock time produces a *different* UTC instant in winter
// (CET, UTC+1) vs summer (CEST, UTC+2) — the one thing that silently breaks
// if a VPS/container defaults to UTC or any fixed-offset zone instead.
describe("appointment windows convert Brussels wall-clock time to the correct UTC instant across DST", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Brussels";
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  test("a winter booking (CET, UTC+1) lands at the expected UTC hour", async () => {
    const { buildAppointmentWindow } = await import("@/lib/appointment-scheduling.js");
    const { startTime, endTime } = buildAppointmentWindow("2026-01-15", "10:00", 60);

    expect(startTime.getUTCHours()).toBe(9);
    expect(startTime.getUTCMinutes()).toBe(0);
    expect(endTime.getUTCHours()).toBe(10);
  });

  test("a summer booking (CEST, UTC+2) lands one hour earlier in UTC than the same wall-clock time in winter", async () => {
    const { buildAppointmentWindow } = await import("@/lib/appointment-scheduling.js");
    const { startTime } = buildAppointmentWindow("2026-07-15", "10:00", 60);

    // Same "10:00" the client picked, same duration — but summer Brussels
    // (CEST) is UTC+2, one hour further ahead of UTC than winter (CET,
    // UTC+1), so the correct stored instant must be one hour earlier in UTC.
    expect(startTime.getUTCHours()).toBe(8);
    expect(startTime.getUTCMinutes()).toBe(0);
  });

  test("the DST transition weekend itself does not silently shift the booked wall-clock hour", async () => {
    const { buildAppointmentWindow } = await import("@/lib/appointment-scheduling.js");

    // 2026-03-29 is the EU spring-forward date (02:00 CET -> 03:00 CEST).
    // A 10:00 booking the same day must still read as 10:00 local, i.e. the
    // UTC offset must already reflect CEST (UTC+2), not the pre-transition
    // CET (UTC+1) — proving DST is evaluated per-date, not cached from an
    // earlier lookup.
    const dayOf = buildAppointmentWindow("2026-03-29", "10:00", 60);
    expect(dayOf.startTime.getUTCHours()).toBe(8);

    const dayBefore = buildAppointmentWindow("2026-03-28", "10:00", 60);
    expect(dayBefore.startTime.getUTCHours()).toBe(9);
  });
});
