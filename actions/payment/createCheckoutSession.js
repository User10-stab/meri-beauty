"use server";

import { createHash, randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { generateAutologinToken } from "@/lib/autologin";
import { parseLocalDateString } from "@/lib/slot-availability";

const BCRYPT_SALT_ROUNDS = 12;

function buildReservationLockKey({ staffServiceId, date, time, customerUserId, paymentMethod, notes }) {
  const fingerprint = [
    staffServiceId,
    date instanceof Date ? date.toISOString() : String(date ?? ""),
    time ?? "",
    customerUserId ?? "",
    paymentMethod ?? "",
    notes ?? "",
  ].join("::");

  const hash = createHash("sha256").update(fingerprint).digest("hex");
  // Use 15 hex characters (60 bits) to ensure it fits in PostgreSQL's signed bigint (max 2^63-1)
  return BigInt("0x" + hash.slice(0, 15));
}

async function resolveOrCreateCustomer(customerInfo) {
  if (customerInfo.userId) {
    const existingUser = await prisma.user.findUnique({
      where: { id: customerInfo.userId, isDeleted: false },
    });

    if (existingUser) {
      return existingUser;
    }
  }

  const normalizedEmail = customerInfo.email?.trim().toLowerCase();
  const normalizedPhone = customerInfo.phone?.trim();

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
      ],
      isDeleted: false,
    },
  });

  if (user) {
    return user;
  }

  const temporaryPassword = randomBytes(9).toString("base64url");
  const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

  user = await prisma.user.create({
    data: {
      fullName: customerInfo.fullName?.trim() || "Client",
      email: normalizedEmail || `${Date.now()}@guest.local`,
      phone: normalizedPhone || `${Date.now()}`,
      password: hashedPassword,
      role: "CUSTOMER",
      emailVerified: false,
      isActive: true,
      newsletterSubscribed: Boolean(customerInfo.newsletterSubscribed ?? false),
    },
  });

  return user;
}

/**
 * Creates a Stripe Checkout Session for the reservation deposit payment.
 *
 * This action creates a pending appointment and payment record first so the
 * existing Appointment/Payment models remain the source of truth for the
 * reservation state while Stripe only receives the identifiers needed to
 * complete the payment flow.
 * 
 * @param {{
 *   staffServiceId: string,
 *   date: Date|string,
 *   time: string,
 *   customerInfo: {
 *     userId?: string,
 *     fullName: string,
 *     email: string,
 *     phone: string,
 *     newsletterSubscribed?: boolean,
 *   },
 *   paymentMethod: string,
 *   notes?: string,
 * }} reservationData
 * @returns {Promise<{ success: boolean, sessionId?: string, url?: string, message?: string }>}
 */
