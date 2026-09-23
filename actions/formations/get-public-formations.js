"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { liveSeatFilter } from "@/lib/reservations/session-occupancy";

/**
 * A private formation is one client, one seat: once that seat is paid for
 * (deposit or full — liveSeatFilter) the session is gone, and a "Complet" card
 * in the catalogue only makes visitors think it is still on offer. Booked
 * sessions are dropped so the card shows the next free date, and a private
 * formation whose every session is booked leaves the listing. One with no
 * scheduled session at all stays as before. The detail page is untouched.
 */
function withoutBookedPrivateSessions(formation) {
  if (formation.type !== "PRIVATE" || formation.sessions.length === 0) return formation;

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
          where: { status: "SCHEDULED" },
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
      .map(withoutBookedPrivateSessions)
      .filter(Boolean)
      .map((formation) => serializeDecimalFields(formation));
    return { success: true, data: serializedData };
  } catch (error) {
    console.error("[getPublicFormations]", error);
    return { success: false, data: [], message: "Impossible de charger les formations." };
  }
}

export async function getPublicFormationById(id) {
  try {
    const formation = await prisma.formation.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        animator: true,
        sessions: {
          orderBy: { startDate: "asc" },
          where: { status: "SCHEDULED" },
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
