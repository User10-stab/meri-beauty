"use server";

import { prisma } from "@/lib/prisma";

export async function getPublicAnimators() {
  try {
    const animators = await prisma.animator.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { activities: { where: { status: "PUBLISHED" } } },
        },
      },
    });

    return { success: true, data: animators };
  } catch (error) {
    console.error("[getPublicAnimators]", error);
    return { success: false, data: [], message: "Impossible de charger les animateurs." };
  }
}

export async function getPublicAnimatorById(id) {
  try {
    const animator = await prisma.animator.findUnique({
      where: { id },
      include: {
        activities: {
          where: { status: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          include: {
            sessions: {
              orderBy: { startDate: "asc" },
              where: { status: "SCHEDULED" },
            },
          },
        },
      },
    });

    if (!animator) {
      return { success: false, data: null, message: "Animateur introuvable." };
    }

    return { success: true, data: animator };
  } catch (error) {
    console.error("[getPublicAnimatorById]", error);
    return { success: false, data: null, message: "Impossible de charger l'animateur." };
  }
}
