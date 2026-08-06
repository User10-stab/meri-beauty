"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

const HELD_OR_CONFIRMED_RESERVATION = {
  OR: [
    { status: { in: ["CONFIRMED", "COMPLETED"] } },
    {
      status: "PENDING_DEPOSIT",
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
    },
  ],
};

/**
 * Data for the homepage promo banner: prioritizes whichever upcoming
 * session — atelier or formation — has 1-2 seats left (urgency), falling
 * back to the most recently published activity if nothing is running low.
 *
 * Formations are included here per the client's explicit request for the
 * same low-seats banner ateliers already have — PRIVATE formations are
 * always capacity 1, so they're excluded (a "hurry, almost full" framing
 * doesn't apply to a single-person booking); only PUBLIC formation sessions
 * are considered. The "new activity" fallback stays atelier-only, unchanged
 * — that part of the banner was never asked to cover formations too.
 */
export async function getHomepageBannerData() {
  try {
    const [workshopSessions, formationSessions] = await Promise.all([
      prisma.workshopSession.findMany({
        where: {
          status: "SCHEDULED",
          startDate: { gt: new Date() },
          workshop: { status: "PUBLISHED" },
        },
        orderBy: { startDate: "asc" },
        include: {
          workshop: true,
          reservations: { where: HELD_OR_CONFIRMED_RESERVATION, select: { seatsCount: true } },
        },
      }),
      prisma.formationSession.findMany({
        where: {
          status: "SCHEDULED",
          startDate: { gt: new Date() },
          formation: { status: "PUBLISHED", type: "PUBLIC" },
        },
        orderBy: { startDate: "asc" },
        include: {
          formation: true,
          reservations: { where: HELD_OR_CONFIRMED_RESERVATION, select: { seatsCount: true } },
        },
      }),
    ]);

    const lowSeatsCandidates = [];

    for (const s of workshopSessions) {
      const taken = s.reservations.reduce((sum, r) => sum + r.seatsCount, 0);
      const capacity = s.capacity ?? s.workshop.capacity;
      const available = capacity - taken;
      if (available > 0 && available < 3) {
        lowSeatsCandidates.push({ kind: "workshop", activity: s.workshop, session: s, available });
      }
    }

    for (const s of formationSessions) {
      const taken = s.reservations.reduce((sum, r) => sum + r.seatsCount, 0);
      const capacity = s.capacity ?? s.formation.capacity;
      const available = capacity - taken;
      if (available > 0 && available < 3) {
        lowSeatsCandidates.push({ kind: "formation", activity: s.formation, session: s, available });
      }
    }

    if (lowSeatsCandidates.length > 0) {
      lowSeatsCandidates.sort((a, b) => new Date(a.session.startDate) - new Date(b.session.startDate));
      const best = lowSeatsCandidates[0];
      return { success: true, data: serializeDecimalFields({ mode: "low_seats", ...best }) };
    }

    const latest = await prisma.activity.findFirst({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      include: {
        sessions: { where: { status: "SCHEDULED", startDate: { gt: new Date() } }, orderBy: { startDate: "asc" }, take: 1 },
      },
    });

    if (!latest) {
      return { success: true, data: null };
    }

    return {
      success: true,
      data: serializeDecimalFields({
        mode: "new_activity",
        kind: "workshop",
        activity: latest,
        session: latest.sessions[0] ?? null,
      }),
    };
  } catch (error) {
    console.error("[getHomepageBannerData]", error);
    return { success: true, data: null };
  }
}
