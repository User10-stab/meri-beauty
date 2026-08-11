"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getAppointmentReviewBlockReason,
  REVIEW_ERRORS,
} from "@/lib/review-eligibility";
import { createReviewSchema } from "@/lib/validations/review";
import {
  createNotificationsBulk,
  buildReviewSubmittedNotification,
  getReviewNotificationRecipients,
} from "@/lib/notifications";
import { isAdminRole } from "@/lib/authorization";

function serializeReview(review) {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt?.toISOString() ?? null,
    appointmentId: review.appointmentId,
    customerName: review.user?.fullName ?? "—",
    customerEmail: review.user?.email ?? null,
    serviceName: review.appointment?.staffService?.service?.name ?? "—",
    staffId: review.appointment?.staffService?.staffId ?? null,
    staffName: review.appointment?.staffService?.staff?.user?.fullName ?? null,
  };
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
            user: { select: { fullName: true } },
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

export async function getReviewDashboardData() {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non authentifié.", data: null };
  }

  const where = session.user.role === "STAFF"
    ? {
        appointment: {
          staffService: {
            staff: {
              userId: session.user.id,
            },
          },
        },
      }
    : {};

  try {
    const reviews = await prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { fullName: true, email: true } },
        appointment: {
          include: {
            staffService: {
              select: {
                staffId: true,
                service: { select: { name: true } },
                staff: {
                  select: {
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const totalReviews = reviews.length;
    const averageRating = totalReviews
      ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews).toFixed(1))
      : 0;

    return {
      success: true,
      data: {
        averageRating,
        totalReviews,
        reviews: reviews.map(serializeReview),
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

    return { success: true, message: "Avis supprimé avec succès." };
  } catch (error) {
    console.error("[deleteReview]", error);
    return { success: false, message: "Impossible de supprimer l'avis." };
  }
}
