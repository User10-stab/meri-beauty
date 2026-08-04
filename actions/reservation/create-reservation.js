"use server";

import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import {
  reservationReceivedEmail,
  reservationConfirmedWithPaymentLinkEmail,
  paymentConfirmationEmail,
  welcomeWithCredentialsEmail,
  multiReservationConfirmationEmail,
} from "@/lib/email-templates";
import { computeDepositAmount } from "@/lib/reservation-payment";
import { generateAutologinToken } from "@/lib/autologin";

const BCRYPT_SALT_ROUNDS = 12;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown by resolveOrCreateCustomer when an authenticated userId no longer
 * matches a live user (expired/deleted session). Callers catch this and
 * translate it into the appropriate user-facing message.
 */
class SessionExpiredError extends Error {
  constructor() {
    super("Session expired");
    this.name = "SessionExpiredError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a secure random password:
 * 12 characters, mixed alphanumeric + symbols.
 */
function generateTemporaryPassword() {
  // 9 random bytes → 12-char base64url string (URL-safe, no padding)
  return randomBytes(9).toString("base64url");
}

/**
 * Resolves the customer for a reservation, or creates a brand-new CUSTOMER
 * account if none exists yet.
 *
 * - If customerInfo.userId is provided (authenticated session), looks the
 *   user up by primary key. Throws SessionExpiredError if not found.
 * - Otherwise finds an existing user by email (phone as secondary fallback),
 *   or creates a new account with a securely generated temporary password.
 * - Guards against a race condition: two concurrent requests may both pass
 *   the findFirst check and then both attempt to create the same email.
 *   If create fails with P2002 (unique constraint), falls back to fetching
 *   the already-existing record instead of crashing.
 *
 * @param {{
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   newsletterSubscribed?: boolean,
 * }} customerInfo
 * @param {string|undefined} authenticatedUserId - from the server-side
 *   session, never from client-supplied customerInfo (that was an IDOR:
 *   any logged-in customer could pass a victim's id and book under their
 *   account).
 * @returns {Promise<{ user: object, isNewUser: boolean, temporaryPassword: string|null }>}
 */
async function resolveOrCreateCustomer(customerInfo, authenticatedUserId) {
  if (authenticatedUserId) {
    const user = await prisma.user.findUnique({
      where: { id: authenticatedUserId, isDeleted: false },
    });

    if (!user) {
      throw new SessionExpiredError();
    }

    return { user, isNewUser: false, temporaryPassword: null };
  }

  // Guest flow — find by email first (phone as secondary fallback)
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: customerInfo.email.trim().toLowerCase() },
        ...(customerInfo.phone ? [{ phone: customerInfo.phone.trim() }] : []),
      ],
      isDeleted: false,
    },
  });

  if (user) {
    if (!user.emailVerified || !user.isActive) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerified: true,
          isActive: true,
        },
      });
    }
    return { user, isNewUser: false, temporaryPassword: null };
  }

  // New customer — create an account with a secure temporary password.
  try {
    const temporaryPassword = generateTemporaryPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

    user = await prisma.user.create({
      data: {
        fullName: customerInfo.fullName.trim(),
        email: customerInfo.email.trim().toLowerCase(),
        phone: customerInfo.phone.trim(),
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: true, // verified implicitly via reservation flow
        isActive: true,
        newsletterSubscribed: customerInfo.newsletterSubscribed ?? false,
      },
    });

    return { user, isNewUser: true, temporaryPassword };
  } catch (createError) {
    // P2002 = unique constraint violation — another request already
    // created this user between our findFirst and this create.
    if (createError?.code === "P2002") {
      let existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: customerInfo.email.trim().toLowerCase() },
            ...(customerInfo.phone ? [{ phone: customerInfo.phone.trim() }] : []),
          ],
        },
      });

      if (!existingUser) {
        // Truly unexpected — propagate so the outer catch handles it
        throw createError;
      }

      if (existingUser.isDeleted) {
        const temporaryPassword = generateTemporaryPassword();
        const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            fullName: customerInfo.fullName.trim(),
            email: customerInfo.email.trim().toLowerCase(),
            phone: customerInfo.phone.trim(),
            password: hashedPassword,
            role: "CUSTOMER",
            emailVerified: true,
            isActive: true,
            isDeleted: false,
            deletedAt: null,
            newsletterSubscribed: customerInfo.newsletterSubscribed ?? false,
          },
        });

        return { user, isNewUser: true, temporaryPassword };
      }

      if (!existingUser.emailVerified || !existingUser.isActive) {
        existingUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            emailVerified: true,
            isActive: true,
          },
        });
      }

      return { user: existingUser, isNewUser: false, temporaryPassword: null };
    }

    throw createError;
  }
}

