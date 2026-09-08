"use server";

import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { manualDepositRequiredEmail } from "@/lib/email-templates";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { hasDashboardPermission, STAFF_PERMISSIONS } from "@/lib/authorization";

/**
 * Resends the payment email for a pending appointment.
 *
 * Creates a fresh Stripe Checkout Session (old ones expire) and sends
 * the payment link to the client via email.
 *
 * @param {string} appointmentId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function resendPaymentEmail(appointmentId) {
  try {
    const session = await auth();
    if (!session?.user || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.APPOINTMENTS))) {
      return { success: false, message: "Non autorisé." };
    }

    if (!appointmentId) {
      return { success: false, message: "Identifiant manquant." };
    }

    // ── Load payment with all related data ──────────────────────────────────
    const payment = await prisma.payment.findFirst({
      where: { appointmentId, isDeleted: false },
      include: {
        appointment: {
          include: {
            staffService: {
              include: {
                service: { select: { name: true } },
                staff: {
                  select: {
                    stripeAccountId: true,
                    stripeChargesEnabled: true,
                    stripePayoutsEnabled: true,
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
            user: { select: { id: true, email: true, fullName: true } },
          },
        },
      },
    });

    if (!payment) {
      return { success: false, message: "Aucun paiement associé à ce rendez-vous." };
    }

    // ── Verify the payment is still pending ─────────────────────────────────
    if (!["PENDING", "FAILED"].includes(payment.status)) {
      return { success: false, message: "Ce paiement n'est plus en attente." };
    }

    // ── Verify the appointment is still payable ─────────────────────────────
    const appointmentStatus = payment.appointment.status;
    if (appointmentStatus === "CANCELLED" || appointmentStatus === "COMPLETED") {
      return { success: false, message: "Ce rendez-vous ne peut plus être payé." };
    }

    // ── Verify Stripe Connect account ───────────────────────────────────────
    const staff = payment.appointment.staffService.staff;
    if (!staff?.stripeAccountId || !staff.stripeChargesEnabled || !staff.stripePayoutsEnabled) {
      return { success: false, message: "Le compte Stripe du professionnel n'est pas prêt." };
    }

    if (!(await isSellerLegalDataComplete())) {
      return { success: false, message: "Le paiement en ligne n'est pas disponible pour le moment." };
    }

    // ── Determine amount ────────────────────────────────────────────────────
    const totalAmount = Number(payment.totalAmount);
    const depositAmount = Number(payment.depositAmount);
    const amountToPay = payment.paymentType === "ONLINE" ? totalAmount : depositAmount;

    if (amountToPay <= 0) {
      return { success: false, message: "Le montant à payer est invalide." };
    }

    const paymentScenario = payment.paymentType === "ONLINE" ? "FULL_ONLINE" : "DEPOSIT_ONLINE";

    // ── Create a fresh Stripe Checkout Session ──────────────────────────────
    const appointmentDate = new Date(payment.appointment.date)
      .toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" });
    const appointmentTime = new Date(payment.appointment.startTime)
      .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
    const staffName = staff.user?.fullName ?? "Expert";
    const serviceName = payment.appointment.staffService.service.name;

    const checkoutSession = await stripe.checkout.sessions.create(
      {
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: payment.paymentType === "ONLINE" ? serviceName : `Acompte - ${serviceName}`,
                description: `${staffName} • ${appointmentDate} • ${appointmentTime}`,
              },
              unit_amount: Math.round(amountToPay * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/mes-reservations`,
        customer_email: payment.appointment.user.email,
        payment_intent_data: {
          metadata: {
            appointmentId: payment.appointment.id,
            paymentId: payment.id,
            paymentScenario,
          },
        },
        metadata: {
          appointmentId: payment.appointment.id,
          paymentId: payment.id,
          paymentScenario,
        },
      },
      { stripeAccount: staff.stripeAccountId }
    );

    // ── Update payment reference ────────────────────────────────────────────
    await prisma.payment.update({
      where: { id: payment.id },
      data: { transactionReference: checkoutSession.id },
    });

    // ── Send payment email ──────────────────────────────────────────────────
    await sendEmail({
      to: payment.appointment.user.email,
      ...manualDepositRequiredEmail({
        customerName: payment.appointment.user.fullName,
        serviceName,
        staffName,
        date: payment.appointment.date,
        time: appointmentTime,
        depositAmount: amountToPay,
        totalAmount,
        paymentUrl: checkoutSession.url,
      }),
    });

    return { success: true, message: "Email de paiement renvoyé avec succès." };
  } catch (error) {
    console.error("[resendPaymentEmail]", error);
    return { success: false, message: "Erreur lors de l'envoi. Veuillez réessayer." };
  }
}
