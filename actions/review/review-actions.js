"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getAppointmentReviewBlockReason,
  getReservationReviewBlockReason,
  REVIEW_ERRORS,
  RESERVATION_REVIEW_ERRORS,
} from "@/lib/review-eligibility";
import { createReviewSchema, createReservationReviewSchema } from "@/lib/validations/review";
import {
  createNotificationsBulk,
  buildReviewSubmittedNotification,
  getReviewNotificationRecipients,
} from "@/lib/notifications";
import { isAdminRole, canAccessDashboard } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { reviewThankYouEmail } from "@/lib/email-templates";

// session-level animator overrides the activity's own animator — same
// precedence as lib/payments/resolve-payee.js.
function resolveActivityAnimator(session) {
  return session?.animator ?? session?.workshop?.animator ?? session?.formation?.animator ?? null;
}

function serializeReview(review) {
  let serviceName = "—";
  let staffId = null;
  let staffName = null;

  if (review.appointment) {
    serviceName = review.appointment.staffService?.service?.name ?? "—";
    staffId = review.appointment.staffService?.staffId ?? null;
    staffName = review.appointment.staffService?.staff?.user?.fullName ?? null;
  } else if (review.workshopReservation) {
    const session = review.workshopReservation.session;
    serviceName = session?.workshop?.title ?? "—";
    const animator = resolveActivityAnimator(session);
    staffId = animator?.staffId ?? null;
    staffName = animator?.name ?? null;
  } else if (review.formationReservation) {
    const session = review.formationReservation.session;
    serviceName = session?.formation?.title ?? "—";
    const animator = resolveActivityAnimator(session);
    staffId = animator?.staffId ?? null;
    staffName = animator?.name ?? null;
  }

  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt?.toISOString() ?? null,
    appointmentId: review.appointmentId,
    workshopReservationId: review.workshopReservationId,
    formationReservationId: review.formationReservationId,
    customerName: review.user?.fullName ?? "—",
    customerEmail: review.user?.email ?? null,
    serviceName,
    staffId,
    staffName,
  };
}

const RESERVATION_ANIMATOR_SELECT = { select: { name: true, staffId: true } };

// Config driving the two reservation-review entry points below — same
// operation (validate → check eligibility → create → notify), pointed at
// either WorkshopReservation or FormationReservation. Kept as one parametrized
// helper rather than two full copies to avoid the create/notify logic
// drifting apart; the two are still exposed as separate public functions,
// same as the reservations themselves stay separate tables.
const RESERVATION_REVIEW_CONFIG = {
  workshop: {
    idField: "workshopReservationId",
    relation: "workshopReservation",
    model: "workshopReservation",
    sessionInclude: {
      select: {
        animator: RESERVATION_ANIMATOR_SELECT,
        workshop: { select: { title: true, animator: RESERVATION_ANIMATOR_SELECT } },
      },
    },
  },
  formation: {
    idField: "formationReservationId",
    relation: "formationReservation",
    model: "formationReservation",
    sessionInclude: {
      select: {
        animator: RESERVATION_ANIMATOR_SELECT,
        formation: { select: { title: true, animator: RESERVATION_ANIMATOR_SELECT } },
      },
    },
  },
};

async function getReviewableReservation(tx, kind, reservationId) {
  const config = RESERVATION_REVIEW_CONFIG[kind];
  return tx[config.model].findUnique({
    where: { id: reservationId },
    include: {
      review: true,
      session: config.sessionInclude,
    },
  });
}

async function getReviewableAppointment(tx, appointmentId) {
  return tx.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      review: true,
      staffService: {
        include: {
          service: { select: { name: true } },
          staff: { select: { id: true } },
        },
      },
      user: { select: { id: true, fullName: true } },
    },
  });
}

