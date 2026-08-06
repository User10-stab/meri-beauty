"use server";

import { prisma } from "@/lib/prisma";
import { serializeDecimalFields } from "@/lib/serialize-prisma";
import { notifyAllInWaitingList } from "@/actions/workshops/waiting-list";

export async function getPublicActivities() {
  try {
    const activities = await prisma.activity.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      include: {
        animator: true,
        sessions: {
          orderBy: { startDate: "asc" },
          where: { status: "SCHEDULED" },
          include: {
            reservations: {
              where: {
                OR: [
                  { status: { in: ["CONFIRMED", "COMPLETED"] } },
                  {
                    status: "PENDING_DEPOSIT",
                    OR: [
                      { holdExpiresAt: null },
                      { holdExpiresAt: { gt: new Date() } }
                    ]
                  }
                ]
              },
              select: {
                seatsCount: true
              }
            }
          }
        },
      },
    });

    const serializedData = activities.map((activity) => serializeDecimalFields(activity));
    return { success: true, data: serializedData };
  } catch (error) {
    console.error("[getPublicActivities]", error);
    return { success: false, data: [], message: "Impossible de charger les activités." };
  }
}

export async function getPublicActivityById(id) {
  try {
    const activity = await prisma.activity.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        animator: true,
        sessions: {
          orderBy: { startDate: "asc" },
          where: { status: "SCHEDULED" },
          include: {
            reservations: {
              where: {
                OR: [
                  { status: { in: ["CONFIRMED", "COMPLETED"] } },
                  {
                    status: "PENDING_DEPOSIT",
                    OR: [
                      { holdExpiresAt: null },
                      { holdExpiresAt: { gt: new Date() } }
                    ]
                  }
                ]
              },
              select: {
                seatsCount: true
              }
            }
          }
        },
      },
    });

    if (!activity) {
      return { success: false, data: null, message: "Activité introuvable." };
    }

    if (activity.sessions) {
      for (const session of activity.sessions) {
        const taken = session.reservations?.reduce((sum, r) => sum + r.seatsCount, 0) ?? 0;
        const cap = session.capacity ?? activity.capacity;
        if (cap - taken > 0) {
          notifyAllInWaitingList(session.id).catch(() => {});
        }
      }
    }

    return { success: true, data: serializeDecimalFields(activity) };
  } catch (error) {
    console.error("[getPublicActivityById]", error);
    return { success: false, data: null, message: "Impossible de charger l'activité." };
  }
}
