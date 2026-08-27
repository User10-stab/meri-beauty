import "server-only";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { sendEmail } from "@/lib/email";
import { reservationConfirmedEmail } from "@/lib/email-templates";
import { buildAppointmentCheckInEmailAssets } from "@/lib/activities/appointment-check-in-qr";
import { captureError } from "@/lib/monitoring";
import {
  createNotificationsBulk,
  buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";

const PAYMENT_CHOICES = new Set(["FULL_ONLINE", "DEPOSIT_ONLINE", "ON_SITE"]);

function availableChoices(staff) {
  if (staff.allowedPaymentMethods === "CASH_ONLY") return ["ON_SITE"];
  if (staff.allowedPaymentMethods === "ONLINE_ONLY") return ["FULL_ONLINE"];
  const rawDepositPercentage = Number(staff.depositPercentage ?? 0);
  const depositPercentage = Number.isFinite(rawDepositPercentage) ? Math.min(100, Math.max(0, rawDepositPercentage)) : 0;
  if (staff.depositEnabled && depositPercentage > 0) {
    return ["FULL_ONLINE", "DEPOSIT_ONLINE"];
  }
  return ["FULL_ONLINE", "ON_SITE"];
}

function appointmentInclude() {
  return {
    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
      },
    },
    staffService: {
      include: {
        service: { select: { name: true } },
        staff: {
          select: {
            id: true,
            allowedPaymentMethods: true,
            depositEnabled: true,
            depositPercentage: true,
            stripeAccountId: true,
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
            user: { select: { fullName: true } },
          },
        },
      },
    },
    payment: true,
  };
}

async function ownedAppointment(appointmentId) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "AUTH_REQUIRED" };
  }

  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      userId: session.user.id,
      isDeleted: false,
    },
    include: appointmentInclude(),
  });

  if (!appointment) return { error: "NOT_FOUND" };
  return { appointment, userId: session.user.id };
}

export async function getAcceptedPaymentDetails(appointmentId) {
  if (typeof appointmentId !== "string" || !appointmentId) {
    return { success: false, code: "NOT_FOUND", message: "Rendez-vous introuvable." };
  }

  const result = await ownedAppointment(appointmentId);
  if (result.error === "AUTH_REQUIRED") {
    return { success: false, code: "AUTH_REQUIRED", message: "Connectez-vous pour finaliser ce rendez-vous." };
  }
  if (result.error || !result.appointment) {
    return { success: false, code: "NOT_FOUND", message: "Rendez-vous introuvable." };
  }

  const appointment = result.appointment;
  const staff = appointment.staffService.staff;
  const totalAmount = Number(appointment.staffService.price);
  const rawDepositPercentage = Number(staff.depositPercentage ?? 0);
  const depositPercentage = Number.isFinite(rawDepositPercentage) ? Math.min(100, Math.max(0, rawDepositPercentage)) : 0;
  const depositAmount = staff.depositEnabled
    ? Number(((totalAmount * depositPercentage) / 100).toFixed(2))
    : 0;
  const selectedChoices = appointment.payment
    ? [appointment.payment.paymentType === "ONLINE"
        ? "FULL_ONLINE"
        : appointment.payment.paymentType === "DEPOSIT"
          ? "DEPOSIT_ONLINE"
          : "ON_SITE"]
    : availableChoices(staff);

  return {
    success: true,
    data: {
      id: appointment.id,
      status: appointment.status,
      customerName: appointment.user.fullName,
      serviceName: appointment.staffService.service.name,
      staffName: staff.user?.fullName ?? "Expert",
      date: appointment.date.toISOString(),
      startTime: appointment.startTime.toISOString(),
      totalAmount,
      depositPercentage,
      depositAmount,
      choices: selectedChoices,
      payment: appointment.payment
        ? {
            id: appointment.payment.id,
            status: appointment.payment.status,
            paymentType: appointment.payment.paymentType,
          }
        : null,
    },
  };
}

