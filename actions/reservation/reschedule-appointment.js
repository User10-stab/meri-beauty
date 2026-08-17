"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { isWithinCancellationWindow, CANCELLATION_WINDOW_HOURS } from "@/lib/reservationRules";
import { buildAppointmentWindow, findConflictingAppointment } from "@/lib/appointment-scheduling";
import { staffReservationModifiedEmail } from "@/lib/email-templates";
import {
  createNotificationsBulk,
  buildAppointmentCreatedNotification,
  getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients,
} from "@/lib/notifications";

const RESCHEDULABLE_STATUSES = ["PENDING", "ACCEPTED", "CONFIRMED"];

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

    if (startTime.getTime() === new Date(appointment.startTime).getTime()) {
      return { success: false, message: "Ce rendez-vous est déjà prévu à cet horaire. Choisissez une date ou une heure différente." };
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

    // findConflictingAppointment only rules out collision with another
    // appointment — it says nothing about closures, staff time off, working
    // hours. Re-validate against the same rules the booking calendar itself
    // uses to offer slots, exactly like createReservation does, so a
    // reschedule can't land on a closed day or outside working hours.
    const slotCheck = await validateAppointmentSlot(appointment.staffServiceId, appointmentDate, startTime, time, appointmentId);
    if (!slotCheck.valid) {
      return { success: false, message: slotCheck.message };
    }

    const previousDate = appointment.date;
    const serviceName = appointment.staffService.service?.name ?? "votre service";
    const staffName = appointment.staffService.staff?.user?.fullName ?? "votre experte";
    const customerName = appointment.user?.fullName;
    const staffUser = appointment.staffService.staff?.user;

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        // Reset reminder markers — the old ones were set relative to the
        // previous startTime, so left alone they'd permanently suppress
        // reminders for the new slot (both windows may already be "passed"
        // relative to the old time, or the DB thinks they were already sent).
        data: { date: appointmentDate, startTime, endTime, reminder24hSentAt: null, reminder2hSentAt: null },
      });
    });

    // Notify dashboard users that an appointment was rescheduled (outside transaction - business operation already committed)
    const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId);

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) => ({
            userId: uid,
            appointmentId: appointment.id,
            type: "GENERAL",
            title: "Rendez-vous déplacé",
            message: `Rendez-vous${serviceName ? ` (${serviceName})` : ""} déplacé du ${previousDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} vers le ${appointmentDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} à ${time}${customerName ? ` — ${customerName}` : ""}.`,
            actionUrl: "/dashboard/appointments",
            status: "PENDING",
          }))
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error("[rescheduleAppointment] notification validation error:", err.fieldErrors);
        } else {
          console.error("[rescheduleAppointment] notifications failed:", err);
        }
      }
    }
    const formattedDate = appointmentDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Brussels",
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

    // Send email to assigned staff member and admin/owner users
    const emailRecipients = await getAppointmentEmailRecipients(appointment.staffId);
    for (const recipient of emailRecipients) {
      await sendEmail({
        to: recipient.email,
        ...staffReservationModifiedEmail({
          staffName: recipient.fullName,
          customerName: appointment.user.fullName,
          serviceName,
          previousDate,
          newDate: appointmentDate,
          newTime: time,
        }),
      }).catch((err) => console.error("[rescheduleAppointment] dashboard email failed:", err));
    }

    return { success: true, message: "Votre rendez-vous a été déplacé." };
  } catch (error) {
    console.error("[rescheduleAppointment]", error);
    return { success: false, message: "Une erreur est survenue. Veuillez réessayer." };
  }
}
