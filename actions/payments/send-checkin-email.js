"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, canSendTicketEmail, getStaffId, hasDashboardPermission, isTillCashOperator } from "@/lib/authorization";
import { ACTIVITY_RESERVATION_KINDS, activityReservationStaffScope } from "@/lib/activity-reservation-access";
import { sendEmail } from "@/lib/email";
import { checkInReminderEmail } from "@/lib/email-templates";
import { qrPngAttachment } from "@/lib/qrcode";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

const CUSTOMER_SELECT = { select: { fullName: true, email: true } };

const APPOINTMENT_SELECT = {
  checkInCode: true,
  date: true,
  user: CUSTOMER_SELECT,
  staffService: { select: { staffId: true, service: { select: { name: true } } } },
};
const WORKSHOP_RESERVATION_SELECT = {
  checkInCode: true,
  customer: CUSTOMER_SELECT,
  session: { select: { startDate: true, workshop: { select: { title: true } } } },
};
const FORMATION_RESERVATION_SELECT = {
  checkInCode: true,
  customer: CUSTOMER_SELECT,
  session: { select: { startDate: true, formation: { select: { title: true } } } },
};

function appointmentBooking(a) {
  if (!a?.checkInCode) return null;
  return {
    checkInCode: a.checkInCode,
    customer: a.user,
    activityTitle: a.staffService?.service?.name ?? "votre rendez-vous",
    sessionDate: formatSessionDate(a.date),
    filenamePrefix: "billet-rendez-vous",
  };
}

function workshopBooking(r) {
  if (!r?.checkInCode) return null;
  return {
    checkInCode: r.checkInCode,
    customer: r.customer,
    activityTitle: r.session.workshop.title,
    sessionDate: formatSessionDate(r.session.startDate),
    filenamePrefix: "billet-atelier",
  };
}

function formationBooking(r) {
  if (!r?.checkInCode) return null;
  return {
    checkInCode: r.checkInCode,
    customer: r.customer,
    activityTitle: r.session.formation.title,
    sessionDate: formatSessionDate(r.session.startDate),
    filenamePrefix: "billet-formation",
  };
}

/**
 * The shared tail of both entry points below: e-mail the booking's own client
 * their check-in QR, then audit it. The recipient always comes from the
 * booking's customer record, never from the caller.
 */
async function deliverCheckInEmail(booking, { entityType, entityId, actor }) {
  if (!booking) {
    return { success: false, message: "Aucun billet d'entrée n'a encore été généré pour cette réservation." };
  }

  const recipient = booking.customer?.email?.trim();
  if (!recipient) {
    return {
      success: false,
      message: "Ce client n'a aucune adresse e-mail enregistrée. Corrigez sa fiche, puis réessayez.",
    };
  }

  const attachment = await qrPngAttachment(
    booking.checkInCode,
    `${booking.filenamePrefix}-${booking.checkInCode}.png`,
  ).catch(() => null);

  const { subject, text, html } = checkInReminderEmail({
    customerName: booking.customer.fullName,
    activityTitle: booking.activityTitle,
    sessionDate: booking.sessionDate,
    checkInCode: booking.checkInCode,
  });

  const sendResult = await sendEmail({
    to: recipient,
    subject,
    text,
    html,
    ...(attachment ? { attachments: [attachment] } : {}),
  });

  if (sendResult && sendResult.success === false) {
    return { success: false, message: `L'envoi a échoué : ${sendResult.error ?? "erreur du fournisseur e-mail"}.` };
  }

  await writeAuditLog(prisma, {
    action: AUDIT_ACTIONS.CHECKIN_TICKET_EMAILED,
    entityType,
    entityId,
    metadata: { checkInCode: booking.checkInCode, recipient },
    actor,
  });

  return { success: true, message: `QR code envoyé à ${recipient}.` };
}

/**
 * Re-sends a payment's check-in QR from the Opérations drawer, which is
 * admin-only (requireAdmin) — gated on canSendTicketEmail like the ticket
 * button beside it. Staff resend from their own screens through
 * resendCheckInQr below.
 */
