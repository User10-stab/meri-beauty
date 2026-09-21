import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { qrPngAttachment } from "@/lib/qrcode";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";
import { workshopReservationConfirmationEmail, formationReservationConfirmationEmail } from "@/lib/email-templates";

/**
 * The seat confirmation and its check-in QR, for a reservation confirmed by
 * something other than an online payment (2026-09-21).
 *
 * WHY THIS EXISTS
 *
 * A séance is sold on a 50% acompte, so a confirmed seat and a fully paid one
 * are different things: the client attends on the deposit and settles the
 * balance at the door. The confirmation carries the QR they check in with, so
 * it has to go out when the SEAT is confirmed, not when the money is complete.
 *
 * The online path already does that (confirmWorkshopReservationPayment /
 * confirmFormationReservationPayment). The counter's « Virement » path did
 * not, and the gap lost a real client their ticket: booking by transfer sends
 * nothing — correctly, nothing has been paid — and accepting the transfer
 * only sent a receipt once the payment was FULLY paid. A 50 € deposit on a
 * 100 € formation satisfied neither condition, so the seat was confirmed, the
 * check-in code was minted, and the client was never told either.
 *
 * Deliberately mirrors the online senders rather than inventing a second
 * email: same template, same QR attachment, same failure handling (never
 * throws — the money is already committed by the time this runs).
 */

const KINDS = {
  WORKSHOP: {
    checkInKind: CHECK_IN_KINDS.WORKSHOP,
    filePrefix: "billet-atelier",
    build: (args) => workshopReservationConfirmationEmail({ activityTitle: args.title, ...args }),
  },
  FORMATION: {
    checkInKind: CHECK_IN_KINDS.FORMATION,
    filePrefix: "billet-formation",
    build: (args) => formationReservationConfirmationEmail({ formationTitle: args.title, ...args }),
  },
};

function formatSessionDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

/**
 * @param {"WORKSHOP"|"FORMATION"} kind
 * @param {object} reservation - with customer and session.{workshop|formation}
 * @param {{ invoiceNote?: string }} [options]
 * @returns {Promise<{ sent: boolean }>} never throws
 */
export async function sendReservationConfirmation(kind, reservation, { invoiceNote = "" } = {}) {
  const config = KINDS[kind];
  if (!config || !reservation?.customer?.email) return { sent: false };

  try {
    const parent = kind === "WORKSHOP" ? reservation.session?.workshop : reservation.session?.formation;

    // Idempotent: the reservation may already carry a code from its own
    // lazy mint on the profile page.
    const checkInCode = await ensureCheckInCode(prisma, config.checkInKind, reservation.id).catch((error) => {
      console.error("[sendReservationConfirmation] check-in code generation failed:", error);
      return null;
    });
    const ticketQr = checkInCode
      ? await qrPngAttachment(checkInCode, `${config.filePrefix}-${checkInCode}.png`).catch((error) => {
          console.error("[sendReservationConfirmation] ticket QR generation failed:", error);
          return null;
        })
      : null;

    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { phone: true, email: true } });
    const totalAmount = Number(reservation.totalPrice);
    const balanceDue = Number(reservation.balanceDue);

    await sendEmail({
      to: reservation.customer.email,
      ...config.build({
        customerName: reservation.customer.fullName,
        title: parent?.title ?? "",
        sessionDate: formatSessionDate(reservation.session?.startDate),
        seatsCount: reservation.seatsCount,
        paidAmount: totalAmount - balanceDue,
        totalAmount,
        balanceDue,
        isFullPayment: balanceDue <= 0.01,
        salonPhone: salon?.phone,
        salonEmail: salon?.email,
        pendingInvoiceNote: invoiceNote,
        checkInCode,
      }),
      ...(ticketQr ? { attachments: [ticketQr] } : {}),
    });
    return { sent: true };
  } catch (error) {
    console.error("[sendReservationConfirmation]", error);
    return { sent: false };
  }
}
