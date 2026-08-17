"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

        // Derived convenience flag used by the UI to show "Complete payment"
        // True only when:
        //   - there is a payment record
        //   - the payment is PENDING (not yet paid)
        //   - the appointment has not been cancelled or completed
        //   - the payment requires an online payment (ONLINE or DEPOSIT type)
        awaitingPayment:
          payment !== null &&
          payment.status === "PENDING" &&
          (payment.paymentType === "ONLINE" || payment.paymentType === "DEPOSIT") &&
          appt.status !== "CANCELLED" &&
          appt.status !== "COMPLETED",

        // Manual requests do not have a Payment row until the customer makes
        // a choice after staff acceptance. Keep the route discoverable even
        // if the acceptance email is missed.
        awaitingPaymentChoice: appt.status === "ACCEPTED" && payment === null,

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
