"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { ROLES, isAdminRole } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { sendEmail } from "@/lib/email";
import { reservationConfirmedWithPaymentLinkEmail } from "@/lib/email-templates";
import { issueCreditNote, issueInvoice } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";

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

    const payment = appointment.payment;
    const wasPaid = Boolean(payment) && ["PAID", "PARTIALLY_PAID"].includes(payment.status);

    // Cancelling an unpaid request is routine appointment management (STAFF
    // may do it for their own appointments, per authorizeAppointmentAction
    // above) — but cancelling a paid one triggers a real Stripe refund, which
    // per policy only OWNER/ADMIN may issue.
    if (wasPaid) {
      const session = await auth();
      if (!isAdminRole(session?.user?.role)) {
        return {
          success: false,
          message: "Seul un administrateur peut annuler un rendez-vous déjà payé (remboursement requis). Contactez un administrateur.",
        };
      }
    }

    const claimed = await prisma.$transaction(async (tx) => {
      // Atomic claim, gated on the appointment not already being cancelled —
      // without this, two concurrent rejects (double-click, or staff and a
      // webhook racing) both pass a plain read-then-check and both refund.
      const claim = await tx.appointment.updateMany({
        where: { id: appointmentId, status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] } },
        data: { status: "CANCELLED" },
      });
      if (claim.count === 0) return false;

      if (wasPaid && payment.invoice) {
        await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: reason ?? "Rendez-vous annulé",
          totalInclVat: Number(payment.paidAmount),
        });
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

      return true;
    });

    if (!claimed) {
      return { success: true, message: "Ce rendez-vous est déjà annulé." };
    }

    // Payment.status / the REFUND ledger row are only written once Stripe
    // actually confirms the refund — writing them unconditionally beforehand
    // would tell the customer "refunded" even if the Stripe call below fails.
    let refundFailed = false;
    if (wasPaid && payment.transactionReference) {
      const alreadyRefunded = await prisma.transaction.findFirst({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        select: { id: true },
      });

      if (!alreadyRefunded) {
        try {
          const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
          if (stripeSession.payment_intent) {
            await stripe.refunds.create({ payment_intent: stripeSession.payment_intent });
            await prisma.$transaction([
              prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } }),
              prisma.transaction.create({
                data: {
                  paymentId: payment.id,
                  amount: payment.paidAmount,
                  method: "ONLINE",
                  transactionType: "REFUND",
                  paidAt: new Date(),
                },
              }),
            ]);
          }
        } catch (err) {
          // The appointment cancellation and credit note are already
          // committed and stay — surface the refund failure loudly so it can
          // be retried/handled manually, rather than silently swallowing it.
          console.error("[rejectAppointment] REFUND FAILED for appointment", appointmentId, err);
          refundFailed = true;
        }
      }
    }

    const refundNote = wasPaid
      ? refundFailed
        ? " Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
        : " Le remboursement apparaîtra sur votre compte sous quelques jours."
      : "";

    sendEmail({
      to: appointment.user.email,
      subject: "Rendez-vous annulé – Meri Beauty",
      text:
        `Bonjour ${appointment.user.fullName},\n\n` +
        `Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé.${refundNote}` +
        (reason ? ` Raison : ${reason}` : "") +
        `\n\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${appointment.user.fullName},</p>` +
        `<p>Votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a été annulé.${refundNote}` +
        (reason ? ` Raison : ${reason}` : "") +
        `</p><p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[rejectAppointment] cancellation email failed:", err));

    if (refundFailed) {
      const salon = await prisma.salon.findFirst({ select: { email: true } });
      if (salon?.email) {
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement Stripe échoué – Rendez-vous ${appointment.user.fullName}`,
          text: `Le remboursement Stripe pour le rendez-vous de ${appointment.user.fullName} (${appointment.user.email}) du ${appointment.date.toLocaleDateString("fr-FR")} a échoué. Traitement manuel requis dans le dashboard Stripe.`,
          html: `<p>Le remboursement Stripe pour le rendez-vous de ${appointment.user.fullName} (${appointment.user.email}) du ${appointment.date.toLocaleDateString("fr-FR")} a échoué. Traitement manuel requis dans le dashboard Stripe.</p>`,
        }).catch((err) => console.error("[rejectAppointment] refund-failure alert email failed:", err));
      }
    }

    return {
      success: true,
      message: wasPaid
        ? refundFailed
          ? "Rendez-vous annulé. Le remboursement n'a pas pu être traité automatiquement — notre équipe s'en occupe."
          : "Rendez-vous annulé — le client sera remboursé."
        : "Rendez-vous annulé",
      refundFailed,
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
 * Marks a CONFIRMED appointment as COMPLETED. For a deposit booking
 * (Payment.status === "PARTIALLY_PAID"), this is also where the on-site
 * balance gets collected and invoiced — previously there was no mechanism
 * at all to record that money or issue the legally-required invoice for
 * it, since the checkout webhook only invoices fully-paid-online bookings.
 *
 * @param {string} appointmentId
 * @param {{ method?: "CASH" | "CARD" }} [options] - method is required only
 *   when a balance is actually due.
 */
export async function completeAppointment(appointmentId, { method } = {}) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const authCheck = await authorizeAppointmentAction(appointmentId);
    if (!authCheck.authorized) {
      return { success: false, message: authCheck.message };
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: { select: { fullName: true, email: true, vatNumber: true } },
        staffService: { include: { service: true } },
        payment: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable" };
    }
    if (appointment.status !== "CONFIRMED") {
      return { success: false, message: "Seul un rendez-vous confirmé peut être marqué comme terminé." };
    }

    const payment = appointment.payment;
    const hasBalanceDue = Boolean(payment) && payment.status === "PARTIALLY_PAID" && Number(payment.remainingAmount) > 0;

    if (hasBalanceDue && !["CASH", "CARD"].includes(method)) {
      return { success: false, message: "Mode de paiement requis pour encaisser le solde restant." };
    }

    const { invoice, balance } = await prisma.$transaction(async (tx) => {
      let invoice = null;
      let balance = 0;

      if (hasBalanceDue) {
        balance = Number(payment.remainingAmount);

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            paidAmount: payment.totalAmount,
            remainingAmount: 0,
            status: "PAID",
          },
        });

        await tx.transaction.create({
          data: {
            paymentId: updatedPayment.id,
            amount: balance,
            method,
            transactionType: "FINAL_PAYMENT",
            paidAt: new Date(),
          },
        });

        invoice = await issueInvoice(tx, {
          paymentId: updatedPayment.id,
          source: "APPOINTMENT",
          totalInclVat: Number(updatedPayment.totalAmount),
          customer: {
            fullName: appointment.user.fullName,
            email: appointment.user.email,
            vatNumber: appointment.user.vatNumber,
          },
          lines: [
            {
              description: appointment.staffService.service?.name ?? "Prestation",
              quantity: 1,
              unitPrice: Number(updatedPayment.totalAmount),
            },
          ],
        });
      }

      await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: "COMPLETED" },
      });

      return { invoice, balance };
    });

    if (invoice) {
      const invoicePdf = await renderInvoicePdf(invoice).catch((err) => {
        console.error("[completeAppointment] invoice PDF render failed:", err);
        return null;
      });

      sendEmail({
        to: appointment.user.email,
        subject: "Facture — solde réglé – Meri Beauty",
        text:
          `Bonjour ${appointment.user.fullName},\n\n` +
          `Le solde de €${balance.toFixed(2)} pour votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a bien été encaissé. ` +
          `Vous trouverez votre facture en pièce jointe.\n\nL'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${appointment.user.fullName},</p>` +
          `<p>Le solde de €${balance.toFixed(2)} pour votre rendez-vous du ${appointment.date.toLocaleDateString("fr-FR")} a bien été encaissé. ` +
          `Vous trouverez votre facture en pièce jointe.</p><p>L'équipe Meri Beauty</p>`,
        ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
      }).catch((err) => console.error("[completeAppointment] receipt email failed:", err));
    }

    return {
      success: true,
      message: hasBalanceDue ? "Rendez-vous terminé — solde encaissé et facturé." : "Rendez-vous marqué comme terminé.",
    };
  } catch (error) {
    console.error("[completeAppointment]", error);
    return { success: false, message: "Erreur lors de la finalisation du rendez-vous." };
  }
}

/**
 * Gets an appointment by ID with all related data.
 * Used by the payment page.
 *
 * Returns full customer PII (email, phone) and payment details, so this must
 * never be reachable by anyone but the appointment's own owner or a
 * dashboard role — appointment ids are cuids that show up in URLs and
 * emails, not secrets.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, appointment?: any, message?: string }>}
 */
export async function getAppointmentById(appointmentId) {
  try {
    if (!appointmentId) {
      return { success: false, message: "ID de rendez-vous manquant" };
    }

    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Authentification requise" };
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

    const isOwner = appointment.userId === session.user.id;
    if (!isOwner && !isAdminRole(session.user.role) && session.user.role !== ROLES.STAFF) {
      // Same message as "not found" — don't confirm an id belongs to someone else.
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
