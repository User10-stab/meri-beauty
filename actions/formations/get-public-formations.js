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
              where: HELD_OR_CONFIRMED_RESERVATION,
              select: { seatsCount: true },
            },
          },
        },
      },
    });

    const serializedData = formations.map((formation) => serializeDecimalFields(formation));
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
              where: HELD_OR_CONFIRMED_RESERVATION,
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
