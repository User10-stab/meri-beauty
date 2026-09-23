"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { liveSeatFilter } from "@/lib/reservations/session-occupancy";
import { openSessionDatesWhere } from "@/lib/formations/session-bookability";

/**
 * The catalogue lists only what a visitor can actually book: sessions that
 * are open (future, before their registration deadline — see
 * session-bookability.js) and still have a free paid seat. A formation with
 * no such session leaves the listing, whether its dates are all past, all
 * booked (a private formation is one seat, so one paid booking takes it), or
 * it has none at all — a card nobody can book only makes visitors think it
 * is still on offer. The remaining sessions stay in date order, so the card
 * shows the next bookable date.
 */
function withBookableSessionsOnly(formation) {
  const openSessions = formation.sessions.filter((session) => {
    const taken = session.reservations.reduce((sum, res) => sum + res.seatsCount, 0);
    return taken < session.capacity;
  });
  return openSessions.length > 0 ? { ...formation, sessions: openSessions } : null;
}

export async function getPublicFormations() {
  try {
    const formations = await prisma.formation.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
        sessions: {
          orderBy: { startDate: "asc" },
          where: openSessionDatesWhere(),
          include: {
            reservations: {
              where: liveSeatFilter(),
              select: { seatsCount: true },
            },
          },
        },
      },
    });

    const serializedData = formations
      .map(withBookableSessionsOnly)
      .filter(Boolean)
      .map((formation) => serializeDecimalFields(formation));
    return { success: true, data: serializedData };
  } catch (error) {
    console.error("[getPublicFormations]", error);
    return { success: false, data: [], message: "Impossible de charger les formations." };
  }
}

// Unlike the listing, full sessions are kept here: the detail page shows them
// as "Complet", and /reservation-formation loads its session through this
// call to offer the waiting list (and to honour a waiting-list priority link).
export async function getPublicFormationById(id) {
  try {
    const formation = await prisma.formation.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        animator: true,
        sessions: {
          orderBy: { startDate: "asc" },
          where: openSessionDatesWhere(),
          include: {
            reservations: {
              where: liveSeatFilter(),
              select: { seatsCount: true },
            },
          },
        },
      },
    });

    if (!formation) {
      return { success: false, data: null, message: "Formation introuvable." };
    }

    return { success: true, data: serializeDecimalFields(formation) };
  } catch (error) {
    console.error("[getPublicFormationById]", error);
    return { success: false, data: null, message: "Impossible de charger la formation." };
  }
}
