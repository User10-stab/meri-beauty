"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isAdminRole, hasPermission, DASHBOARD_PERMISSIONS } from "@/lib/authorization";
import { serializeDecimalFields } from "@/lib/serialize-prisma";

const sessionSchema = z.object({
  id: z.string().optional(),
  startDate: z.string().min(1, "La date de début est obligatoire."),
  endDate: z.string().optional().nullable(),
  capacity: z.coerce.number().int().positive("La capacité doit être d'au moins 1."),
  animatorId: z.string().optional().nullable(),
  registrationDeadline: z.string().optional().nullable(),
});

const formationSchema = z.object({
  type: z.enum(["PRIVATE", "PUBLIC"], { error: "Le type de formation est obligatoire." }),
  title: z.string().trim().min(2, "Le titre doit contenir au moins 2 caractères.").max(100, "Le titre ne peut pas dépasser 100 caractères."),
  description: z.string().trim().max(500, "La description ne peut pas dépasser 500 caractères.").optional().nullable(),
  cover: z.string().optional().nullable(),
  price: z.coerce.number({ error: "Le prix est invalide." }).nonnegative("Le prix ne peut pas être négatif."),
  duration: z.coerce.number({ error: "La durée est invalide." }).int().positive("La durée doit être supérieure à 0 minutes."),
  language: z.string().trim().optional().nullable(),
  // PRIVATE is forced to 1 below regardless of what's submitted — PUBLIC has
  // no ceiling (unlike ateliers' max-8), just a positive-int floor.
  capacity: z.coerce.number({ error: "La capacité est invalide." }).int().positive("La capacité doit être d'au moins 1 personne."),
  animatorId: z.string().optional().nullable(),
  status: z.enum(["DRAFT", "PUBLISHED", "CANCELLED", "ARCHIVED"]).optional().default("DRAFT"),
  allowMultipleSessions: z.boolean().optional().default(false),
  depositPercentage: z.coerce.number().int().min(0).max(100).optional().default(50),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  sessions: z.array(sessionSchema).optional().default([]),
});

const updateFormationSchema = formationSchema.extend({
  id: z.string().min(1, "L'identifiant de la formation est obligatoire."),
});

/** Forces capacity to 1 everywhere for a PRIVATE formation — the client's
 * toggle state is never trusted for this, only the server-validated type. */
function enforceCapacityForType(data) {
  if (data.type !== "PRIVATE") return data;
  return {
    ...data,
    capacity: 1,
    sessions: data.sessions.map((s) => ({ ...s, capacity: 1 })),
  };
}

/**
 * Gate for formation mutations: admin/owner may act on any formation; staff
 * may only create (no existing row to own yet) or, when requireOwnerForEdit
 * is set, act on a formation they created themselves.
 */
async function requireFormationAccess(formationId, { requireOwnerForEdit = false } = {}) {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!hasPermission(session.user.role, DASHBOARD_PERMISSIONS.FORMATIONS)) {
    return { error: "Non autorisé." };
  }
  if (isAdminRole(session.user.role)) return { session };
  if (!requireOwnerForEdit) return { session };

  const formation = await prisma.formation.findUnique({
    where: { id: formationId },
    select: { createdById: true },
  });
  if (!formation) return { error: "Formation introuvable." };
  if (formation.createdById !== session.user.id) {
    return { error: "Vous ne pouvez modifier que les formations que vous avez créées." };
  }
  return { session };
}

/**
 * Crée une nouvelle formation.
 */
