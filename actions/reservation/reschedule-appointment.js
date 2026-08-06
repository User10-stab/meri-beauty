"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { isWithinCancellationWindow, CANCELLATION_WINDOW_HOURS } from "@/lib/reservationRules";
import { buildAppointmentWindow, findConflictingAppointment } from "@/lib/appointment-scheduling";

const RESCHEDULABLE_STATUSES = ["PENDING", "CONFIRMED"];

/**
 * Moves an existing appointment to a new date/time for the same staff member
 * and service. Same 48-hour window as cancelReservation() — enforced here
 * server-side regardless of what the UI shows.
 *
 * @param {string} appointmentId
 * @param {{ date: Date|string, time: string }} target - "time" is "HH:mm"
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function rescheduleAppointment(appointmentId, { date, time }) {
  try {
    if (!appointmentId || !date || !time) {
      return { success: false, message: "Informations manquantes." };
    }

    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: { select: { fullName: true, email: true } },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: { select: { user: { select: { fullName: true } } } },
          },
        },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable." };
    }
    if (appointment.userId !== session.user.id) {
      return { success: false, message: "Vous n'êtes pas autorisé à modifier ce rendez-vous." };
    }
    if (!RESCHEDULABLE_STATUSES.includes(appointment.status)) {
      return { success: false, message: "Ce rendez-vous ne peut plus être modifié." };
    }

    // Same rule as cancellation — the current appointment must still be
    // outside the 48h window for a modification to be allowed at all.
    if (isWithinCancellationWindow(appointment.startTime)) {
      return {
        success: false,
        message: `Les rendez-vous ne peuvent plus être modifiés moins de ${CANCELLATION_WINDOW_HOURS} heures avant l'heure prévue.`,
      };
    }

    const { appointmentDate, startTime, endTime } = buildAppointmentWindow(
      date,
      time,
      appointment.staffService.duration
    );

    if (startTime.getTime() <= Date.now()) {
      return { success: false, message: "Veuillez choisir un créneau dans le futur." };
    }

    const conflict = await findConflictingAppointment(
      appointment.staffServiceId,
      appointmentDate,
      startTime,
      endTime,
      appointmentId
    );
    if (conflict) {
      return { success: false, message: "Ce créneau vient d'être réservé. Veuillez en choisir un autre." };
    }

    const previousDate = appointment.date;

    await prisma.$transaction([
      prisma.appointment.update({
        where: { id: appointmentId },
        data: { date: appointmentDate, startTime, endTime },
      }),
      prisma.notification.create({
        data: {
          userId: appointment.userId,
          appointmentId: appointment.id,
          type: "GENERAL",
          title: "Rendez-vous déplacé",
          message: `Votre rendez-vous du ${previousDate.toLocaleDateString("fr-FR")} a été déplacé au ${appointmentDate.toLocaleDateString("fr-FR")} à ${time}.`,
          status: "PENDING",
        },
      }),
    ]);

    const serviceName = appointment.staffService.service?.name ?? "votre service";
    const staffName = appointment.staffService.staff?.user?.fullName ?? "votre experte";
    const formattedDate = appointmentDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    sendEmail({
      to: appointment.user.email,
      subject: "Rendez-vous déplacé – Meri Beauty",
      text:
        `Bonjour ${appointment.user.fullName},\n\n` +
        `Votre rendez-vous "${serviceName}" avec ${staffName} a bien été déplacé au ${formattedDate} à ${time}.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${appointment.user.fullName},</p>` +
        `<p>Votre rendez-vous « ${serviceName} » avec ${staffName} a bien été déplacé au ${formattedDate} à ${time}.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[rescheduleAppointment] email failed:", err));

    return { success: true, message: "Votre rendez-vous a été déplacé." };
  } catch (error) {
    console.error("[rescheduleAppointment]", error);
    return { success: false, message: "Une erreur est survenue. Veuillez réessayer." };
  }
}