export async function createCheckoutSession(reservationData) {
  try {
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes } = reservationData;

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!staffServiceId || !date || !time || !customerInfo) {
      return { 
        success: false, 
        message: "Données manquantes pour créer la session de paiement" 
      };
    }

    if (!customerInfo.email || !customerInfo.fullName) {
      return { 
        success: false, 
        message: "Informations client incomplètes" 
      };
    }

    // ── 2. Load and validate staff service ────────────────────────────────────
    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: true,
        staff: {
          select: {
            id: true,
            stripeAccountId: true,
            stripeChargesEnabled: true,
            stripePayoutsEnabled: true,
            reservationConfirmationMode: true,
            depositEnabled: true,
            depositPercentage: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!staffService) {
      return { success: false, message: "Service introuvable" };
    }

    // ── 2b. Validate the staff member's Stripe Connect account ────────────────
    // Payments go directly to the staff's connected account (direct charge).
    // All three conditions must be true before we can accept any payment.
    const staff = staffService.staff;


        const account = await stripe.accounts.retrieve(staff.stripeAccountId);

console.log("========== STRIPE ACCOUNT ==========");
console.log(account.id);
console.log(account.charges_enabled);
console.log(account.payouts_enabled);
console.log(account.capabilities);
console.log(account.requirements);
console.log("===================================");

    if (!staff?.stripeAccountId) {
      return {
        success: false,
        message: "Ce membre du staff n'a pas encore connecté son compte Stripe. Le paiement en ligne n'est pas disponible pour le moment.",
      };
    }

    if (!staff.stripeChargesEnabled) {
      return {
        success: false,
        message: "Le compte Stripe de ce membre du staff n'est pas encore activé pour recevoir des paiements. Veuillez réessayer ultérieurement.",
      };
    }

    if (!staff.stripePayoutsEnabled) {
      return {
        success: false,
        message: "Le compte Stripe de ce membre du staff n'est pas encore en mesure d'effectuer des virements. Veuillez réessayer ultérieurement.",
      };
    }

    // ── 3. Calculate appointment times ────────────────────────────────────────
    const [hour, minute] = time.split(":").map(Number);

    // parseLocalDateString anchors to local midnight — no UTC-offset drift
    // when `date` arrives as an ISO string through the Server Action boundary.
    const appointmentDate = parseLocalDateString(date);

    const startTime = new Date(appointmentDate);
    startTime.setHours(hour, minute, 0, 0);

    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + staffService.duration);

    // ── 4. Verify staff availability ─────────────────────────────────────────
    const existingAppointments = await prisma.appointment.findMany({
      where: {
        staffService: {
          staffId: staffService.staffId,
        },
        date: appointmentDate,
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
      },
      include: {
        staffService: {
          select: { margin: true },
        },
      },
    });

    const conflict = existingAppointments.find((appointment) => {
      const occupiedStart = new Date(appointment.startTime);
      const occupiedEnd = new Date(appointment.endTime);
      occupiedEnd.setMinutes(
        occupiedEnd.getMinutes() + Number(appointment.staffService?.margin ?? 0)
      );

      return startTime < occupiedEnd && endTime > occupiedStart;
    });

    if (conflict) {
      return { 
        success: false, 
        message: "Ce créneau n'est plus disponible. Veuillez en sélectionner un autre." 
      };
    }

    // ── 5. Resolve the payment decision from the shared engine ─────────────
    const normalizedPaymentMethod = paymentMethod === "ONLINE" || paymentMethod === "online"
      ? "online"
      : paymentMethod === "ON_SITE" || paymentMethod === "cash"
        ? "cash"
        : null;

    if (!normalizedPaymentMethod) {
      return {
        success: false,
        message: "Méthode de paiement invalide.",
      };
    }

    const totalAmount = Number(staffService.price);
    const paymentDecision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: staff.reservationConfirmationMode ?? "MANUAL",
      depositEnabled:   Boolean(staff.depositEnabled),
      depositPercentage: Number(staff.depositPercentage ?? 0),
      totalAmount,
      paymentMethod: normalizedPaymentMethod,
    });

    if (!paymentDecision.requiresOnlinePaymentNow) {
      return {
        success: false,
        message: "Aucun paiement en ligne n'est requis pour cette option.",
      };
    }

    const amountToPay = paymentDecision.paymentIntent === "FULL_ONLINE"
      ? paymentDecision.totalAmount
      : paymentDecision.depositAmount;

    const customerUser = await resolveOrCreateCustomer(customerInfo);
    // Generate an autologin token for the customer. PaymentStep uses this to
    // sign the customer in before navigating to Stripe, so that if the payment
    // is interrupted they can return to /mes-reservations while authenticated.
    const autologinToken = generateAutologinToken(customerUser.email);

    const lockId = buildReservationLockKey({
      staffServiceId,
      date: appointmentDate,
      time,
      customerUserId: customerUser.id,
      paymentMethod: normalizedPaymentMethod,
      notes,
    });

    // ── 6. Check for existing PENDING reservation + create new records ────────
    // The advisory lock is acquired INSIDE the transaction so it is held for
    // the entire duration of the read-then-write sequence. Acquiring it outside
    // a transaction (as before) released it immediately, making it ineffective
    // against concurrent duplicate submissions.
    const { appointment, payment } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId}::bigint)`;

      // Re-check for an existing PENDING appointment now that the lock is held.
      const existingPendingAppointment = await tx.appointment.findFirst({
        where: {
          userId: customerUser.id,
          staffServiceId,
          date: appointmentDate,
          startTime,
          endTime,
          status: "PENDING",
          isDeleted: false,
          notes: notes || null,
        },
        include: { payment: true },
      });

      // If a retryable PENDING payment already exists, reuse the records.
      // A fresh Checkout Session will be created for it below.
      if (existingPendingAppointment?.payment?.status === "PENDING") {
        return {
          appointment: existingPendingAppointment,
          payment: existingPendingAppointment.payment,
        };
      }

      const appointment = await tx.appointment.create({
        data: {
          userId: customerUser.id,
          staffServiceId,
          date: appointmentDate,
          startTime,
          endTime,
          status: "PENDING", // webhook sets CONFIRMED after Stripe confirms payment
          notes: notes || null,
        },
      });

      const payment = await tx.payment.create({
        data: {
          appointmentId: appointment.id,
          depositAmount: paymentDecision.depositAmount,
          totalAmount,
          paidAmount: 0,
          remainingAmount: totalAmount,
          paymentType: paymentDecision.paymentType,
          status: "PENDING",
        },
      });

      return { appointment, payment };
    });

    const metadata = {
      appointmentId: appointment.id,
      paymentId: payment.id,
      paymentScenario: paymentDecision.paymentIntent,
      customerUserId: customerUser.id,
      staffServiceId,
    };

    let session;
    try {
      // ── Direct charge to the staff's connected Stripe account ─────────────
      //
      // By passing { stripeAccount: staff.stripeAccountId } as the second
      // argument, the Stripe API creates this Checkout Session on behalf of
      // the connected account. The payment goes DIRECTLY to the staff's
      // Stripe account — the platform never holds the funds.
      //
      // The platform's secret key authenticates the API call, but the
      // resulting charge belongs entirely to the connected account. This is
      // Stripe Connect "direct charges" pattern.
      //
      // No application_fee_amount is set — per business rules, the platform
      // takes zero commission from these payments.
      session = await stripe.checkout.sessions.create(
        {
          // payment_method_types is intentionally omitted for direct charges.
          // When creating a session on a connected account, Stripe determines
          // eligible payment methods from the connected account's configuration.
          // Specifying "card" here would be ignored or cause a payment failure
          // if the connected account does not have card payments explicitly enabled.
          line_items: [
            {
              price_data: {
                currency: "eur",
                product_data: {
                  name:
                    paymentMethod === "ONLINE"
                      ? staffService.service.name
                      : `Acompte - ${staffService.service.name}`,
                  description: `${staff.user?.fullName || "Expert"} • ${new Date(date).toLocaleDateString("fr-FR")} • ${time}`,
                  // Images omitted: Stripe rejects non-HTTPS URLs (localhost in dev).
                },
                unit_amount: Math.round(amountToPay * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/reservation?canceled=true`,
          customer_email: customerInfo.email,
          // Metadata is available on the session object in the webhook.
          // The webhook reads these fields to update Payment and Appointment.
          metadata,
        },
        {
          // This is the key that makes it a direct charge:
          // all funds go to this connected account, not the platform.
          stripeAccount: staff.stripeAccountId,
        }
      );

      await prisma.payment.update({
        where: { id: payment.id },
        data: { transactionReference: session.id },
      });

      return {
        success: true,
        sessionId: session.id,
        url: session.url,
        // Return the autologin token so the caller (PaymentStep) can sign in
        // the customer before redirecting to Stripe. This ensures that if the
        // customer abandons Stripe Checkout, they are already authenticated and
        // can find their pending reservation on /mes-reservations.
        autologinToken,
        customerEmail: customerUser.email,
      };
    } catch (error) {
      // Do NOT delete the appointment or payment on Stripe failure.
      // They stay PENDING so the customer can retry payment later.
      throw error;
    }
  } catch (error) {
    console.error("[createCheckoutSession]", error);
    let errorMessage = "Erreur inconnue";
    try {
      errorMessage = String(error?.message || error || "Erreur inconnue");
    } catch {
      errorMessage = "Erreur inconnue";
    }
    return {
      success: false,
      message: "Erreur lors de la création de la session de paiement Stripe",
      error: errorMessage,
    };
  }
}

