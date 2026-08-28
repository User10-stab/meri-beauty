"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isAwaitingPayment,
  isAwaitingPaymentChoice,
} from "@/lib/appointments/payment-followup";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";
import { checkInQrDataUrl } from "@/lib/qrcode";

/**
 * Mints the appointment's check-in code on first read, same lazy pattern as
 * getMyOrderHistory's attachCheckInQr for ateliers/formations — minting at
 * payment-confirmation time would put a unique-index collision on the same
 * rollback path as a captured Stripe charge, and nothing needs the code
 * before the customer opens this page.
 */
async function attachCheckInQr(appt) {
  if (appt.status !== "CONFIRMED") return { checkInCode: null, checkInQr: null };

  try {
    const code = appt.checkInCode ?? (await ensureCheckInCode(prisma, CHECK_IN_KINDS.APPOINTMENT, appt.id));
    if (!code) return { checkInCode: null, checkInQr: null };
    return { checkInCode: code, checkInQr: await checkInQrDataUrl(code) };
  } catch (error) {
    // The rest of the reservation card is worth more than the QR — degrade
    // to no ticket rather than failing the whole page.
    console.error("[getMyReservations] check-in QR generation failed:", error);
    return { checkInCode: null, checkInQr: null };
  }
}

/**
 * Returns all reservations for the authenticated customer, including
 * their payment and transaction records.
 *
 * Used by /mes-reservations to display the customer's booking history
 * and surface any pending payments with a "Complete payment" button.
 *
 * Read-only — never modifies the database.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   data?: ReservationItem[],
 *   message?: string
 * }>}
 */
export async function getMyReservations() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    const appointments = await prisma.appointment.findMany({
      where: {
        userId:    session.user.id,
        isDeleted: false,
      },
      orderBy: { date: "desc" },
      include: {
        staffService: {
          include: {
            service: {
              select: { id: true, name: true },
            },
            staff: {
              select: {
                id:   true,
                user: { select: { fullName: true, avatar: true } },
              },
            },
          },
        },
        payment: {
          include: {
            invoice: {
              select: {
                id:     true,
                number: true,
              },
            },
            transactions: {
              where:   { isDeleted: false },
              orderBy: { paidAt: "asc" },
              select: {
                id:                     true,
                amount:                 true,
                method:                 true,
                transactionType:        true,
                paidAt:                 true,
                stripeCheckoutSessionId: true,
              },
            },
          },
        },
        review: {
          select: {
            id:      true,
            rating:  true,
            comment: true,
          },
        },
        cancellationRequests: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            reason: true,
            decisionNote: true,
            createdAt: true,
            reviewedAt: true,
          },
        },
      },
    });

    const data = await Promise.all(appointments.map(async (appt) => {
      const payment = appt.payment ?? null;
      const ticket = await attachCheckInQr(appt);

      return {
        // Appointment
        id:          appt.id,
        date:        appt.date,
        startTime:   appt.startTime,
        endTime:     appt.endTime,
        status:      appt.status,       // PENDING | ACCEPTED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
        checkInCode: ticket.checkInCode,
        checkInQr:   ticket.checkInQr,
        checkedInAt: appt.checkedInAt,
        notes:       appt.notes,

        // Service & staff
        service: {
          id:   appt.staffService.service.id,
          name: appt.staffService.service.name,
        },
        staff: {
          id:       appt.staffService.staff.id,
          fullName: appt.staffService.staff.user?.fullName ?? "—",
          avatar:   appt.staffService.staff.user?.avatar  ?? null,
        },
        staffServiceId: appt.staffServiceId,
        price:          Number(appt.staffService.price),
        duration:       appt.staffService.duration,

        // Payment — null when no payment record exists (e.g. cash/no-deposit)
        payment: payment
          ? {
              id:                  payment.id,
              status:              payment.status,       // PENDING | PAID | PARTIALLY_PAID | REFUNDED
              paymentType:         payment.paymentType,  // ON_SITE | ONLINE | DEPOSIT
              totalAmount:         Number(payment.totalAmount),
              depositAmount:       Number(payment.depositAmount),
              paidAmount:          Number(payment.paidAmount),
              remainingAmount:     Number(payment.remainingAmount),
              paidAt:              payment.paidAt,
              transactionReference: payment.transactionReference,
              invoice:             payment.invoice
                ? { id: payment.invoice.id, number: payment.invoice.number }
                : null,
              transactions:        payment.transactions.map((t) => ({
                id:                      t.id,
                amount:                  Number(t.amount),
                method:                  t.method,
                transactionType:         t.transactionType,
                paidAt:                  t.paidAt,
                stripeCheckoutSessionId: t.stripeCheckoutSessionId,
              })),
            }
          : null,

        // Review
        review: appt.review
          ? {
              id:      appt.review.id,
              rating:  appt.review.rating,
              comment: appt.review.comment,
            }
          : null,

        // Derived convenience flags used by the UI.
        // awaitingPayment: an online payment was started but never settled —
        // show "Complete payment" to resume the Checkout Session.
        // awaitingPaymentChoice: staff accepted a manual request and the
        // customer hasn't chosen how to pay yet (no Payment row exists) —
        // show a link to the confirmation/payment page. Both rules live in
        // lib/appointments/payment-followup.js.
        awaitingPayment: isAwaitingPayment(appt, payment),
        awaitingPaymentChoice: isAwaitingPaymentChoice(appt, payment),

        review: appt.review,

        cancellationRequest: appt.cancellationRequests[0]
          ? {
              id:           appt.cancellationRequests[0].id,
              status:       appt.cancellationRequests[0].status,
              reason:       appt.cancellationRequests[0].reason,
              decisionNote: appt.cancellationRequests[0].decisionNote,
              createdAt:    appt.cancellationRequests[0].createdAt,
              reviewedAt:   appt.cancellationRequests[0].reviewedAt,
            }
          : null,
      };
    }));

    return { success: true, data };
  } catch (error) {
    console.error("[getMyReservations]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération de vos réservations.",
    };
  }
}
