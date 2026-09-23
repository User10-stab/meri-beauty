import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    formation: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { openSessionDatesWhere, sessionDatesRefusal } from "@/lib/formations/session-bookability";
import { getPublicFormations, getPublicFormationById } from "@/actions/formations/get-public-formations";

const NOW = new Date("2026-09-25T10:00:00Z");
const YESTERDAY = new Date("2026-09-24T11:00:00Z");
const TOMORROW = new Date("2026-09-26T11:00:00Z");

function session(id, { capacity = 1, paidSeats = 0, startDate = TOMORROW, registrationDeadline = null } = {}) {
  return {
    id,
    capacity,
    startDate,
    registrationDeadline,
    reservations: paidSeats > 0 ? [{ seatsCount: paidSeats }] : [],
  };
}

function formation(id, type, sessions) {
  return { id, type, price: "100.00", sessions };
}

describe("formation session bookability (dates)", () => {
  it("refuses a session that already ran or has started", () => {
    expect(sessionDatesRefusal({ startDate: YESTERDAY }, NOW)).toMatch(/déjà eu lieu/);
    expect(sessionDatesRefusal({ startDate: NOW }, NOW)).toMatch(/déjà eu lieu/);
  });

  it("refuses a session past its registration deadline", () => {
    const deadline = new Date("2026-09-25T09:00:00Z");
    expect(sessionDatesRefusal({ startDate: TOMORROW, registrationDeadline: deadline }, NOW)).toMatch(/clôturées/);
  });

  it("accepts a future session with no deadline or a future one", () => {
    expect(sessionDatesRefusal({ startDate: TOMORROW, registrationDeadline: null }, NOW)).toBeNull();
    expect(sessionDatesRefusal({ startDate: TOMORROW, registrationDeadline: TOMORROW }, NOW)).toBeNull();
  });

  it("builds the same rule as a Prisma filter", () => {
    expect(openSessionDatesWhere(NOW)).toEqual({
      status: "SCHEDULED",
      startDate: { gt: NOW },
      OR: [{ registrationDeadline: null }, { registrationDeadline: { gt: NOW } }],
    });
  });
});

describe("public formation catalogue", () => {
  beforeEach(() => {
    mocks.prisma.formation.findMany.mockReset();
    mocks.prisma.formation.findFirst.mockReset();
  });

  it("asks the database for open-dated sessions only", async () => {
    mocks.prisma.formation.findMany.mockResolvedValue([]);
    await getPublicFormations();
    const where = mocks.prisma.formation.findMany.mock.calls[0][0].include.sessions.where;
    expect(where.status).toBe("SCHEDULED");
    expect(where.startDate.gt).toBeInstanceOf(Date);
    expect(where.OR).toEqual([{ registrationDeadline: null }, { registrationDeadline: { gt: expect.any(Date) } }]);
  });

  it("lists only formations with a bookable session, showing the next free one first", async () => {
    mocks.prisma.formation.findMany.mockResolvedValue([
      // Private, its one date paid for (acompte or full) → gone.
      formation("private-booked", "PRIVATE", [session("p1", { paidSeats: 1 })]),
      // Private, first date booked, second free → stays, card shows the free one.
      formation("private-next", "PRIVATE", [
        session("p2", { paidSeats: 1 }),
        session("p3", { startDate: new Date("2026-10-08T11:00:00Z") }),
      ]),
      // Group, every seat paid → gone.
      formation("group-full", "PUBLIC", [session("g1", { capacity: 4, paidSeats: 4 })]),
      // Group with seats left → stays.
      formation("group-open", "PUBLIC", [session("g2", { capacity: 4, paidSeats: 1 })]),
      // No open date at all (past dates are already filtered by the query) → gone.
      formation("no-dates", "PUBLIC", []),
    ]);

    const result = await getPublicFormations();

    expect(result.success).toBe(true);
    expect(result.data.map((f) => f.id)).toEqual(["private-next", "group-open"]);
    expect(result.data[0].sessions.map((s) => s.id)).toEqual(["p3"]);
  });

  it("keeps full sessions on the detail query (Complet badge + waiting list)", async () => {
    mocks.prisma.formation.findFirst.mockResolvedValue(
      formation("group-full", "PUBLIC", [session("g1", { capacity: 4, paidSeats: 4 })])
    );

    const result = await getPublicFormationById("group-full");

    expect(result.data.sessions.map((s) => s.id)).toEqual(["g1"]);
    const where = mocks.prisma.formation.findFirst.mock.calls[0][0].include.sessions.where;
    expect(where.startDate.gt).toBeInstanceOf(Date);
  });
});
