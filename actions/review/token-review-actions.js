"use server";

import { prisma } from "@/lib/prisma";
import { parseAndVerifyReviewToken } from "@/lib/review-token";
import { sendEmail } from "@/lib/email";
import { reviewThankYouEmail } from "@/lib/email-templates";
import {
  createNotificationsBulk,
  buildReviewSubmittedNotification,
  getReviewNotificationRecipients,
} from "@/lib/notifications";

/**
 * Validates a review token and returns the target item details to display on the form.
 */
export async function getReviewTargetFromToken(token) {
  const verified = parseAndVerifyReviewToken(token);
  if (!verified.ok) {
    return { success: false, error: verified.error || "Lien invalide ou expiré." };
  }

  const { reservationType, reservationId, email } = verified;

  try {
    if (reservationType === "APPOINTMENT") {
      const appointment = await prisma.appointment.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          user: { select: { fullName: true, email: true } },
          staffService: {
            include: {
              service: { select: { name: true } },
              staff: { select: { user: { select: { fullName: true } } } },
            },
          },
        },
      });

      if (!appointment) return { success: false, error: "Rendez-vous introuvable." };
      if (appointment.review) return { success: false, alreadyReviewed: true, message: "Vous avez déjà laissé un avis pour ce rendez-vous. Merci !" };

      return {
        success: true,
        data: {
          reservationType,
          reservationId,
          serviceName: appointment.staffService?.service?.name || "Rendez-vous",
          staffName: appointment.staffService?.staff?.user?.fullName || null,
          customerName: appointment.user?.fullName || "Client",
          date: appointment.startTime,
        },
      };
    }

    if (reservationType === "WORKSHOP") {
      const reservation = await prisma.workshopReservation.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          customer: { select: { fullName: true, email: true } },
          session: {
            include: {
              workshop: { select: { title: true } },
              animator: { select: { name: true } },
            },
          },
        },
      });

      if (!reservation) return { success: false, error: "Réservation d'atelier introuvable." };
      if (reservation.review) return { success: false, alreadyReviewed: true, message: "Vous avez déjà laissé un avis pour cet atelier. Merci !" };

      return {
        success: true,
        data: {
          reservationType,
          reservationId,
          serviceName: reservation.session?.workshop?.title || "Atelier",
          staffName: reservation.session?.animator?.name || null,
          customerName: reservation.customer?.fullName || "Client",
          date: reservation.session?.startTime,
        },
      };
    }

    if (reservationType === "FORMATION") {
      const reservation = await prisma.formationReservation.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          customer: { select: { fullName: true, email: true } },
          session: {
            include: {
              formation: { select: { title: true } },
              animator: { select: { name: true } },
            },
          },
        },
      });

      if (!reservation) return { success: false, error: "Réservation de formation introuvable." };
      if (reservation.review) return { success: false, alreadyReviewed: true, message: "Vous avez déjà laissé un avis pour cette formation. Merci !" };

      return {
        success: true,
        data: {
          reservationType,
          reservationId,
          serviceName: reservation.session?.formation?.title || "Formation",
          staffName: reservation.session?.animator?.name || null,
          customerName: reservation.customer?.fullName || "Client",
          date: reservation.session?.startTime,
        },
      };
    }

    if (reservationType === "ORDER") {
      const order = await prisma.order.findUnique({
        where: { id: reservationId },
        include: {
          user: { select: { fullName: true, email: true } },
        },
      });

      if (!order) return { success: false, error: "Commande introuvable." };

      return {
        success: true,
        data: {
          reservationType,
          reservationId,
          serviceName: `Commande n° ${order.id.slice(-6).toUpperCase()}`,
          staffName: null,
          customerName: order.user?.fullName || "Client",
          date: order.createdAt,
        },
      };
    }

    return { success: false, error: "Type de réservation non reconnu." };
  } catch (err) {
    console.error("[getReviewTargetFromToken]", err);
    return { success: false, error: "Impossible de charger les informations." };
  }
}

/**
 * Submits a review using a signed review token.
 */