export async function createFormation(input) {
  try {
    const { session, error } = await requireFormationAccess();
    if (error) {
      return { success: false, message: error };
    }

    const parsed = formationSchema.safeParse(input);
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

    const { animatorId, sessions, startDate, endDate, ...rest } = enforceCapacityForType(parsed.data);

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

    const formation = await prisma.formation.create({
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

    revalidatePath("/dashboard/formations");
    return {
      success: true,
      message: "Formation créée avec succès !",
      data: serializeDecimalFields(formation),
    };
  } catch (error) {
    console.error("[createFormation]", error);
    return { success: false, message: "Une erreur est survenue lors de la création de la formation." };
  }
}

/**
 * Modifie une formation existante.
 */
export async function updateFormation(input) {
  try {
    const { error } = await requireFormationAccess(input?.id, { requireOwnerForEdit: true });
    if (error) {
      return { success: false, message: error };
    }

    const parsed = updateFormationSchema.safeParse(input);
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

    const { id, animatorId, sessions, startDate, endDate, ...rest } = enforceCapacityForType(parsed.data);

    const existingFormation = await prisma.formation.findUnique({
      where: { id },
      include: { sessions: true },
    });
    if (!existingFormation) {
      return { success: false, message: "Formation introuvable." };
    }

    if (animatorId) {
      const animatorExists = await prisma.animator.findUnique({ where: { id: animatorId } });
      if (!animatorExists) {
        return { success: false, message: "L'animateur sélectionné est introuvable." };
      }
    }

    for (const s of sessions) {
      if (s.animatorId) {
        const animExists = await prisma.animator.findUnique({ where: { id: s.animatorId } });
        if (!animExists) {
          return { success: false, message: "L'animateur d'une session est introuvable." };
        }
      }
    }

    const existingIds = existingFormation.sessions.map((s) => s.id);
    const incomingIds = sessions.filter((s) => s.id).map((s) => s.id);
    const idsToDelete = existingIds.filter((eid) => !incomingIds.includes(eid));

    // A session the form no longer lists reads as "removed" — but if it
    // already has bookings, deleting it cascades into deleting those
    // FormationReservation rows, which crashes: their Payment row (if any)
    // has ON DELETE SET NULL on formationReservationId, and nulling that out
    // leaves the Payment with no polymorphic source at all, violating the
    // Payment_exactly_one_source CHECK constraint. Block it with a real
    // message instead of letting Postgres throw.
    if (idsToDelete.length > 0) {
      const toDelete = await prisma.formationSession.findMany({
        where: { id: { in: idsToDelete } },
        select: { id: true, _count: { select: { reservations: true } } },
      });
      const withBookings = toDelete.filter((s) => s._count.reservations > 0);
      if (withBookings.length > 0) {
        return {
          success: false,
          message:
            withBookings.length === 1
              ? "Impossible de retirer une session qui a déjà des réservations. Annulez d'abord ces réservations, ou laissez la session dans le formulaire."
              : "Impossible de retirer des sessions qui ont déjà des réservations. Annulez d'abord ces réservations, ou laissez-les dans le formulaire.",
        };
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (idsToDelete.length > 0) {
        await tx.formationSession.deleteMany({ where: { id: { in: idsToDelete } } });
      }

      const result = await tx.formation.update({
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
          await tx.formationSession.update({
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

      return result;
    });

    revalidatePath("/dashboard/formations");
    return {
      success: true,
      message: "Formation mise à jour avec succès !",
      data: serializeDecimalFields(updated),
    };
  } catch (error) {
    console.error("[updateFormation]", error);
    return { success: false, message: "Une erreur est survenue lors de la mise à jour de la formation." };
  }
}

/**
 * Supprime une formation.
 */
export async function deleteFormation(id) {
  try {
    const { error } = await requireFormationAccess(id, { requireOwnerForEdit: true });
    if (error) {
      return { success: false, message: error };
    }

    if (!id) {
      return { success: false, message: "Identifiant manquant." };
    }

    const existingFormation = await prisma.formation.findUnique({ where: { id } });
    if (!existingFormation) {
      return { success: false, message: "Formation introuvable." };
    }

    await prisma.formation.delete({ where: { id } });

    revalidatePath("/dashboard/formations");
    return { success: true, message: "Formation supprimée avec succès !" };
  } catch (error) {
    console.error("[deleteFormation]", error);
    return { success: false, message: "Une erreur est survenue lors de la suppression de la formation." };
  }
}