export async function createAppointmentReview(input) {
  const parsed = createReviewSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: {
        appointmentId: fieldErrors.appointmentId?.[0] ?? null,
        rating: fieldErrors.rating?.[0] ?? null,
        comment: fieldErrors.comment?.[0] ?? null,
      },
    };
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: REVIEW_ERRORS.AUTH_REQUIRED };
  }

  try {
    const { appointmentId, rating, comment } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const appointment = await getReviewableAppointment(tx, appointmentId);
      const blockReason = getAppointmentReviewBlockReason(appointment, userId);

      if (blockReason) {
        return { error: REVIEW_ERRORS[blockReason] };
      }

      try {
        const review = await tx.review.create({
          data: {
            appointmentId,
            userId,
            rating,
            comment,
          },
          include: {
            user: { select: { fullName: true, email: true } },
            appointment: {
              include: {
                staffService: {
                  select: {
                    staffId: true,
                    service: { select: { name: true } },
                  },
                },
              },
            },
          },
        });

        return { review };
      } catch (error) {
        if (error?.code === "P2002") {
          return { error: REVIEW_ERRORS.ALREADY_REVIEWED };
        }
        throw error;
      }
    });

    if (result.error) {
      return { success: false, message: result.error };
    }

    // Notify dashboard users about the new review (outside transaction - business operation already committed)
    const review = result.review;
    const staffId = review.appointment?.staffService?.staffId;
    const serviceName = review.appointment?.staffService?.service?.name;
    const customerName = review.user?.fullName;
    const recipientUserIds = await getReviewNotificationRecipients(staffId);

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildReviewSubmittedNotification({
              userId: uid,
              reviewId: review.id,
              rating: review.rating,
              customerName,
              serviceName,
              appointmentId: review.appointmentId,
            })
          )
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error("[createAppointmentReview] notification validation error:", err.fieldErrors);
        } else {
          console.error("[createAppointmentReview] notifications failed:", err);
        }
      }
    }

    if (review.user?.email) {
      await sendEmail({
        to: review.user.email,
        ...reviewThankYouEmail({
          customerName: customerName || "vous",
          serviceName: serviceName || "votre rendez-vous",
          rating: review.rating,
        }),
      }).catch((err) => console.error("[createAppointmentReview] thank-you email failed:", err));
    }

    revalidatePath("/profile");
    revalidatePath("/dashboard/allAppointments");

    return {
      success: true,
      message: "Merci, votre avis a été envoyé.",
      data: serializeReview(result.review),
    };
  } catch (error) {
    console.error("[createAppointmentReview]", error);
    return { success: false, message: "Impossible d'enregistrer votre avis pour le moment." };
  }
}

async function createReservationReview(kind, input) {
  const config = RESERVATION_REVIEW_CONFIG[kind];
  const parsed = createReservationReviewSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: {
        reservationId: fieldErrors.reservationId?.[0] ?? null,
        rating: fieldErrors.rating?.[0] ?? null,
        comment: fieldErrors.comment?.[0] ?? null,
      },
    };
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, message: RESERVATION_REVIEW_ERRORS.AUTH_REQUIRED };
  }

  try {
    const { reservationId, rating, comment } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const reservation = await getReviewableReservation(tx, kind, reservationId);
      const blockReason = getReservationReviewBlockReason(reservation, userId);

      if (blockReason) {
        return { error: RESERVATION_REVIEW_ERRORS[blockReason] };
      }

      try {
        const review = await tx.review.create({
          data: {
            [config.idField]: reservationId,
            userId,
            rating,
            comment,
          },
          include: {
            user: { select: { fullName: true, email: true } },
            [config.relation]: {
              include: { session: config.sessionInclude },
            },
          },
        });

        return { review };
      } catch (error) {
        if (error?.code === "P2002") {
          return { error: RESERVATION_REVIEW_ERRORS.ALREADY_REVIEWED };
        }
        throw error;
      }
    });

    if (result.error) {
      return { success: false, message: result.error };
    }

    // Notify dashboard users about the new review (outside transaction - business operation already committed)
    const serialized = serializeReview(result.review);
    const recipientUserIds = await getReviewNotificationRecipients(serialized.staffId);

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildReviewSubmittedNotification({
              userId: uid,
              reviewId: serialized.id,
              rating: serialized.rating,
              customerName: serialized.customerName,
              serviceName: serialized.serviceName,
            })
          )
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error(`[create${kind}ReservationReview] notification validation error:`, err.fieldErrors);
        } else {
          console.error(`[create${kind}ReservationReview] notifications failed:`, err);
        }
      }
    }

    if (serialized.customerEmail) {
      await sendEmail({
        to: serialized.customerEmail,
        ...reviewThankYouEmail({
          customerName: serialized.customerName || "vous",
          serviceName: serialized.serviceName || "votre réservation",
          rating: serialized.rating,
        }),
      }).catch((err) => console.error(`[create${kind}ReservationReview] thank-you email failed:`, err));
    }

    revalidatePath("/mon-compte");
    revalidatePath("/dashboard/reviews");

    return {
      success: true,
      message: "Merci, votre avis a été envoyé.",
      data: serialized,
    };
  } catch (error) {
    console.error(`[create${kind}ReservationReview]`, error);
    return { success: false, message: "Impossible d'enregistrer votre avis pour le moment." };
  }
}