/**
 * Builds the date-only appointment date plus start/end Date objects for a
 * given calendar date, "HH:mm" time string, and service duration.
 *
 * @param {Date|string} date
 * @param {string} time - "HH:mm"
 * @param {number} durationMinutes
 * @returns {{ appointmentDate: Date, startTime: Date, endTime: Date }}
 */
function buildAppointmentWindow(date, time, durationMinutes) {
  const [hour, minute] = time.split(":").map(Number);

  const appointmentDate = new Date(date);
  appointmentDate.setHours(0, 0, 0, 0); // date-only — no time component

  const startTime = new Date(appointmentDate);
  startTime.setHours(hour, minute, 0, 0);

  const endTime = new Date(startTime);
  endTime.setMinutes(endTime.getMinutes() + durationMinutes);

  return { appointmentDate, startTime, endTime };
}

/**
 * Checks whether an overlapping, still-active appointment already exists
 * for the given staff service and time window.
 *
 * @param {string} staffServiceId
 * @param {Date} appointmentDate
 * @param {Date} startTime
 * @param {Date} endTime
 * @returns {Promise<object|null>}
 */
function findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime) {
  return prisma.appointment.findFirst({
    where: {
      staffServiceId,
      date: appointmentDate,
      startTime: { lte: endTime },
      endTime: { gte: startTime },
      status: { in: ["PENDING", "CONFIRMED"] },
      isDeleted: false,
    },
  });
}

/**
 * Sends the "welcome with credentials" email, but only when the customer
 * account was just created (fire-and-forget — never blocks the caller).
 *
 * @param {{ user: object, isNewUser: boolean, temporaryPassword: string|null }} params
 * @param {string} logPrefix - e.g. "[createReservation]" for error logging
 */
