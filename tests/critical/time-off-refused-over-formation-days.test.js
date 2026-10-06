import { describe, expect, test } from "vitest";
import { validateTimeOffSlot } from "@/lib/time-off-validation";

// 2026-10-05, decided with the salon: a booking has priority over the staff
// member. An indisponibilité over a rendez-vous was already refused; it is
// refused the same way over a formation she animates — including a client's
// own « date libre » journées once paid, and a formation with no animator,
// which runs on its creator's calendar.

/** Brussels winter wall clock → instant. */
const at = (dateKey, time) => new Date(`${dateKey}T${time}:00+01:00`);

function fakeDb({ animators = [], sessions = [] } = {}) {
  const calls = [];
  return {
    calls,
    staff: { findUnique: async () => ({ workingHours: [], userId: "user-marie", user: { email: "marie@x.test" } }) },
    appointment: { findMany: async () => [] },
    animator: { findMany: async () => animators },
    formationSession: {
      findMany: async (query) => {
        calls.push(query);
        return sessions;
      },
    },
    timeOff: { findFirst: async () => null },
  };
}

// A client's three journées, 23 → 25 November, 10:00–16:00 each day.
const threeJournees = {
  id: "s1",
  startDate: at("2026-11-23", "10:00"),
  endDate: at("2026-11-25", "16:00"),
  customerRequested: true,
};

const slot = (startKey, startTime, endKey, endTime, isFullDay = true) => ({
  staffId: "staff-marie",
  newStart: at(startKey, startTime),
  newEnd: at(endKey, endTime),
  isFullDay,
});

describe("an indisponibilité over formation days", () => {
  test("is refused on any of the client's paid journées", async () => {
    const result = await validateTimeOffSlot(fakeDb({ sessions: [threeJournees] }), slot("2026-11-24", "00:00", "2026-11-24", "23:59"));
    expect(result).toMatchObject({ ok: false, code: "FORMATION_CONFLICT" });
  });

  test("is allowed in the evening between two journées", async () => {
    const result = await validateTimeOffSlot(fakeDb({ sessions: [threeJournees] }), slot("2026-11-23", "18:00", "2026-11-23", "22:00"));
    expect(result).toEqual({ ok: true });
  });

  test("covers a formation with no animator, on its creator's calendar", async () => {
    const db = fakeDb({ animators: [] });
    await validateTimeOffSlot(db, slot("2026-11-24", "00:00", "2026-11-24", "23:59"));
    expect(db.calls).toHaveLength(1);
    expect(JSON.stringify(db.calls[0].where)).toContain('"createdById":"user-marie"');
  });

  test("still covers the sessions she animates", async () => {
    const db = fakeDb({ animators: [{ id: "animator-marie" }] });
    await validateTimeOffSlot(db, slot("2026-11-24", "00:00", "2026-11-24", "23:59"));
    expect(JSON.stringify(db.calls[0].where)).toContain('"animatorId":{"in":["animator-marie"]}');
  });
});