export async function sendCheckInEmail(paymentId) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non autorisé." };
  }
  if (!(await canSendTicketEmail(session.user))) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof paymentId !== "string" || !paymentId) {
    return { success: false, message: "Paiement introuvable." };
  }

  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: { select: APPOINTMENT_SELECT },
        workshopReservation: { select: WORKSHOP_RESERVATION_SELECT },
        formationReservation: { select: FORMATION_RESERVATION_SELECT },
      },
    });
    if (!payment) {
      return { success: false, message: "Paiement introuvable." };
    }

    const booking =
      appointmentBooking(payment.appointment) ??
      workshopBooking(payment.workshopReservation) ??
      formationBooking(payment.formationReservation);

    return await deliverCheckInEmail(booking, { entityType: "Payment", entityId: paymentId, actor: session.user });
  } catch (error) {
    console.error("[sendCheckInEmail]", error);
    return { success: false, message: "Impossible d'envoyer ce billet." };
  }
}

const RESEND_KINDS = {
  APPOINTMENT: {
    entityType: "Appointment",
    permission: STAFF_PERMISSIONS.APPOINTMENTS,
  },
  WORKSHOP: {
    entityType: "WorkshopReservation",
    permission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
  },
  FORMATION: {
    entityType: "FormationReservation",
    permission: STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
  },
};

/**
 * Re-sends a booking's check-in QR to its client, from the rendez-vous,
 * atelier and formation screens. A client who paid must always be able to get
 * their proof of booking back, so this is NOT reserved to the salon's accounts
 * the way tickets are: the QR is an entry pass, not a fiscal document.
 *
 * Who may send it mirrors exactly who may see the booking:
 *   - the admin and Marie (isTillCashOperator): any booking;
 *   - any other staff member: a rendez-vous that is her own (APPOINTMENTS,
 *     same rule as authorizeAppointmentAction), or an atelier/formation
 *     booking on a session she runs (*_RESERVATIONS +
 *     activityReservationStaffScope, same scope as the reservation lists).
 *
 * @param {{ kind: "APPOINTMENT"|"WORKSHOP"|"FORMATION", id: string }} params
 */
export async function resendCheckInQr({ kind, id } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non autorisé." };

  const config = RESEND_KINDS[kind];
  if (!config || typeof id !== "string" || !id) {
    return { success: false, message: "Réservation introuvable." };
  }

  const user = session.user;
  const isSalonAccount = isTillCashOperator(user);
  if (!isSalonAccount && !(await hasDashboardPermission(user, config.permission))) {
    return { success: false, message: "Non autorisé." };
  }

  try {
    let booking = null;

    if (kind === "APPOINTMENT") {
      const appointment = await prisma.appointment.findFirst({
        where: { id, isDeleted: false },
        select: APPOINTMENT_SELECT,
      });
      if (!appointment) return { success: false, message: "Rendez-vous introuvable." };
      if (!isSalonAccount) {
        const ownStaffId = await getStaffId(session);
        if (!ownStaffId || appointment.staffService?.staffId !== ownStaffId) {
          return { success: false, message: "Ce rendez-vous ne fait pas partie des vôtres." };
        }
      }
      booking = appointmentBooking(appointment);
    } else {
      const activityKind = kind === "WORKSHOP" ? ACTIVITY_RESERVATION_KINDS.WORKSHOP : ACTIVITY_RESERVATION_KINDS.FORMATION;
      const scope = isSalonAccount ? {} : activityReservationStaffScope(activityKind, user);
      const reservation =
        kind === "WORKSHOP"
          ? await prisma.workshopReservation.findFirst({ where: { id, ...scope }, select: WORKSHOP_RESERVATION_SELECT })
          : await prisma.formationReservation.findFirst({ where: { id, ...scope }, select: FORMATION_RESERVATION_SELECT });
      if (!reservation) {
        return { success: false, message: "Cette réservation est introuvable ou ne fait pas partie de vos séances." };
      }
      booking = kind === "WORKSHOP" ? workshopBooking(reservation) : formationBooking(reservation);
    }

    return await deliverCheckInEmail(booking, { entityType: config.entityType, entityId: id, actor: user });
  } catch (error) {
    console.error("[resendCheckInQr]", error);
    return { success: false, message: "Impossible d'envoyer ce QR code." };
  }
}