async function sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, logPrefix) {
  if (!isNewUser || !temporaryPassword) return;

  try {
    await sendEmail({
      to: user.email,
      ...welcomeWithCredentialsEmail({
        customerName: user.fullName,
        email: user.email,
        temporaryPassword,
        loginUrl: LOGIN_URL,
      }),
    });
  } catch (err) {
    console.error(`${logPrefix} welcome email failed:`, err);
  }
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
    const authSession = await auth();
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes, isManualMode = false } = data;

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!staffServiceId || !date || !time || !customerInfo) {
      return {
        success: false,
        message: "Informations incomplètes. Veuillez vérifier tous les champs et réessayer.",
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
            depositEnabled: true,
            depositPercentage: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!staffService) {
      return {
        success: false,
        message: "Service non disponible. Ce service a peut-être été supprimé. Veuillez réessayer ultérieurement.",
      };
    }

    // ── 3. Build appointment window ──────────────────────────────────────────
    const { appointmentDate, startTime, endTime } = buildAppointmentWindow(
      date,
      time,
      staffService.duration
    );

    // ── 4. Verify slot availability ──────────────────────────────────────────
    const conflict = await findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime);

    if (conflict) {
      return {
        success: false,
        message: "Ce créneau vient d'être réservé. Veuillez choisir un autre horaire ou essayer plus tard.",
      };
    }

    // ── 5. Resolve or create the customer user ───────────────────────────────
    let user, isNewUser, temporaryPassword;
    try {
      ({ user, isNewUser, temporaryPassword } = await resolveOrCreateCustomer(customerInfo, authSession?.user?.id));
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        return {
          success: false,
          message: "Votre session a expiré. Veuillez vous reconnecter et réessayer.",
        };
      }
      throw err;
    }

    // ── 6. Calculate payment amounts ─────────────────────────────────────────
    //
    // Payment method determines the charge strategy:
    //   "online" → customer pays the full price upfront via Stripe
    //   "cash"   → customer pays at the salon; a deposit may be required
    //              depending on the staff member's depositEnabled setting.
    //
    // computeDepositAmount is the single source of truth (lib/reservation-payment.js).
    const totalAmount = Number(staffService.price);
    const paymentType = paymentMethod === "online" ? "ONLINE" : "ON_SITE";

    const depositEnabled = Boolean(staffService.staff?.depositEnabled);
    const depositPercentage = Number(staffService.staff?.depositPercentage ?? 0);

    // For online payment, the full amount is charged immediately.
    // For salon payment, only a deposit is charged (or nothing if not required).
    const depositAmount =
      paymentMethod === "online"
        ? totalAmount
        : computeDepositAmount(totalAmount, depositEnabled, depositPercentage);

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
    //
    // NOTE: the original file called an unimported `reservationConfirmationEmail`
    // in the automatic-mode branch, which would throw a ReferenceError at runtime.
    // The closest imported template is `reservationConfirmedWithPaymentLinkEmail`
    // — using that here. Double-check this matches the intended template.
    if (isManualMode) {
      // Manual mode: send "reservation received" email
      await sendEmail({
        to: user.email,
        ...reservationReceivedEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
        }),
      }).catch((err) => console.error("[createReservation] reservation received email failed:", err));
    } else {
      // Automatic mode: send standard confirmation email
      await sendEmail({
        to: user.email,
        ...reservationConfirmedWithPaymentLinkEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
          depositAmount,
        }),
      }).catch((err) => console.error("[createReservation] confirmation email failed:", err));
    }

    // 8b. Welcome email with credentials — only for brand-new accounts
    await sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, "[createReservation]");

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
        newUserCredentials: isNewUser ? { email: user.email, password: temporaryPassword } : null,
        autologinToken: generateAutologinToken(user.email),
      },
    };
  } catch (error) {
    console.error("[createReservation]", error);
    return {
      success: false,
      message:
        "Nous n'avons pas pu enregistrer votre réservation. Veuillez réessayer dans quelques instants. Si le problème persiste, contactez-nous.",
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
          remainingAmount: Number(payment.totalAmount) - Number(payment.depositAmount),
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

    // NOTE: `paymentConfirmationEmail` is imported but was never sent anywhere
    // in the original file. If a payment-confirmation email is expected here,
    // wire it up, e.g.:
    //
    // sendEmail({
    //   to: payment.appointment... (needs a user relation/email available),
    //   ...paymentConfirmationEmail({ ... }),
    // }).catch((err) => console.error("[confirmPayment] confirmation email failed:", err));

    return { success: true, message: "Paiement confirmé" };
  } catch (error) {
    console.error("[confirmPayment]", error);
    return { success: false, message: "Erreur lors de la confirmation du paiement" };
  }
}

