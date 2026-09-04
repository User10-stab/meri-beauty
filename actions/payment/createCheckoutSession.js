"use server";

import { auth } from "@/auth";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { ACTIVE_APPOINTMENT_STATUSES } from "@/lib/appointment-status";
import { generateAutologinToken } from "@/lib/autologin";
import { parseLocalDateString } from "@/lib/slot-availability";
import {
  createNotificationsBulk,
  buildAppointmentCreatedNotification,
  getAppointmentNotificationRecipients,
} from "@/lib/notifications";
import { resolvePromoCode } from "@/lib/promo-codes";
import { validateAppointmentSlot } from "@/lib/appointment-scheduling";
import { sendEmail } from "@/lib/email";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import {
  TERMS_CONSENT_REQUIRED_MESSAGE,
  buildTermsAcceptanceUpdate,
  recordTermsAcceptance,
} from "@/lib/terms-consent";

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

// `authenticatedUserId` must come from the server-side session, never from
// client-supplied customerInfo.userId — trusting that field would let any
// logged-in customer pass a victim's id and book/pay an appointment under
// their account (IDOR). See the identical fix in
// actions/reservation/create-reservation.js#resolveOrCreateCustomer.
async function resolveOrCreateCustomer(customerInfo, authenticatedUserId) {
  if (authenticatedUserId) {
    const existingUser = await prisma.user.findUnique({
      where: { id: authenticatedUserId, isDeleted: false },
    });

    if (existingUser) {
      return { user: existingUser, isNewUser: false };
    }
  }

  const normalizedEmail = customerInfo.email?.trim().toLowerCase();
  const normalizedPhone = customerInfo.phone?.trim();

  // Guest flow — always attempt to create a new account. Never silently
  // adopt an existing account based on an unauthenticated email/phone
  // lookup: knowing someone's email is not proof of identity, and doing
  // so would let anyone who knows a customer's address pollute or hijack
  // that account.
  const temporaryPassword = randomBytes(9).toString("base64url");
  const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

  try {
    const user = await prisma.user.create({
      data: {
        fullName: customerInfo.fullName?.trim() || "Client",
        email: normalizedEmail || `${Date.now()}@guest.local`,
        phone: normalizedPhone || `${Date.now()}`,
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: false,
        isActive: true,
        ...buildNewsletterConsentUpdate(Boolean(customerInfo.newsletterSubscribed ?? false), "appointment_booking"),
        // Guest booking creates the account, so this is the moment consent is
        // given — it used to be recorded at signup only.
        ...buildTermsAcceptanceUpdate(),
      },
    });

    return { user, isNewUser: true };
  } catch (createError) {
    // P2002 = unique constraint violation — another concurrent request
    // already created this user between our attempt and now.
    // Fall back to the existing record. No autologin token is issued
    // because this account was not created by *this* request.
    if (createError?.code === "P2002") {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
            ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
          ],
        },
      });

      if (!existingUser) {
        throw createError;
      }

      return { user: existingUser, isNewUser: false };
    }

    throw createError;
  }
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
    const authSession = await auth();
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes, promoCode } = reservationData;

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

    // The booking form's CGV checkbox was client-side only. This action is a
    // public POST endpoint, so the consent has to be re-established here —
    // it is also what gets persisted onto the customer below.
    if (reservationData?.termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
    }

    // ── 2. Load and validate staff service ────────────────────────────────────
    const staffService = await prisma.staffService.findFirst({
      where: { id: staffServiceId, isDeleted: false },
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
            allowedPaymentMethods: true,
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

    if (!(await isSellerLegalDataComplete())) {
      return {
        success: false,
        message: "Le paiement en ligne n'est pas disponible pour le moment. Merci de réessayer plus tard ou de nous contacter.",
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
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
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

    // The check above only rules out collision with another appointment —
    // it says nothing about salon closures, staff time off, working hours,
    // or a past date/time. Re-validate against the same rules the booking
    // calendar itself uses to offer slots in the first place.
    const slotCheck = await validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time);
    if (!slotCheck.valid) {
      return { success: false, message: slotCheck.message };
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
    // Enforce staff payment-method settings server-side
    const acceptsOnlinePayments =
      staff.allowedPaymentMethods === "BOTH" ||
      staff.allowedPaymentMethods === "ONLINE_ONLY";
    const acceptsCashPayments =
      staff.allowedPaymentMethods === "BOTH" ||
      staff.allowedPaymentMethods === "CASH_ONLY";

    if (staff.allowedPaymentMethods === "CASH_ONLY") {
      return {
        success: false,
        message: "Ce professionnel accepte uniquement le paiement au salon.",
      };
    }

    if (normalizedPaymentMethod === "online" && !acceptsOnlinePayments) {
      return {
        success: false,
        message: "Ce professionnel n'accepte pas le paiement en ligne.",
      };
    }

    if (normalizedPaymentMethod === "cash" && !acceptsCashPayments) {
      return {
        success: false,
        message: "Ce professionnel n'accepte pas le paiement au salon.",
      };
    }
    const rawTotalAmount = Number(staffService.price);

    // Re-validated here regardless of any client-side preview — never trust
    // a client-computed discount amount. Mirrors create-reservation.js.
    let promoCodeId = null;
    let discountAmount = 0;
    if (promoCode) {
      const promoResult = await resolvePromoCode(promoCode, rawTotalAmount);
      if (!promoResult.success) return { success: false, message: promoResult.message };
      promoCodeId = promoResult.promoCodeId;
      discountAmount = promoResult.discountAmount;
    }

    const paymentDecision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode: staff.reservationConfirmationMode ?? "MANUAL",
      // A deposit is only meaningful if online payments are accepted.
      depositEnabled: acceptsOnlinePayments ? Boolean(staff.depositEnabled) : false,
      depositPercentage: acceptsOnlinePayments ? Number(staff.depositPercentage ?? 0) : 0,
      allowedPaymentMethods: staff.allowedPaymentMethods,
      totalAmount: rawTotalAmount,
      paymentMethod: normalizedPaymentMethod,
      discountAmount,
    });
    const totalAmount = paymentDecision.totalAmount; // already net of discountAmount

    if (!paymentDecision.requiresOnlinePaymentNow) {
      return {
        success: false,
        message: "Aucun paiement en ligne n'est requis pour cette option.",
      };
    }

    const amountToPay = paymentDecision.paymentIntent === "FULL_ONLINE"
      ? paymentDecision.totalAmount
      : paymentDecision.depositAmount;

    const { user: customerUser, isNewUser } = await resolveOrCreateCustomer(customerInfo, authSession?.user?.id);
    // Returning customer, or an account predating consent tracking.
    await recordTermsAcceptance(prisma, customerUser.id);
    // Generate an autologin token for the customer — but only when this
    // request just created the account. If `resolveOrCreateCustomer` matched
    // an existing account (by email or phone, with no password check), a
    // token here would sign the *caller's* browser into a stranger's real
    // account — anyone who knows a customer's email could take it over.
    // Existing accounts must go through normal login instead.
    const autologinToken = isNewUser ? generateAutologinToken(customerUser.email) : null;

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
    const { appointment, payment, createdNewPayment } = await prisma.$transaction(async (tx) => {
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
          createdNewPayment: false,
        };
      }

      const appointment = await tx.appointment.create({
        data: {
          userId: customerUser.id,
          staffServiceId,
          staffId: staffService.staffId,
          date: appointmentDate,
          startTime,
          endTime,
          // On an AUTOMATIC booking the webhook promotes this to CONFIRMED
          // once Stripe confirms payment. A MANUAL one stays PENDING even
          // after paying — the customer pays up front, but only staff
          // acceptance confirms the slot (resolveAppointmentStatusAfterPayment).
          status: "PENDING",
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
          promoCodeId,
          discountAmount,
        },
      });

      // Notify dashboard users (staff + owners/admins) of the new pending booking
      const serviceName = staffService.service?.name;
      const staffName = staff.user?.fullName;
      const customerName = customerUser.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(staffService.staffId, { tx });

      if (recipientUserIds.length > 0) {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentCreatedNotification({
              userId: uid,
              appointmentId: appointment.id,
              date: appointmentDate,
              startTime,
              serviceName,
              staffName,
              customerName,
            })
          ),
          { tx }
        );
      }

      return { appointment, payment, createdNewPayment: true };
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
                    paymentDecision.paymentIntent === "FULL_ONLINE"
                      ? staffService.service.name
                      : `Acompte - ${staffService.service.name}`,
                  description: `${staff.user?.fullName || "Expert"} • ${appointmentDate.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })} • ${time}`,
                  // Images omitted: Stripe rejects non-HTTPS URLs (localhost in dev).
                },
                unit_amount: Math.round(amountToPay * 100),
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}&payment_id=${payment.id}`,
          cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/reservation?canceled=true`,
          customer_email: customerInfo.email,
          payment_intent_data: {
            metadata,
          },
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

