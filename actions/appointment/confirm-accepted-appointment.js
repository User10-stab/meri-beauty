"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { verifyAppointmentConfirmToken } from "@/lib/appointment-confirm-token";
import { sendEmail } from "@/lib/email";
import { reservationConfirmedEmail, staffReservationConfirmedEmail } from "@/lib/email-templates";
import {
  buildAppointmentConfirmedNotification,
  createNotificationsBulk,
  getAppointmentEmailRecipients,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";

function getPaymentMethod(value) {
  if (value === "online" || value === "cash") return value;
  return null;
}

/**
 * Confirms an ACCEPTED appointment with the customer's chosen payment method.
 *
 * Authorization (either is sufficient):
 *   • the caller is signed in as the appointment's own owner, OR
 *   • the caller presents the dedicated appointment-confirmation token minted
 *     at acceptance time and delivered inside the acceptance email — this is
 *     what lets a guest confirm straight from the email link with no login.
 *     The token is stateless and cryptographically bound to this exact
 *     appointment (see lib/appointment-confirm-token.js), so it authorizes
 *     nothing else and grants no account access.
 *
 * @param {string} appointmentId
 * @param {"online"|"cash"} paymentMethod
 * @param {string|null} [confirmToken]
 */
export async function confirmAcceptedAppointment(appointmentId, paymentMethod, confirmToken = null) {
  try {
    const session = await auth();
    const normalizedMethod = getPaymentMethod(paymentMethod);
    if (!appointmentId || !normalizedMethod) return { success: false, message: "Choix de confirmation invalide." };

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId, isDeleted: false },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        staffService: {
          include: {
            service: { select: { name: true } },
            staff: {
              include: { user: { select: { fullName: true } } },
            },
          },
        },
        payment: true,
      },
    });

    if (!appointment) {
      return { success: false, message: "Rendez-vous introuvable." };
    }

    const isOwner = session?.user?.id != null && appointment.userId === session.user.id;
    const verifiedToken =
      confirmToken && verifyAppointmentConfirmToken(confirmToken, { appointmentId: appointment.id });
    const tokenAuthorized = verifiedToken?.ok && verifiedToken.email === appointment.user.email;

    if (!isOwner && !tokenAuthorized) {
      return { success: false, message: "Rendez-vous introuvable." };
    }
    if (appointment.status !== "ACCEPTED") {
      return { success: false, message: "Ce rendez-vous n'est plus en attente de confirmation." };
    }

    const staff = appointment.staffService.staff;
    const acceptsOnline = staff.allowedPaymentMethods === "BOTH" || staff.allowedPaymentMethods === "ONLINE_ONLY";
    const acceptsCash = staff.allowedPaymentMethods === "BOTH" || staff.allowedPaymentMethods === "CASH_ONLY";
    if (normalizedMethod === "online" && !acceptsOnline) return { success: false, message: "Le paiement en ligne n'est pas disponible." };
    if (normalizedMethod === "cash" && !acceptsCash) return { success: false, message: "Le paiement au salon n'est pas disponible." };

    const decision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: "AUTOMATIC",
      depositEnabled: acceptsOnline && Boolean(staff.depositEnabled),
      depositPercentage: acceptsOnline ? Number(staff.depositPercentage ?? 0) : 0,
      allowedPaymentMethods: staff.allowedPaymentMethods,
      totalAmount: Number(appointment.staffService.price),
      paymentMethod: normalizedMethod,
    });

    if (!decision.requiresOnlinePaymentNow) {
      const claimed = await prisma.appointment.updateMany({
        where: { id: appointment.id, status: "ACCEPTED" },
        data: { status: "CONFIRMED" },
      });
      if (claimed.count !== 1) return { success: false, message: "Ce rendez-vous n'est plus en attente de confirmation." };

      await sendConfirmationSideEffects(appointment);
      return { success: true, confirmed: true };
    }

    if (!(await isSellerLegalDataComplete())) {
      return { success: false, message: "Le paiement en ligne n'est pas disponible pour le moment." };
    }
    if (!staff.stripeAccountId || !staff.stripeChargesEnabled || !staff.stripePayoutsEnabled) {
      return { success: false, message: "Le compte Stripe du professionnel n'est pas prêt à recevoir des paiements." };
    }

    const paymentType = decision.paymentType;
    const existingPayment = appointment.payment;
    const payment = existingPayment ?? await prisma.payment.create({
      data: {
        appointmentId: appointment.id,
        depositAmount: decision.depositAmount,
        totalAmount: decision.totalAmount,
        paidAmount: 0,
        remainingAmount: decision.totalAmount,
        paymentType,
        status: "PENDING",
      },
    });

    if (payment.status !== "PENDING") return { success: false, message: "Ce paiement n'est plus en attente." };

    const amount = paymentType === "ONLINE" ? decision.totalAmount : decision.depositAmount;
    const staffName = staff.user?.fullName ?? "Expert";
    const serviceName = appointment.staffService.service.name;
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        line_items: [{
          price_data: {
            currency: "eur",
            product_data: { name: paymentType === "ONLINE" ? serviceName : `Acompte - ${serviceName}` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/mes-reservations`,
        customer_email: appointment.user.email,
        payment_intent_data: {
          metadata: {
            appointmentId: appointment.id,
            paymentId: payment.id,
            paymentScenario: paymentType === "ONLINE" ? "FULL_ONLINE" : "DEPOSIT_ONLINE",
          },
        },
        metadata: {
          appointmentId: appointment.id,
          paymentId: payment.id,
          paymentScenario: paymentType === "ONLINE" ? "FULL_ONLINE" : "DEPOSIT_ONLINE",
        },
      },
      { stripeAccount: staff.stripeAccountId }
    );

    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: checkoutSession.id },
    });

    return { success: true, url: checkoutSession.url, confirmed: false };
  } catch (error) {
    console.error("[confirmAcceptedAppointment]", error);
    return { success: false, message: "Impossible de confirmer ce rendez-vous pour le moment." };
  }
}

async function sendConfirmationSideEffects(appointment) {
  const staffName = appointment.staffService.staff?.user?.fullName ?? "Expert";
  const serviceName = appointment.staffService.service.name;
  const time = appointment.startTime.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });

  await sendEmail({
    to: appointment.user.email,
    ...reservationConfirmedEmail({
      customerName: appointment.user.fullName,
      serviceName,
      staffName,
      date: appointment.date,
      time,
      paidAmount: Number(appointment.payment?.paidAmount ?? 0),
      totalAmount: Number(appointment.payment?.totalAmount ?? 0),
      paymentMethod: appointment.payment?.paidAmount > 0 ? "Paiement en ligne" : null,
    }),
  }).catch((error) => console.error("[confirmAcceptedAppointment] email failed", error));

  const emailRecipients = await getAppointmentEmailRecipients(appointment.staffId);
  for (const recipient of emailRecipients) {
    await sendEmail({
      to: recipient.email,
      ...staffReservationConfirmedEmail({
        staffName: recipient.fullName,
        customerName: appointment.user.fullName,
        serviceName,
        date: appointment.date,
        time,
      }),
    }).catch((error) => console.error("[confirmAcceptedAppointment] staff email failed", error));
  }

  const recipients = await getAppointmentNotificationRecipients(appointment.staffId);
  if (recipients.length > 0) {
    await createNotificationsBulk(
      recipients.map((userId) => buildAppointmentConfirmedNotification({
        userId,
        appointmentId: appointment.id,
        date: appointment.date,
        startTime: appointment.startTime,
        serviceName,
        staffName,
        customerName: appointment.user.fullName,
      }))
    ).catch((error) => console.error("[confirmAcceptedAppointment] notification failed", error));
  }
}