export async function submitReviewWithToken({ token, rating, comment }) {
  const verified = parseAndVerifyReviewToken(token);
  if (!verified.ok) {
    return { success: false, error: verified.error || "Lien invalide ou expiré." };
  }

  const numRating = Number(rating);
  if (!numRating || numRating < 1 || numRating > 5) {
    return { success: false, error: "Veuillez sélectionner une note entre 1 et 5 étoiles." };
  }

  const cleanComment = typeof comment === "string" ? comment.trim().slice(0, 1000) : "";
  const { reservationType, reservationId, email } = verified;

  try {
    // 1. Locate customer user
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, fullName: true, email: true },
    });

    if (!user) {
      return { success: false, error: "Compte utilisateur introuvable." };
    }

    let review = null;
    let serviceName = "votre prestation";
    let staffId = null;

    if (reservationType === "APPOINTMENT") {
      const appointment = await prisma.appointment.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          staffService: {
            select: {
              staffId: true,
              service: { select: { name: true } },
            },
          },
        },
      });

      if (!appointment) return { success: false, error: "Rendez-vous introuvable." };
      if (appointment.review) return { success: false, error: "Un avis a déjà été enregistré pour ce rendez-vous." };

      serviceName = appointment.staffService?.service?.name || "votre rendez-vous";
      staffId = appointment.staffService?.staffId || null;

      review = await prisma.review.create({
        data: {
          appointmentId: reservationId,
          userId: user.id,
          rating: numRating,
          comment: cleanComment || null,
        },
      });
    } else if (reservationType === "WORKSHOP") {
      const workshopRes = await prisma.workshopReservation.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          session: {
            include: {
              workshop: { select: { title: true } },
              animator: { select: { staffId: true } },
            },
          },
        },
      });

      if (!workshopRes) return { success: false, error: "Atelier introuvable." };
      if (workshopRes.review) return { success: false, error: "Un avis a déjà été enregistré pour cet atelier." };

      serviceName = workshopRes.session?.workshop?.title || "votre atelier";
      staffId = workshopRes.session?.animator?.staffId || null;

      review = await prisma.review.create({
        data: {
          workshopReservationId: reservationId,
          userId: user.id,
          rating: numRating,
          comment: cleanComment || null,
        },
      });
    } else if (reservationType === "FORMATION") {
      const formationRes = await prisma.formationReservation.findUnique({
        where: { id: reservationId },
        include: {
          review: true,
          session: {
            include: {
              formation: { select: { title: true } },
              animator: { select: { staffId: true } },
            },
          },
        },
      });

      if (!formationRes) return { success: false, error: "Formation introuvable." };
      if (formationRes.review) return { success: false, error: "Un avis a déjà été enregistré pour cette formation." };

      serviceName = formationRes.session?.formation?.title || "votre formation";
      staffId = formationRes.session?.animator?.staffId || null;

      review = await prisma.review.create({
        data: {
          formationReservationId: reservationId,
          userId: user.id,
          rating: numRating,
          comment: cleanComment || null,
        },
      });
    } else if (reservationType === "ORDER") {
      serviceName = "votre commande boutique";
    }

    // Send notifications to dashboard team if review created
    if (review) {
      const recipients = await getReviewNotificationRecipients(staffId);
      if (recipients.length > 0) {
        await createNotificationsBulk(
          recipients.map((uid) =>
            buildReviewSubmittedNotification({
              userId: uid,
              reviewId: review.id,
              rating: numRating,
              customerName: user.fullName || "Client",
              serviceName,
              appointmentId: reservationType === "APPOINTMENT" ? reservationId : null,
            })
          )
        ).catch((err) => console.error("[submitReviewWithToken] notification error:", err));
      }
    }

    // Send thank-you confirmation email
    await sendEmail({
      to: email,
      ...reviewThankYouEmail({
        customerName: user.fullName || "vous",
        serviceName,
        rating: numRating,
      }),
    }).catch((err) => console.error("[submitReviewWithToken] thank-you email failed:", err));

    return { success: true, message: "Votre avis a été enregistré avec succès !" };
  } catch (err) {
    console.error("[submitReviewWithToken]", err);
    return { success: false, error: "Une erreur est survenue lors de l'enregistrement." };
  }
}
