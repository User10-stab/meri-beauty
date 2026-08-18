"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  isAwaitingPayment,
  isAwaitingPaymentChoice,
} from "@/lib/appointments/payment-followup";

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

    const data = appointments.map((appt) => {
      const payment = appt.payment ?? null;

      return {
        // Appointment
        id:          appt.id,
        date:        appt.date,
        startTime:   appt.startTime,
        endTime:     appt.endTime,
        status:      appt.status,       // PENDING | ACCEPTED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
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

        // Derived convenience flags used by the UI to offer "Complete
        // payment" / "Choose how to pay". Shared with /appointments via
        // lib/appointments/payment-followup so both lists agree.
        awaitingPayment: isAwaitingPayment(appt, payment),
        awaitingPaymentChoice: isAwaitingPaymentChoice(appt, payment),

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
    });

    return { success: true, data };
  } catch (error) {
    console.error("[getMyReservations]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération de vos réservations.",
    };
  }
}
