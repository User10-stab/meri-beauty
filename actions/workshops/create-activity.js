"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

const sessionSchema = z.object({
  id: z.string().optional(),
  startDate: z.string().min(1, "La date de début est obligatoire."),
  endDate: z.string().optional().nullable(),
  capacity: z.coerce
    .number()
    .int()
    .positive("La capacité doit être d'au moins 1.")
    .max(8, "La capacité maximale est de 8 personnes."),
  animatorId: z.string().optional().nullable(),
  registrationDeadline: z.string().optional().nullable(),
});

const activitySchema = z.object({
  type: z.enum(["WORKSHOP", "EVENT"], { error: "Le type d'activité est obligatoire." }),
  title: z.string().trim().min(2, "Le titre doit contenir au moins 2 caractères.").max(100, "Le titre ne peut pas dépasser 100 caractères."),
  description: z.string().trim().optional().nullable(),
  cover: z.string().optional().nullable(),
  price: z.coerce.number({ error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif."),
  duration: z.coerce.number({ error: "La durée est invalide." }).int().positive("La durée doit être supérieure à 0 minutes."),
  language: z.string().trim().optional().nullable(),
  capacity: z.coerce
    .number({ error: "La capacité est invalide." })
    .int()
    .positive("La capacité doit être d'au moins 1 personne.")
    .max(8, "La capacité maximale est de 8 personnes."),
  animatorId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"]).optional().default("DRAFT"),
  allowMultipleSessions: z.boolean().optional().default(false),
  depositPercentage: z.coerce.number().int().min(0).max(100).optional().default(50),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  sessions: z.array(sessionSchema).optional().default([]),
});

const updateActivitySchema = activitySchema.extend({
  id: z.string().min(1, "L'identifiant de l'activité est obligatoire."),
});

/**
 * Gate for activity mutations: admin/owner may act on any activity. Per the
 * client's decision, staff can no longer create ateliers/événements at all
 * (unlike formations, which stay open to them) — they may still edit/delete
 * one they created earlier (when requireOwnerForEdit is set).
 */
async function requireActivityAccess(activityId, { requireOwnerForEdit = false } = {}) {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.WORKSHOPS))) {
    return { error: "Non autorisé." };
  }
  if (isAdminRole(session.user.role)) return { session };
  if (!activityId) return { error: "Seul un administrateur peut créer un atelier ou un évènement." };
  if (!requireOwnerForEdit) return { session };

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { createdById: true },
  });
  if (!activity) return { error: "Activité introuvable." };
  if (activity.createdById !== session.user.id) {
    return { error: "Vous ne pouvez modifier que les activités que vous avez créées." };
  }
  return { session };
}

/**
 * Crée une nouvelle activité.
 */
export async function createActivity(input) {
  try {
    const { session, error } = await requireActivityAccess();
    if (error) {
      return { success: false, message: error };
    }

    const parsed = activitySchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { animatorId, sessions, startDate, endDate, ...rest } = parsed.data;

    if (animatorId) {
      const animatorExists = await prisma.animator.findUnique({ where: { id: animatorId } });
      if (!animatorExists) {
        return { success: false, message: "L'animateur sélectionné est introuvable." };
      }
    }

    if (sessions.length > 0) {
      for (const s of sessions) {
        if (s.animatorId) {
          const animExists = await prisma.animator.findUnique({ where: { id: s.animatorId } });
          if (!animExists) {
            return { success: false, message: `L'animateur de la session est introuvable.` };
          }
        }
      }
    }

    const activity = await prisma.activity.create({
      data: {
        ...rest,
        animatorId: animatorId || null,
        createdById: session.user.id,
        sessions:
          sessions.length > 0
            ? {
                create: sessions.map((s) => ({
                  startDate: new Date(s.startDate),
                  endDate: s.endDate ? new Date(s.endDate) : null,
                  capacity: s.capacity,
                  animatorId: s.animatorId || null,
                  registrationDeadline: s.registrationDeadline
                    ? new Date(s.registrationDeadline)
                    : null,
                })),
              }
            : undefined,
      },
      include: { sessions: true },
    });

    revalidatePath("/dashboard/workshops/activities");
    return {
      success: true,
      message: "Activité créée avec succès !",
      data: serializeDecimalFields(activity),
    };
  } catch (error) {
    console.error("[createActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la création de l'activité." };
  }
}

/**
 * Modifie une activité existante.
 */