/**
 * Creates multiple reservations for the same customer in one call.
 * Used by the multi-draft flow (ReviewStep) where the customer books
 * several appointments across different staff / services.
 *
 * Behaviour:
 *  - Resolves (or creates) the customer user exactly once, then reuses
 *    that user for every appointment.
 *  - Checks slot availability for every appointment before writing anything.
 *  - Creates all appointments atomically inside a single Prisma transaction.
 *  - Sends a single multi-reservation confirmation email (fire-and-forget).
 *  - Returns the same shape as createReservation so callers can handle
 *    isNewUser / newUserCredentials the same way.
 *
 * @param {{
 *   appointments: Array<{ staffServiceId: string, date: Date|string, time: string }>,
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
export async function createMultipleReservations(data) {
  try {
    const authSession = await auth();
    const { appointments, customerInfo, notes } = data;

    // ── 1. Validate ────────────────────────────────────────────────────────
    if (!appointments?.length || !customerInfo) {
      return {
        success: false,
        message: "Informations incomplètes. Veuillez vérifier tous les champs et réessayer.",
      };
    }

    // ── 2. Load all staff services in parallel ────────────────────────────
    const staffServices = await Promise.all(
      appointments.map(({ staffServiceId }) =>
        prisma.staffService.findUnique({
          where: { id: staffServiceId },
          include: {
            service: true,
            staff: {
              select: {
                user: { select: { fullName: true } },
              },
            },
          },
        })
      )
    );

    const missing = staffServices.findIndex((ss) => !ss);
    if (missing !== -1) {
      return {
        success: false,
        message: "Un ou plusieurs services sont introuvables. Veuillez recommencer votre réservation.",
      };
    }

    // ── 3. Build appointment time windows ─────────────────────────────────
    const timeWindows = appointments.map(({ date, time }, i) =>
      buildAppointmentWindow(date, time, staffServices[i].duration)
    );

    // ── 4. Check slot availability for every appointment ──────────────────
    const conflicts = await Promise.all(
      appointments.map(({ staffServiceId }, i) => {
        const { appointmentDate, startTime, endTime } = timeWindows[i];
        return findConflictingAppointment(staffServiceId, appointmentDate, startTime, endTime);
      })
    );

    const conflictIndex = conflicts.findIndex((c) => c !== null);
    if (conflictIndex !== -1) {
      return {
        success: false,
        message: `Le créneau du rendez-vous ${conflictIndex + 1} vient d'être réservé. Veuillez choisir un autre horaire.`,
      };
    }

    // ── 5. Resolve or create the customer user (once) ─────────────────────
    let user, isNewUser, temporaryPassword;
    try {
      ({ user, isNewUser, temporaryPassword } = await resolveOrCreateCustomer(customerInfo, authSession?.user?.id));
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        return {
          success: false,
          message: "Votre session a expiré. Veuillez vous reconnecter et réessayer.",
        };
      }
      throw err;
    }

    // ── 6. Create all appointments atomically ─────────────────────────────
    const createdAppointments = await prisma.$transaction(
      appointments.map(({ staffServiceId }, i) => {
        const { appointmentDate, startTime, endTime } = timeWindows[i];
        return prisma.appointment.create({
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
      })
    );

    // ── 7. Send multi-reservation confirmation email (fire-and-forget) ────
    const totalAmount = staffServices.reduce((sum, ss) => sum + Number(ss.price ?? 0), 0);

    await sendEmail({
      to: user.email,
      ...multiReservationConfirmationEmail({
        customerName: user.fullName,
        appointments: appointments.map(({ time }, i) => ({
          serviceName: staffServices[i].service?.name ?? "—",
          staffName: staffServices[i].staff?.user?.fullName ?? "—",
          date: timeWindows[i].appointmentDate,
          time,
        })),
        totalDepositPaid: 0,
        totalAmount,
      }),
    }).catch((err) => console.error("[createMultipleReservations] confirmation email failed:", err));

    // 7b. Welcome email for brand-new accounts
    await sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, "[createMultipleReservations]");

    // ── 8. Return result ──────────────────────────────────────────────────
    return {
      success: true,
      message: "Réservations créées avec succès",
      data: {
        appointments: createdAppointments,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
        isNewUser,
        newUserCredentials: isNewUser ? { email: user.email, password: temporaryPassword } : null,
        autologinToken: generateAutologinToken(user.email),
      },
    };
  } catch (error) {
    console.error("[createMultipleReservations]", error);
    return {
      success: false,
      message: "Nous n'avons pas pu enregistrer vos réservations. Veuillez réessayer dans quelques instants.",
    };
  }
}