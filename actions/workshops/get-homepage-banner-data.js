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
 * Data for the homepage promo banner: prioritizes an upcoming session with
 * 1-2 seats left (urgency), falling back to the most recently published
 * activity if nothing is running low.
 */
export async function getHomepageBannerData() {
  try {
    const sessions = await prisma.workshopSession.findMany({
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
    });

    for (const s of sessions) {
      const taken = s.reservations.reduce((sum, r) => sum + r.seatsCount, 0);
      const capacity = s.capacity ?? s.workshop.capacity;
      const available = capacity - taken;
      if (available > 0 && available < 3) {
        return {
          success: true,
          data: serializeDecimalFields({ mode: "low_seats", activity: s.workshop, session: s, available }),
        };
      }
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
      data: serializeDecimalFields({ mode: "new_activity", activity: latest, session: latest.sessions[0] ?? null }),
    };
  } catch (error) {
    console.error("[getHomepageBannerData]", error);
    return { success: true, data: null };
  }
}
