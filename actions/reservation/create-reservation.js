"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import {
  reservationReceivedEmail,
  reservationConfirmedWithPaymentLinkEmail,
  paymentConfirmationEmail,
  welcomeWithCredentialsEmail,
} from "@/lib/email-templates";

const BCRYPT_SALT_ROUNDS = 12;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a secure random password:
 * 12 characters, mixed alphanumeric + symbols.
 */
function generateTemporaryPassword() {
  // 9 random bytes → 12-char base64url string (URL-safe, no padding)
  return randomBytes(9).toString("base64url");
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * Checks whether an email address is already registered.
 * Used by CustomerInfoStep to warn guests before submitting.
 *
 * @param {string} email
 * @returns {Promise<{ exists: boolean }>}
 */
export async function checkEmailExists(email) {
  if (!email) return { exists: false };
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true },
  });
  return { exists: Boolean(user) };
}

/**
 * Creates a reservation with its associated payment.
 *
 * Behaviour:
 *  - If customerInfo.userId is provided (authenticated session), uses that user directly.
 *  - Otherwise finds an existing user by email, or creates a new CUSTOMER account.
 *  - For new accounts: generates + hashes a temporary password, sends a welcome email
 *    with credentials, and returns { temporaryPassword, email } so the client can
 *    call signIn() and auto-authenticate the customer.
 *  - Always sends a reservation confirmation email (fire-and-forget).
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
 *   paymentMethod: string | null,
 *   notes?: string,
 *   isManualMode?: boolean,
 * }} data
 */
export async function createReservation(data) {
  try {
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes, isManualMode = false } = data;

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!staffServiceId || !date || !time || !customerInfo) {
      return { 
        success: false, 
        message: "Informations incomplètes. Veuillez vérifier tous les champs et réessayer." 
      };
    }

    // ── 2. Load staff service ────────────────────────────────────────────────
    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: true,
        staff: { 
          select: { 
            reservationConfirmationMode: true,
            user: { select: { fullName: true } } 
          }
        },
      },
    });

    if (!staffService) {
      return { 
        success: false, 
        message: "Service non disponible. Ce service a peut-être été supprimé. Veuillez réessayer ultérieurement." 
      };
    }

    // ── 3. Build appointment times ───────────────────────────────────────────
    const [hour, minute] = time.split(":").map(Number);
    const appointmentDate = new Date(date);
    appointmentDate.setHours(0, 0, 0, 0); // date-only — no time component

    const startTime = new Date(appointmentDate);
    startTime.setHours(hour, minute, 0, 0);

    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + staffService.duration);

    // ── 4. Verify slot availability ──────────────────────────────────────────
    const conflict = await prisma.appointment.findFirst({
      where: {
        staffServiceId,
        date: appointmentDate,
        startTime: { lte: endTime },
        endTime: { gte: startTime },
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
      },
    });

    if (conflict) {
      return { 
        success: false, 
        message: "Ce créneau vient d'être réservé. Veuillez choisir un autre horaire ou essayer plus tard." 
      };
    }

    // ── 5. Resolve or create the customer user ───────────────────────────────
    let user = null;
    let isNewUser = false;
    let temporaryPassword = null; // only set for brand-new accounts

    if (customerInfo.userId) {
      // Authenticated session — look up by primary key
      user = await prisma.user.findUnique({
        where: { id: customerInfo.userId, isDeleted: false },
      });

      if (!user) {
        return {
          success: false,
          message: "Votre session a expiré. Veuillez vous reconnecter et réessayer.",
        };
      }
    } else {
      // Guest flow — find by email first (phone as secondary fallback)
      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: customerInfo.email.trim().toLowerCase() },
            ...(customerInfo.phone ? [{ phone: customerInfo.phone.trim() }] : []),
          ],
          isDeleted: false,
        },
      });

      if (!user) {
        // New customer — create an account with a secure temporary password
        temporaryPassword = generateTemporaryPassword();
        const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

        user = await prisma.user.create({
          data: {
            fullName: customerInfo.fullName.trim(),
            email: customerInfo.email.trim().toLowerCase(),
            phone: customerInfo.phone.trim(),
            password: hashedPassword,
            role: "CUSTOMER",
            emailVerified: true,  // verified implicitly via reservation flow
            isActive: true,
            newsletterSubscribed: customerInfo.newsletterSubscribed ?? false,
          },
        });

        isNewUser = true;
      }
    }

    // ── 6. Calculate payment amounts (only for automatic mode) ────────────────
    const totalAmount = Number(staffService.price);
    const depositAmount = Math.max(totalAmount * 0.1, 10); // minimum €10 deposit
    const paymentType = paymentMethod === "online" ? "ONLINE" : "ON_SITE";

    // ── 7. Create appointment + payment atomically ───────────────────────────
    const { appointment, payment } = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          userId: user.id,
          staffServiceId,
          date: appointmentDate,
          startTime,
          endTime,
          status: "PENDING",
          notes: notes || null,
        },
      });

      // Only create payment for automatic mode
      let payment = null;
      if (!isManualMode && paymentMethod) {
        payment = await tx.payment.create({
          data: {
            appointmentId: appointment.id,
            depositAmount,
            totalAmount,
            paidAmount: 0,
            remainingAmount: totalAmount,
            paymentType,
            status: "PENDING",
          },
        });
      }

      return { appointment, payment };
    });

    // ── 8. Send emails (fire-and-forget — never block the reservation) ───────
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";

    // 8a. Reservation confirmation — sent to all customers
    if (isManualMode) {
      // Manual mode: send "reservation received" email
      sendEmail({
        to: user.email,
        ...reservationReceivedEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
        }),
      }).catch((err) =>
        console.error("[createReservation] reservation received email failed:", err)
      );
    } else {
      // Automatic mode: send standard confirmation email
      sendEmail({
        to: user.email,
        ...reservationConfirmationEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
          depositAmount,
        }),
      }).catch((err) =>
        console.error("[createReservation] confirmation email failed:", err)
      );
    }

    // 8b. Welcome email with credentials — only for brand-new accounts
    if (isNewUser && temporaryPassword) {
      sendEmail({
        to: user.email,
        ...welcomeWithCredentialsEmail({
          customerName: user.fullName,
          email: user.email,
          temporaryPassword,
          loginUrl: LOGIN_URL,
        }),
      }).catch((err) =>
        console.error("[createReservation] welcome email failed:", err)
      );
    }

    // ── 9. Return result ─────────────────────────────────────────────────────
    return {
      success: true,
      message: isManualMode ? "Demande de réservation envoyée" : "Réservation créée avec succès",
      data: {
        appointment,
        payment: payment || null, // null for manual mode
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
        isNewUser,
        // Only returned for new accounts so PaymentStep can call signIn()
        newUserCredentials: isNewUser
          ? { email: user.email, password: temporaryPassword }
          : null,
      },
    };
  } catch (error) {
    console.error("[createReservation]", error);
    return {
      success: false,
      message: "Nous n'avons pas pu enregistrer votre réservation. Veuillez réessayer dans quelques instants. Si le problème persiste, contactez-nous.",
    };
  }
}

