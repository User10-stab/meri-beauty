import { describe, expect, test } from "vitest";
import {
  scheduledSessions,
  sessionAnimatorUnavailability,
  walkInUnavailabilityReason,
} from "@/lib/staff-day-unavailability";
import { parseBrusselsInputValue } from "@/lib/datetime/brussels-input";

// 2026-10-22: creating a formation/atelier session never asked whether its
// animatrice was free — a day that was not hers (Julie works the 1st and 3rd
// Saturdays, Lyly the 2nd and 4th), or a congé, could still hold a session
// that clients then booked seats on. The till's walk-in had the same blind
// spot. The queries are exercised by
// tests/e2e-dashboard/working-day-override-booking.spec.mjs; these pin the rules.

const at = (dateKey, time) => parseBrusselsInputValue(`${dateKey}T${time}`);

// Julie: Saturdays, 1st and 3rd of the month only. November 2026:
// 7 (1st), 14 (2nd), 21 (3rd), 28 (4th). No Monday at all.
const JULIE_HOURS = [{ day: "SATURDAY", startTime: "09:00", endTime: "18:00", isClosed: false, weeksOfMonth: [1, 3] }];

/** A Prisma stand-in: one animator linked to Julie, her rule, overrides and leaves. */
function fakeDb({ workingHours = JULIE_HOURS, overrides = [], timeOffs = [] } = {}) {
  const julie = { id: "staff-julie", user: { fullName: "Julie Schoemans" } };
  return {
    animator: { findUnique: async () => ({ staffId: julie.id, email: null }) },
    staff: {
      findUnique: async () => ({ ...julie, workingHours, workingDayOverrides: overrides }),
      findFirst: async () => julie,
    },
    timeOff: {
      findFirst: async ({ where }) =>
        timeOffs.find(
          (t) =>
            t.startDate < where.startDate.lt &&
            t.endDate > where.endDate.gt &&
            (where.isFullDay === undefined || t.isFullDay === where.isFullDay)
        ) ?? null,
    },
  };
}

const session = (dateKey, time = "10:00") => ({ animatorId: "animator-julie", startDate: at(dateKey, time), endDate: null });

describe("a formation/atelier session needs its animatrice free", () => {
  test("a Saturday that is not one of her weeks is refused", async () => {
    const message = await sessionAnimatorUnavailability(fakeDb(), [session("2026-11-14")], { durationMinutes: 120 });
    expect(message).toContain("Julie Schoemans ne travaille pas le 14/11");
  });

  test("one of her Saturdays is accepted", async () => {
    expect(await sessionAnimatorUnavailability(fakeDb(), [session("2026-11-21")], { durationMinutes: 120 })).toBeNull();
  });

  test("a weekday she never works is not a refusal — formations run outside her rendez-vous days", async () => {
    expect(await sessionAnimatorUnavailability(fakeDb(), [session("2026-11-16")], { durationMinutes: 120 })).toBeNull();
  });

  test("a 5th Saturday is refused unless it was given to her", async () => {
    // 2026-08-29 is August's 5th Saturday.
    expect(await sessionAnimatorUnavailability(fakeDb(), [session("2026-08-29")], { durationMinutes: 120 })).toContain(
      "ne travaille pas le 29/08"
    );
    const given = fakeDb({ overrides: [{ dateKey: "2026-08-29", isWorking: true, startTime: "09:00", endTime: "18:00" }] });
    expect(await sessionAnimatorUnavailability(given, [session("2026-08-29")], { durationMinutes: 120 })).toBeNull();
  });

  test("a congé overlapping the session is refused", async () => {
    const db = fakeDb({ timeOffs: [{ startDate: at("2026-11-21", "00:00"), endDate: at("2026-11-21", "23:59"), isFullDay: true }] });
    const message = await sessionAnimatorUnavailability(db, [session("2026-11-21")], { durationMinutes: 120 });
    expect(message).toContain("Julie Schoemans est indisponible le 21/11");
  });

  test("a congé outside the session's hours does not block it", async () => {
    const db = fakeDb({ timeOffs: [{ startDate: at("2026-11-21", "15:00"), endDate: at("2026-11-21", "17:00"), isFullDay: false }] });
    expect(await sessionAnimatorUnavailability(db, [session("2026-11-21")], { durationMinutes: 120 })).toBeNull();
  });

  test("a session without an animatrice is never refused", async () => {
    expect(
      await sessionAnimatorUnavailability(fakeDb(), [{ ...session("2026-11-14"), animatorId: null }], { durationMinutes: 120 })
    ).toBeNull();
  });

  test("an edit only re-checks the sessions it moves", () => {
    const existing = new Map([["s1", { startDate: at("2026-11-14", "10:00"), endDate: null, animatorId: "animator-julie" }]]);
    const form = [
      { id: "s1", startDate: "2026-11-14T10:00", endDate: "", animatorId: "animator-julie" },
      { id: "s2", startDate: "2026-11-21T10:00", endDate: "", animatorId: "animator-julie" },
    ];
    const checked = scheduledSessions(form, { defaultAnimatorId: null, existingById: existing });
    expect(checked.map((s) => s.id)).toEqual(["s2"]);
  });
});

describe("a walk-in at the till", () => {
  test("is refused on a Saturday that is not hers", async () => {
    expect(
      await walkInUnavailabilityReason(fakeDb(), { staffId: "staff-julie", staffName: "Julie Schoemans", now: at("2026-11-14", "11:00") })
    ).toContain("ne travaille pas aujourd'hui");
  });

  test("is accepted on one of her Saturdays", async () => {
    expect(await walkInUnavailabilityReason(fakeDb(), { staffId: "staff-julie", now: at("2026-11-21", "11:00") })).toBeNull();
  });

  test("is refused on a full-day congé, not on a partial one", async () => {
    const now = at("2026-11-21", "11:00");
    const fullDay = fakeDb({ timeOffs: [{ startDate: at("2026-11-21", "00:00"), endDate: at("2026-11-21", "23:59"), isFullDay: true }] });
    expect(await walkInUnavailabilityReason(fullDay, { staffId: "staff-julie", now })).toContain("indisponible aujourd'hui");

    const partial = fakeDb({ timeOffs: [{ startDate: at("2026-11-21", "14:00"), endDate: at("2026-11-21", "16:00"), isFullDay: false }] });
    expect(await walkInUnavailabilityReason(partial, { staffId: "staff-julie", now })).toBeNull();
  });
});
