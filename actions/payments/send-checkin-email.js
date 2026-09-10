"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { STAFF_PERMISSIONS, hasDashboardPermission } from "@/lib/authorization";
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

/**
 * The polymorphic Payment's booking, reduced to what checkInReminderEmail
 * needs — same branching as resolveCheckInAsset in
 * actions/dashboard/admin-operations.js, but this also needs the customer
 * and a human-readable title/date, which that read-only summary doesn't.
 */
function resolveBookingForCheckIn(payment) {
  if (payment?.appointment?.checkInCode) {
    const a = payment.appointment;
    return {
      checkInCode: a.checkInCode,
      customer: a.user,
      activityTitle: a.staffService?.service?.name ?? "votre rendez-vous",
      sessionDate: formatSessionDate(a.date),
      filenamePrefix: "billet-rendez-vous",
    };
  }
  if (payment?.workshopReservation?.checkInCode) {
    const r = payment.workshopReservation;
    return {
      checkInCode: r.checkInCode,
      customer: r.customer,
      activityTitle: r.session.workshop.title,
      sessionDate: formatSessionDate(r.session.startDate),
      filenamePrefix: "billet-atelier",
    };
  }
  if (payment?.formationReservation?.checkInCode) {
    const r = payment.formationReservation;
    return {
      checkInCode: r.checkInCode,
      customer: r.customer,
      activityTitle: r.session.formation.title,
      sessionDate: formatSessionDate(r.session.startDate),
      filenamePrefix: "billet-formation",
    };
  }
  return null;
}

/**
 * Manually re-sends a reservation/appointment's check-in QR ticket to the
 * client it belongs to — the manual counterpart to sendTicketByEmail
 * (actions/payments/send-ticket-email.js), for a client who says they never
 * got the original confirmation e-mail (or lost it) and now has no ticket to
 * show at the door.
 *
 * Gated on the same STAFF_PERMISSIONS.SEND_TICKET_EMAIL permission as the
 * till-receipt resend: both are "let this staff member put a document back
 * in a client's inbox," and the Opérations drawer that hosts both buttons is
 * admin-only regardless (requireAdmin), so there is no case where one is
 * available and not the other.
 *
 * Deliberately NOT taking a recipient address from the caller, same reason
 * as sendTicketByEmail: the address always comes from the booking's own
 * customer record.
 */
export async function sendCheckInEmail(paymentId) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Non autorisé." };
  }
  if (!(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.SEND_TICKET_EMAIL))) {
    return { success: false, message: "Non autorisé." };
  }
  if (typeof paymentId !== "string" || !paymentId) {
    return { success: false, message: "Paiement introuvable." };
  }

  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          select: {
            checkInCode: true,
            date: true,
            user: { select: { fullName: true, email: true } },
            staffService: { select: { service: { select: { name: true } } } },
          },
        },
        workshopReservation: {
          select: {
            checkInCode: true,
            customer: { select: { fullName: true, email: true } },
            session: { select: { startDate: true, workshop: { select: { title: true } } } },
          },
        },
        formationReservation: {
          select: {
            checkInCode: true,
            customer: { select: { fullName: true, email: true } },
            session: { select: { startDate: true, formation: { select: { title: true } } } },
          },
        },
      },
    });

    if (!payment) {
      return { success: false, message: "Paiement introuvable." };
    }

    const booking = resolveBookingForCheckIn(payment);
    if (!booking) {
      return {
        success: false,
        message: "Aucun billet d'entrée n'a encore été généré pour cette réservation.",
      };
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
      entityType: "Payment",
      entityId: paymentId,
      metadata: { checkInCode: booking.checkInCode, recipient },
      actor: session.user,
    });

    return { success: true, message: `Billet d'entrée envoyé à ${recipient}.` };
  } catch (error) {
    console.error("[sendCheckInEmail]", error);
    return { success: false, message: "Impossible d'envoyer ce billet." };
  }
}