export async function chooseAcceptedPayment(appointmentId, choice) {
  if (typeof appointmentId !== "string" || !appointmentId || !PAYMENT_CHOICES.has(choice)) {
    return { success: false, message: "Option de paiement invalide." };
  }

  const owned = await ownedAppointment(appointmentId);
  if (owned.error === "AUTH_REQUIRED") {
    return { success: false, message: "Authentification requise." };
  }
  if (owned.error || !owned.appointment) {
    return { success: false, message: "Rendez-vous introuvable." };
  }

  const appointment = owned.appointment;
  const staff = appointment.staffService.staff;
  if (!availableChoices(staff).includes(choice)) {
    return { success: false, message: "Cette option de paiement n'est plus disponible." };
  }

  if (appointment.status === "CONFIRMED" && appointment.payment) {
    return { success: true, confirmed: true, message: "Ce rendez-vous est déjà confirmé." };
  }
  if (appointment.status !== "ACCEPTED") {
    return { success: false, message: "Ce rendez-vous n'est pas en attente de votre choix de paiement." };
  }

  const totalAmount = Number(appointment.staffService.price);
  const rawDepositPercentage = Number(staff.depositPercentage ?? 0);
  const depositPercentage = Number.isFinite(rawDepositPercentage) ? Math.min(100, Math.max(0, rawDepositPercentage)) : 0;
  const depositAmount = choice === "DEPOSIT_ONLINE"
    ? Number(((totalAmount * depositPercentage) / 100).toFixed(2))
    : 0;
  const paymentType = choice === "FULL_ONLINE" ? "ONLINE" : choice === "DEPOSIT_ONLINE" ? "DEPOSIT" : "ON_SITE";

  if (choice !== "ON_SITE") {
    if (!staff.stripeAccountId || !staff.stripeChargesEnabled || !staff.stripePayoutsEnabled) {
      return { success: false, message: "Le paiement en ligne n'est pas encore disponible pour cette experte." };
    }
    if (!(await isSellerLegalDataComplete())) {
      return { success: false, message: "Le paiement en ligne est temporairement indisponible. Contactez le salon." };
    }
  }

  let payment;
  let confirmedOnSite = false;
  try {
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${appointmentId} FOR UPDATE`;

      const current = await tx.appointment.findUnique({
        where: { id: appointmentId },
        include: { payment: true },
      });
      if (!current || current.userId !== owned.userId || current.status !== "ACCEPTED") {
        return { error: "STATE_CHANGED", payment: current?.payment ?? null };
      }

      let currentPayment = current.payment;
      if (currentPayment && currentPayment.paymentType !== paymentType) {
        return { error: "PAYMENT_ALREADY_SELECTED", payment: currentPayment };
      }
      if (!currentPayment) {
        currentPayment = await tx.payment.create({
          data: {
            appointmentId,
            depositAmount,
            totalAmount,
            paidAmount: 0,
            remainingAmount: totalAmount,
            paymentType,
            status: "PENDING",
          },
        });
      }

      if (choice === "ON_SITE") {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: "CONFIRMED" },
        });

        const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId, { tx });
        if (recipientUserIds.length > 0) {
          await createNotificationsBulk(
            recipientUserIds.map((userId) => buildAppointmentConfirmedNotification({
              userId,
              appointmentId,
              date: appointment.date,
              startTime: appointment.startTime,
              serviceName: appointment.staffService.service.name,
              staffName: staff.user?.fullName,
              customerName: appointment.user.fullName,
            })),
            { tx }
          );
        }
      }

      return { payment: currentPayment, confirmedOnSite: choice === "ON_SITE" };
    });

    if (claimed.error === "PAYMENT_ALREADY_SELECTED") {
      return { success: false, message: "Une autre option de paiement a déjà été sélectionnée." };
    }
    if (claimed.error === "STATE_CHANGED") {
      return { success: false, message: "L'état du rendez-vous a changé. Actualisez la page." };
    }
    payment = claimed.payment;
    confirmedOnSite = claimed.confirmedOnSite;
  } catch (error) {
    captureError(error, { area: "appointment-payment-choice", appointmentId, choice });
    return { success: false, message: "Impossible d'enregistrer votre choix de paiement." };
  }

  if (confirmedOnSite) {
    const ticket = await buildAppointmentCheckInEmailAssets(appointmentId);
    sendEmail({
      to: appointment.user.email,
      ...reservationConfirmedEmail({
        customerName: appointment.user.fullName,
        serviceName: appointment.staffService.service.name,
        staffName: staff.user?.fullName ?? "Expert",
        date: appointment.date,
        time: appointment.startTime.toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Brussels",
        }),
        totalAmount,
        checkInCode: ticket.checkInCode,
      }),
      ...(ticket.attachment ? { attachments: [ticket.attachment] } : {}),
    }).catch((error) => captureError(error, { area: "email", template: "reservation-confirmed", appointmentId }));

    return { success: true, confirmed: true, message: "Rendez-vous confirmé. Paiement prévu au salon." };
  }

  try {
    const amountToPay = choice === "FULL_ONLINE" ? totalAmount : depositAmount;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meribeauty.com";
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        line_items: [{
          price_data: {
            currency: "eur",
            product_data: {
              name: choice === "FULL_ONLINE"
                ? appointment.staffService.service.name
                : `Acompte - ${appointment.staffService.service.name}`,
              description: `${staff.user?.fullName ?? "Expert"} • ${appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`,
            },
            unit_amount: Math.round(amountToPay * 100),
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${appUrl}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/appointment/${appointmentId}/payment?canceled=true`,
        customer_email: appointment.user.email,
        metadata: {
          appointmentId,
          paymentId: payment.id,
          paymentScenario: choice,
          customerUserId: owned.userId,
          staffServiceId: appointment.staffServiceId,
        },
      },
      { stripeAccount: staff.stripeAccountId }
    );

    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: checkoutSession.id },
    });

    return { success: true, url: checkoutSession.url };
  } catch (error) {
    captureError(error, { area: "stripe-checkout", appointmentId, paymentId: payment.id, choice });
    return {
      success: false,
      message: "La session Stripe n'a pas pu être créée. Votre rendez-vous reste accepté et vous pouvez réessayer.",
    };
  }
}
