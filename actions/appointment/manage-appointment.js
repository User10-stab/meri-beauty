"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { ROLES, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { reservationConfirmedWithPaymentLinkEmail } from "@/lib/email-templates";
import { issueCreditNote } from "@/lib/invoicing";

/**
 * Verify the authenticated user can manage the given appointment.
 * STAFF can only manage their own appointments.
 * @param {string} appointmentId
 * @returns {{ authorized: boolean, message?: string, staffServiceId?: string }}
 */
async function authorizeAppointmentAction(appointmentId) {
  const session = await auth();

  if (!session?.user) {
    return { authorized: false, message: "Authentification requise" };
  }

  const userRole = session.user.role;

  // ADMIN/OWNER can manage any appointment
  if (isAdminRole(userRole)) {
    return { authorized: true };
  }

  // STAFF can only manage appointments linked to them
  if (userRole === ROLES.STAFF) {
    const staffId = await getCurrentStaffId();

    if (!staffId) {
      return { authorized: false, message: "Profil staff introuvable" };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      select: {
        staffService: {
          select: { staffId: true },
        },
      },
    });

    if (!appointment) {
      return { authorized: false, message: "Rendez-vous introuvable" };
    }

    if (appointment.staffService.staffId !== staffId) {
      return { authorized: false, message: "Vous n'êtes pas autorisé à gérer ce rendez-vous" };
    }

    return { authorized: true };
  }

  return { authorized: false, message: "Permissions insuffisantes" };
}

/**
 * Confirms an appointment and sends a payment link email to the customer.
 * Called by the salon owner/staff from the dashboard.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function confirmAppointment(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    // Load appointment with related data
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        staffService: {
          include: {
            service: true,
            staff: {
              include: {
                user: {
                  select: { fullName: true },
                },
              },
            },
          },
        },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    if (appointment.status !== "PENDING") {
      return {
        success: false,
        message: "Ce rendez-vous n'est pas en attente de confirmation",
      };
    }

    // Update appointment status (no payment record created yet)
    // Payment will be created by Stripe webhook after customer pays
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "CONFIRMED" },
    });

    // Create notification
    await prisma.notification.create({
      data: {
        userId: appointment.user.id,
        appointmentId: appointment.id,
        type: "APPOINTMENT_CONFIRMED",
        title: "Réservation confirmée",
        message: `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été confirmé`,
        status: "PENDING",
      },
    });

    // Generate payment URL
    const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/appointment/${appointmentId}/payment`;

    // Send confirmation email with payment link
    const totalAmount = Number(appointment.staffService.price);
    
    sendEmail({
      to: appointment.user.email,
      ...reservationConfirmedWithPaymentLinkEmail({
        customerName: appointment.user.fullName,
        serviceName: appointment.staffService.service.name,
        staffName: appointment.staffService.staff?.user?.fullName || "Expert",
        date: appointment.date,
        time: appointment.startTime.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        totalAmount,
        paymentUrl,
      }),
    }).catch((err) =>
      console.error("[confirmAppointment] email failed:", err)
    );

    return {
      success: true,
      message: "Rendez-vous confirmé et email envoyé au client",
    };
  } catch (error) {
    console.error("[confirmAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de la confirmation du rendez-vous",
    };
  }
}

/**
 * Rejects/cancels an appointment.
 * Called by the salon owner/staff from the dashboard.
 *
 * @param {string} appointmentId
 * @param {string} reason - Optional reason for rejection
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
export async function rejectAppointment(appointmentId, reason = null) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    // Load appointment
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        payment: { include: { invoice: true } },
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    if (appointment.status === "CANCELLED") {
      return {
        success: false,
        message: "Ce rendez-vous est déjà annulé",
      };
    }

    const payment = appointment.payment;
    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

    await prisma.$transaction(async (tx) => {
      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "CANCELLED" },
      });

      if (wasPaid) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
        await tx.transaction.create({
          data: {
            paymentId: payment.id,
            amount: payment.paidAmount,
            method: "ONLINE",
            transactionType: "REFUND",
            paidAt: new Date(),
          },
        });

        if (payment.invoice) {
          await issueCreditNote(tx, {
            invoiceId: payment.invoice.id,
            reason: reason ?? "Rendez-vous annulé",
            totalInclVat: Number(payment.paidAmount),
          });
        }
      }

      await tx.notification.create({
        data: {
          userId: appointment.user.id,
          appointmentId: appointment.id,
          type: "APPOINTMENT_CANCELLED",
          title: "Réservation annulée",
          message: reason
            ? `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé. Raison: ${reason}`
            : `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé`,
          status: "PENDING",
        },
      });
    });

    // The DB side (status, payment, credit note) is already committed — a
    // failed Stripe call here must not roll any of that back, just get
    // logged loudly so it can be retried/handled manually.
    if (wasPaid && payment.transactionReference) {
      try {
        const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
        if (stripeSession.payment_intent) {
          await stripe.refunds.create({ payment_intent: stripeSession.payment_intent });
        }
      } catch (err) {
        console.error("[rejectAppointment] REFUND FAILED for appointment", appointmentId, err);
      }
    }

    sendEmail({
      to: appointment.user.email,
      subject: "Rendez-vous annulé – Meri Beauty",
      text:
        `Bonjour ${appointment.user.fullName},\n\n` +
        `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé.` +
        (wasPaid ? " Le remboursement apparaîtra sur votre compte sous quelques jours." : "") +
        (reason ? ` Raison : ${reason}` : "") +
        `\n\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${appointment.user.fullName},</p>` +
        `<p>Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé.` +
        (wasPaid ? " Le remboursement apparaîtra sur votre compte sous quelques jours." : "") +
        (reason ? ` Raison : ${reason}` : "") +
        `</p><p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[rejectAppointment] cancellation email failed:", err));

    return {
      success: true,
      message: wasPaid ? "Rendez-vous annulé — le client sera remboursé." : "Rendez-vous annulé",
    };
  } catch (error) {
    console.error("[rejectAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de l'annulation du rendez-vous",
    };
  }
}

/**
 * Gets an appointment by ID with all related data.
 * Used by the payment page.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, appointment?: any, message?: string }>}
 */
export async function getAppointmentById(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        staffService: {
          include: {
            service: true,
            staff: {
              include: {
                user: {
                  select: { fullName: true },
                },
              },
            },
          },
        },
        payment: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }

    return {
      success: true,
      appointment,
    };
  } catch (error) {
    console.error("[getAppointmentById]", error);
    return {
      success: false,
      message: "Erreur lors de la récupération du rendez-vous",
    };
  }
}