export async function createWorkshopReservationReview(input) {
  return createReservationReview("workshop", input);
}

export async function createFormationReservationReview(input) {
  return createReservationReview("formation", input);
}

export async function getReviewDashboardData() {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non authentifié.", data: null };
  }
  // Dashboard-only: every review here includes the reviewing customer's full
  // name and email, so a plain CUSTOMER session must never reach the query
  // below (the STAFF-scoping filter beneath this doesn't apply to that role).
  if (!canAccessDashboard(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes.", data: null };
  }

  const isStaff = session.user.role === "STAFF";
  const userId = session.user.id;

  // Each reservation kind keeps its own pool (rendez-vous / ateliers &
  // événements / formations) instead of one merged list — three independent
  // queries below, same "kept separate" approach as the reservation tables
  // themselves. STAFF scoping mirrors the session-overrides-activity animator
  // precedence used at payment time (lib/payments/resolve-payee.js).
  const appointmentWhere = {
    appointmentId: { not: null },
    ...(isStaff ? { appointment: { staffService: { staff: { userId } } } } : {}),
  };

  const workshopWhere = {
    workshopReservationId: { not: null },
    ...(isStaff
      ? {
          workshopReservation: {
            session: {
              OR: [
                { animator: { staff: { userId } } },
                { animatorId: null, workshop: { animator: { staff: { userId } } } },
              ],
            },
          },
        }
      : {}),
  };

  const formationWhere = {
    formationReservationId: { not: null },
    ...(isStaff
      ? {
          formationReservation: {
            session: {
              OR: [
                { animator: { staff: { userId } } },
                { animatorId: null, formation: { animator: { staff: { userId } } } },
              ],
            },
          },
        }
      : {}),
  };

  const buildPool = (reviews) => {
    const totalReviews = reviews.length;
    const averageRating = totalReviews
      ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews).toFixed(1))
      : 0;
    return { averageRating, totalReviews, reviews: reviews.map(serializeReview) };
  };

  try {
    const [appointmentReviews, workshopReviews, formationReviews] = await Promise.all([
      prisma.review.findMany({
        where: appointmentWhere,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { fullName: true, email: true } },
          appointment: {
            include: {
              staffService: {
                select: {
                  staffId: true,
                  service: { select: { name: true } },
                  staff: { select: { user: { select: { fullName: true } } } },
                },
              },
            },
          },
        },
      }),
      prisma.review.findMany({
        where: workshopWhere,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { fullName: true, email: true } },
          workshopReservation: {
            include: { session: RESERVATION_REVIEW_CONFIG.workshop.sessionInclude },
          },
        },
      }),
      prisma.review.findMany({
        where: formationWhere,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { fullName: true, email: true } },
          formationReservation: {
            include: { session: RESERVATION_REVIEW_CONFIG.formation.sessionInclude },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        appointments: buildPool(appointmentReviews),
        workshops: buildPool(workshopReviews),
        formations: buildPool(formationReviews),
      },
    };
  } catch (error) {
    console.error("[getReviewDashboardData]", error);
    return { success: false, message: "Impossible de charger les avis.", data: null };
  }
}

export async function deleteReview(reviewId) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non authentifié." };
  }

  // Only admin users can delete reviews
  if (!isAdminRole(session.user.role)) {
    return { success: false, message: "Seuls les administrateurs peuvent supprimer des avis." };
  }

  try {
    await prisma.review.delete({
      where: { id: reviewId },
    });

    revalidatePath("/dashboard/reviews");
    revalidatePath("/dashboard/allAppointments");
    revalidatePath("/profile");
    revalidatePath("/mon-compte");

    return { success: true, message: "Avis supprimé avec succès." };
  } catch (error) {
    console.error("[deleteReview]", error);
    return { success: false, message: "Impossible de supprimer l'avis." };
  }
}
