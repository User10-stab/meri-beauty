"use server";

import { auth } from "@/auth";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { isSellerLegalDataComplete } from "@/lib/invoicing";

/**
 * Creates a fresh Stripe Checkout Session for an existing pending payment.
 *
 * Called when a customer wants to complete a payment they previously
 * abandoned (browser refresh, closed tab, expired session, etc.).
 *
 * This action NEVER creates a new Appointment or Payment.
 * It only creates a new Stripe Checkout Session and updates
 * Payment.transactionReference with the new session ID.
 *
 * The Stripe webhook remains the sole authority for marking the payment
 * as PAID and the appointment as CONFIRMED.
 *
 * @param {string} paymentId - The ID of the existing pending Payment record
 * @returns {Promise<{ success: boolean, url?: string, message?: string }>}
 */
export async function resumeReservationPayment(paymentId) {
  try {
    // ── 1. Require authentication ────────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, message: "Authentification requise." };
    }

    if (!paymentId) {
      return { success: false, message: "Identifiant de paiement manquant." };
    }

    // ── 2. Load payment with all related data ────────────────────────────────
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId, isDeleted: false },
      include: {
        appointment: {
          include: {
            staffService: {
              include: {
                service: true,
                staff: {
                  select: {
                    stripeAccountId:            true,
                    stripeChargesEnabled:        true,
                    stripePayoutsEnabled:        true,
                    reservationConfirmationMode: true,
                    user: { select: { fullName: true } },
                  },
                },
              },
            },
            user: {
              select: { id: true, email: true, fullName: true },
            },
          },
        },
      },
    });

    if (!payment) {
      return { success: false, message: "Paiement introuvable." };
    }

    // ── 3. Verify the payment belongs to the authenticated customer ──────────
    if (payment.appointment.userId !== session.user.id) {
      return {
        success: false,
        message: "Vous n'êtes pas autorisé à effectuer ce paiement.",
      };
    }

    // ── 4. Verify the payment is still pending ───────────────────────────────
    // FAILED payments are retryable; settled payments are not.
    if (!['PENDING', 'FAILED'].includes(payment.status)) {
      return {
        success: false,
        message: "Ce paiement n'est plus en attente et ne peut pas être repris.",
      };
    }

    // ── 5. Verify the appointment is still in a payable state ────────────────
    // CANCELLED or COMPLETED appointments must not accept new payments.
    const appointmentStatus = payment.appointment.status;
    if (appointmentStatus === "CANCELLED" || appointmentStatus === "COMPLETED") {
      return {
        success: false,
        message: "Ce rendez-vous ne peut plus être payé.",
      };
    }

    // ── 6. Verify the staff's Stripe Connect account is ready ────────────────
    const staff = payment.appointment.staffService.staff;

    if (!staff?.stripeAccountId) {
      return {
        success: false,
        message: "Le compte Stripe de ce membre du staff n'est pas encore configuré. Veuillez contacter le salon.",
      };
    }

    if (!staff.stripeChargesEnabled) {
      return {
        success: false,
        message: "Le compte Stripe de ce membre du staff n'est pas encore activé. Veuillez réessayer ultérieurement.",
      };
    }

    if (!staff.stripePayoutsEnabled) {
      return {
        success: false,
        message: "Le compte Stripe de ce membre du staff n'est pas encore en mesure d'effectuer des virements. Veuillez réessayer ultérieurement.",
      };
    }

    if (!(await isSellerLegalDataComplete())) {
      return {
        success: false,
        message: "Le paiement en ligne n'est pas disponible pour le moment. Merci de réessayer plus tard ou de nous contacter.",
      };
    }

    // ── 7. Determine the amount to charge ────────────────────────────────────
    // depositAmount is 0 for FULL_ONLINE, or the configured deposit for DEPOSIT_ONLINE.
    // The amount charged is the remaining amount owed (totalAmount initially,
    // could be less if a partial payment was already made — though that case
    // doesn't apply here since status is PENDING / paidAmount is 0).
    const totalAmount   = Number(payment.totalAmount);
    const depositAmount = Number(payment.depositAmount);

    // paymentType tells us what this payment is for
    const amountToPay = payment.paymentType === "ONLINE"
      ? totalAmount    // full online payment
      : depositAmount; // deposit (cash with deposit required)

    if (amountToPay <= 0) {
      return {
        success: false,
        message: "Le montant à payer est invalide.",
      };
    }

    // ── 8. Derive the paymentScenario for metadata ───────────────────────────
    const paymentScenario = payment.paymentType === "ONLINE"
      ? "FULL_ONLINE"
      : "DEPOSIT_ONLINE";

    const staffServiceId   = payment.appointment.staffServiceId;
    const appointmentId    = payment.appointment.id;
    const customerEmail    = payment.appointment.user.email;
    const staffName        = staff.user?.fullName || "Expert";
    const serviceName      = payment.appointment.staffService.service.name;
    const appointmentDate  = new Date(payment.appointment.date)
      .toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" });
    const appointmentTime  = new Date(payment.appointment.startTime)
      .toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

    const metadata = {
      appointmentId,
      paymentId:      payment.id,
      paymentScenario,
      customerUserId: session.user.id,
      staffServiceId,
    };

    // ── 9. Create a fresh Stripe Checkout Session ────────────────────────────
    // We always create a new session — old sessions may have expired or been
    // abandoned. The Stripe session ID is the only thing that changes.
    // The Appointment and Payment records are reused as-is.
    const checkoutSession = await stripe.checkout.sessions.create(
      {
        line_items: [
          {
            price_data: {
              currency: "eur",
              product_data: {
                name: payment.paymentType === "ONLINE"
                  ? serviceName
                  : `Acompte - ${serviceName}`,
                description: `${staffName} • ${appointmentDate} • ${appointmentTime}`,
                // Images omitted — Stripe rejects non-HTTPS URLs (localhost in dev)
              },
              unit_amount: Math.round(amountToPay * 100),
            },
            quantity: 1,
          },
        ],
        mode:          "payment",
        success_url:   `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:    `${process.env.NEXT_PUBLIC_APP_URL}/mes-reservations`,
        customer_email: customerEmail,
        metadata,
      },
      {
        // Direct charge — funds go straight to the staff's connected account
        stripeAccount: staff.stripeAccountId,
      }
    );

    // ── 10. Update the payment with the new session reference ────────────────
    // This is the only DB write in this function. We update the
    // transactionReference so the success page can look up the payment
    // via the new session ID.
    await prisma.payment.update({
      where: { id: payment.id },
      data:  { transactionReference: checkoutSession.id },
    });

    return {
      success:   true,
      url:       checkoutSession.url,
      sessionId: checkoutSession.id,
    };
  } catch (error) {
    console.error("[resumeReservationPayment]", error);
    return {
      success: false,
      message: "Erreur lors de la création de la session de paiement. Veuillez réessayer.",
    };
  }
}