export async function updateActivity(input) {
  try {
    const { error } = await requireActivityAccess(input?.id, { requireOwnerForEdit: true });
    if (error) {
      return { success: false, message: error };
    }

    const parsed = updateActivitySchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors = {};
      parsed.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      return {
        success: false,
        message: "Veuillez corriger les erreurs du formulaire.",
        errors: fieldErrors,
      };
    }

    const { id, animatorId, sessions, startDate, endDate, ...rest } = parsed.data;

    const existingActivity = await prisma.activity.findUnique({
      where: { id },
      include: { sessions: true },
    });
    if (!existingActivity) {
      return { success: false, message: "Activité introuvable." };
    }

    if (animatorId) {
      const animatorExists = await prisma.animator.findUnique({ where: { id: animatorId } });
      if (!animatorExists) {
        return { success: false, message: "L'animateur sélectionné est introuvable." };
      }
    }

    const existingIds = existingActivity.sessions.map((s) => s.id);
    const incomingIds = sessions.filter((s) => s.id).map((s) => s.id);
    const idsToDelete = existingIds.filter((eid) => !incomingIds.includes(eid));

    // workshop_reservations.sessionId is ON DELETE CASCADE, so deleting a
    // session silently destroys every booking on it — no error, no trace, and
    // Payment.workshopReservationId is left dangling (SET NULL), which breaks
    // any later refund. A session that still holds reservations is therefore
    // never dropped as a side effect of an edit: the admin has to cancel or
    // move those bookings first, deliberately.
    if (idsToDelete.length > 0) {
      const bookedSessions = await prisma.workshopSession.findMany({
        where: { id: { in: idsToDelete }, reservations: { some: {} } },
        select: { id: true, startDate: true, _count: { select: { reservations: true } } },
      });

      if (bookedSessions.length > 0) {
        const totalReservations = bookedSessions.reduce((sum, s) => sum + s._count.reservations, 0);
        return {
          success: false,
          message:
            `Impossible de supprimer ${bookedSessions.length > 1 ? "ces séances" : "cette séance"} : ` +
            `${totalReservations} réservation${totalReservations > 1 ? "s" : ""} y ${totalReservations > 1 ? "sont" : "est"} rattachée${totalReservations > 1 ? "s" : ""}. ` +
            `Annulez ou déplacez ces réservations avant de modifier les dates.`,
        };
      }

      await prisma.workshopSession.deleteMany({ where: { id: { in: idsToDelete } } });
    }

    const updated = await prisma.activity.update({
      where: { id },
      data: {
        ...rest,
        animatorId: animatorId || null,
        sessions: {
          create: sessions
            .filter((s) => !s.id)
            .map((s) => ({
              startDate: new Date(s.startDate),
              endDate: s.endDate ? new Date(s.endDate) : null,
              capacity: s.capacity,
              animatorId: s.animatorId || null,
              registrationDeadline: s.registrationDeadline
                ? new Date(s.registrationDeadline)
                : null,
            })),
        },
      },
      include: { sessions: true },
    });

    for (const s of sessions) {
      if (s.id && incomingIds.includes(s.id)) {
        await prisma.workshopSession.update({
          where: { id: s.id },
          data: {
            startDate: new Date(s.startDate),
            endDate: s.endDate ? new Date(s.endDate) : null,
            capacity: s.capacity,
            animatorId: s.animatorId || null,
            registrationDeadline: s.registrationDeadline
              ? new Date(s.registrationDeadline)
              : null,
          },
        });
      }
    }

    revalidatePath("/dashboard/workshops/activities");
    return {
      success: true,
      message: "Activité mise à jour avec succès !",
      data: serializeDecimalFields(updated),
    };
  } catch (error) {
    console.error("[updateActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la mise à jour de l'activité." };
  }
}

/**
 * Supprime une activité.
 */
export async function deleteActivity(id) {
  try {
    const { error } = await requireActivityAccess(id, { requireOwnerForEdit: true });
    if (error) {
      return { success: false, message: error };
    }

    if (!id) {
      return { success: false, message: "Identifiant manquant." };
    }

    const existingActivity = await prisma.activity.findUnique({ where: { id } });
    if (!existingActivity) {
      return { success: false, message: "Activité introuvable." };
    }

    // Deleting an Activity cascades onto its sessions and, from there, onto
    // every reservation booked on them — taking real customer bookings and
    // their payment links with it. Booking history is financial history, so
    // it is never destroyed as a side effect: an activity that is over gets
    // archived (Activity.status ARCHIVED) rather than deleted.
    const reservationCount = await prisma.workshopReservation.count({
      where: { session: { workshopId: id } },
    });
    if (reservationCount > 0) {
      return {
        success: false,
        message:
          `Impossible de supprimer « ${existingActivity.title} » : ` +
          `${reservationCount} réservation${reservationCount > 1 ? "s y sont rattachées" : " y est rattachée"}. ` +
          `Passez son statut à « Archivé » pour la retirer de l'affichage sans perdre l'historique.`,
      };
    }

    await prisma.activity.delete({ where: { id } });

    revalidatePath("/dashboard/workshops/activities");
    return { success: true, message: "Activité supprimée avec succès !" };
  } catch (error) {
    console.error("[deleteActivity]", error);
    return { success: false, message: "Une erreur est survenue lors de la suppression de l'activité." };
  }
}
