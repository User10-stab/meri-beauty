"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isWithinCancellationWindow, CANCELLATION_WINDOW_HOURS } from "@/lib/reservationRules";

/**
 * Allows an authenticated CUSTOMER to cancel one of their own reservations.
 *
 * Business rules enforced here (server-side — never trust the client):
 *  - User must be authenticated.
 *  - The appointment must belong to the authenticated user.
 *  - The appointment must not already be CANCELLED or COMPLETED.
 *  - The appointment must NOT start within the next 48 hours.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function cancelReservation(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "Identifiant de réservation manquant." };
    }

    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    // Load the appointment — only select what we need for the checks
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      select: {
        id: true,
        userId: true,
        status: true,
        startTime: true,
        date: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Réservation introuvable." };
    }

    // Ownership check — customer can only cancel their own appointments
    if (appointment.userId !== session.user.id) {
      return { success: false, message: "Vous n'êtes pas autorisé à annuler cette réservation." };
    }

    // Terminal status check
    if (appointment.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }
    if (appointment.status === "COMPLETED") {
      return { success: false, message: "Les réservations terminées ne peuvent pas être annulées." };
    }

    // 48-hour window check — enforce server-side regardless of what the UI shows
    if (isWithinCancellationWindow(appointment.startTime)) {
      return {
        success: false,
        message: `Les réservations ne peuvent pas être annulées moins de ${CANCELLATION_WINDOW_HOURS} heures avant le rendez-vous.`,
      };
    }

    // Cancel the appointment
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "CANCELLED" },
    });

    // Create an in-app notification for the user
    await prisma.notification.create({
      data: {
        userId: session.user.id,
        appointmentId: appointment.id,
        type: "APPOINTMENT_CANCELLED",
        title: "Réservation annulée",
        message: `Votre réservation du ${new Date(appointment.date).toLocaleDateString("fr-FR")} a été annulée.`,
        status: "PENDING",
      },
    });

    return { success: true, message: "Votre réservation a été annulée." };
  } catch (error) {
    console.error("[cancelReservation]", error);
    return { success: false, message: "Une erreur est survenue. Veuillez réessayer." };
  }
}
