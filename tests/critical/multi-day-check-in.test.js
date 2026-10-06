import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formationDayAdmission } from "@/lib/activities/multi-day-check-in";

// 2026-10-05: a formation over several days is attended on each of them with
// one ticket — it is admitted once per day, not once for the whole formation.

/** Brussels winter wall clock → instant. */
const at = (dateKey, time) => new Date(`${dateKey}T${time}:00+01:00`);

// Three journées, 23 → 25 November, 09:00–15:00.
const session = { startDate: at("2026-11-23", "09:00"), endDate: at("2026-11-25", "15:00") };
const admitted = { seatsCount: 1, checkedInSeats: 1 };

describe("checking in a formation over several days", () => {
  test("the first arrival is an ordinary check-in, on day 1 of 3", () => {
    expect(formationDayAdmission({ session, seatsCount: 1, checkedInSeats: 0, checkedInAt: null, now: at("2026-11-23", "08:55") }))
      .toEqual({ multiDay: true, dayCount: 3, dayNumber: 1, checkedInToday: false, newDay: false });
  });

  test("checked in yesterday → admitted again today", () => {
    const result = formationDayAdmission({ session, ...admitted, checkedInAt: at("2026-11-23", "08:55"), now: at("2026-11-24", "09:02") });
    expect(result).toMatchObject({ dayNumber: 2, newDay: true });
  });

  test("checked in today already → not twice the same day", () => {
    const result = formationDayAdmission({ session, ...admitted, checkedInAt: at("2026-11-24", "09:02"), now: at("2026-11-24", "13:00") });
    expect(result).toMatchObject({ dayNumber: 2, checkedInToday: true, newDay: false });
  });

  test("after the last day the ticket is spent", () => {
    const result = formationDayAdmission({ session, ...admitted, checkedInAt: at("2026-11-25", "09:00"), now: at("2026-11-26", "09:00") });
    expect(result).toMatchObject({ dayNumber: null, newDay: false });
  });

  test("a one-day formation is unchanged: one check-in", () => {
    const oneDay = { startDate: at("2026-11-23", "09:00"), endDate: at("2026-11-23", "15:00") };
    const result = formationDayAdmission({ session: oneDay, ...admitted, checkedInAt: at("2026-11-23", "09:00"), now: at("2026-11-24", "09:00") });
    expect(result).toMatchObject({ multiDay: false, newDay: false });
  });
});

describe("the counter uses it", () => {
  const code = readFileSync(fileURLToPath(new URL("../../actions/activities/check-in.js", import.meta.url)), "utf8");

  test("a later day records today's arrival without adding seats", () => {
    expect(code).toContain("formationDayAdmission({");
    expect(code).toMatch(/before\.newDay\s+\/\/[^\n]*\n[^\n]*\n\s+\? \{ checkedInAt: new Date\(\), checkedInById: guard\.session\.user\.id \}/);
  });
});