/**
 * Confirms a payment and transitions the appointment to CONFIRMED.
 *
 * @param {string} paymentId
 * @param {string|null} transactionReference
 */
export async function confirmPayment(paymentId, transactionReference = null) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { appointment: true },
    });

    if (!payment) {
      return { success: false, message: "Paiement introuvable" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          paidAmount: Number(payment.depositAmount),
          remainingAmount:
            Number(payment.totalAmount) - Number(payment.depositAmount),
          status: payment.paymentType === "ONLINE" ? "PAID" : "PARTIALLY_PAID",
          paidAt: new Date(),
          transactionReference,
        },
      });

      await tx.transaction.create({
        data: {
          paymentId,
          amount: Number(payment.depositAmount),
          method: payment.paymentType === "ONLINE" ? "ONLINE" : "CARD",
          transactionType: "DEPOSIT",
          paidAt: new Date(),
        },
      });

      await tx.appointment.update({
        where: { id: payment.appointmentId },
        data: { status: "CONFIRMED" },
      });

      await tx.notification.create({
        data: {
          userId: payment.appointment.userId,
          appointmentId: payment.appointmentId,
          type: "APPOINTMENT_CONFIRMED",
          title: "Réservation confirmée",
          message: "Votre réservation a été confirmée avec succès",
          status: "PENDING",
        },
      });
    });

    return { success: true, message: "Paiement confirmé" };
  } catch (error) {
    console.error("[confirmPayment]", error);
    return { success: false, message: "Erreur lors de la confirmation du paiement" };
  }
}
