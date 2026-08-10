"use server";

import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import {
  reservationReceivedEmail,
  paymentConfirmationEmail,
  welcomeWithCredentialsEmail,
  multiReservationConfirmationEmail,
} from "@/lib/email-templates";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { generateAutologinToken } from "@/lib/autologin";
import { resolvePromoCode } from "@/lib/promo-codes";
import { isAdminRole } from "@/lib/authorization";
import { buildAppointmentWindow, findConflictingAppointment, validateAppointmentSlot } from "@/lib/appointment-scheduling";

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
        emailVerified: false,
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
 * }} data `isManualMode` is intentionally not accepted here — the real
 *   confirmation mode is always derived server-side from the staff
 *   member's own `reservationConfirmationMode` (see below). Trusting a
 *   client-supplied value would let a caller bypass a required deposit.
 */
export async function createReservation(data) {
  try {
    const authSession = await auth();
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes, promoCode } = data;

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

    // findConflictingAppointment only rules out collision with another
    // appointment — it says nothing about closures, staff time off, working
    // hours, or a past date/time. Re-validate against the same rules the
    // booking calendar itself uses to offer slots in the first place.
    const slotCheck = await validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time);
    if (!slotCheck.valid) {
      return { success: false, message: slotCheck.message };
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

    // ── 6. Resolve the server-side payment decision ───────────────────────
    //
    // Promo code is re-validated here regardless of any client-side preview,
    // never trusted from the client — only meaningful for the automatic
    // pay-now path (a Payment row is only created when shouldCreatePaymentRecord).
    const rawTotalAmount = Number(staffService.price);

    // The real confirmation mode always comes from the staff member's own
    // setting — never from client input. `data.isManualMode` used to be
    // trusted here directly, which let any caller force MANUAL mode on an
    // AUTOMATIC-confirmation service: that skips the required online
    // payment/deposit entirely (MANUAL never requires online payment) and
    // still reserves the slot, so a client could fill a staff member's
    // calendar with unpaid PENDING appointments at will.
    const confirmationMode = staffService.staff?.reservationConfirmationMode ?? "MANUAL";
    const isManuallyConfirmed = confirmationMode === "MANUAL";

    let promoCodeId = null;
    let discountAmount = 0;
    if (!isManuallyConfirmed && paymentMethod && promoCode) {
      const promoResult = await resolvePromoCode(promoCode, rawTotalAmount);
      if (!promoResult.success) return { success: false, message: promoResult.message };
      promoCodeId = promoResult.promoCodeId;
      discountAmount = promoResult.discountAmount;
    }

    const paymentDecision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode,
      depositEnabled: Boolean(staffService.staff?.depositEnabled),
      depositPercentage: Number(staffService.staff?.depositPercentage ?? 0),
      totalAmount: rawTotalAmount,
      paymentMethod,
      discountAmount,
    });
    const totalAmount = paymentDecision.totalAmount; // already net of discountAmount
    const depositAmount = paymentDecision.depositAmount;
    const paymentType = paymentDecision.paymentType;
    // Server-derived only — see the comment above `confirmationMode`.
    const effectiveIsManualMode = paymentDecision.isManualMode;
    const appointmentStatus = paymentDecision.appointmentStatusBeforePayment;

    // ── 7. Create appointment + payment atomically ───────────────────────────
    const { appointment, payment } = await prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          userId: user.id,
          staffServiceId,
          staffId: staffService.staffId,
          date: appointmentDate,
          startTime,
          endTime,
          status: appointmentStatus,
          notes: notes || null,
        },
      });

      let payment = null;
      if (paymentDecision.shouldCreatePaymentRecord) {
        payment = await tx.payment.create({
          data: {
            appointmentId: appointment.id,
            depositAmount,
            totalAmount,
            paidAmount: 0,
            remainingAmount: totalAmount,
            paymentType,
            status: "PENDING",
            promoCodeId,
            discountAmount,
          },
        });
      }

      return { appointment, payment };
    });

    // ── 8. Send emails (fire-and-forget — never block the reservation) ───────
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";

    // 8a. Reservation confirmation — sent to all customers
    if (effectiveIsManualMode) {
      // Manual mode: "reservation received, pending staff review" email
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
      // Automatic mode, cash/no-deposit path: appointment is confirmed immediately.
      // No online payment was taken, so we send a payment confirmation showing €0
      // paid and the full amount remaining (to be paid at the salon).
      await sendEmail({
        to: user.email,
        ...paymentConfirmationEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
          paidAmount: 0,
          totalAmount,
          paymentMethod: "ON_SITE",
        }),
      }).catch((err) => console.error("[createReservation] confirmation email failed:", err));
    }

    // 8b. Welcome email with credentials — only for brand-new accounts
    await sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, "[createReservation]");

    // ── 9. Return result ─────────────────────────────────────────────────────
    return {
      success: true,
      message: effectiveIsManualMode ? "Demande de réservation envoyée" : "Réservation créée avec succès",
      data: {
        appointment,
        payment: payment || null, // null for manual mode
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
        isNewUser,
        // Only returned for new accounts so PaymentStep can call signIn() —
        // and the autologin token below must be gated the same way. If
        // resolveOrCreateCustomer matched an EXISTING account (guest
        // checkout looks up by email/phone with no password check), issuing
        // a token here would let anyone who knows a customer's email sign
        // themselves into that customer's real account.
        newUserCredentials: isNewUser ? { email: user.email, password: temporaryPassword } : null,
        autologinToken: isNewUser ? generateAutologinToken(user.email) : null,
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
 * Confirms an ON_SITE (cash) payment and transitions the appointment to CONFIRMED.
 *
 * This function is ONLY for cash/on-site payments confirmed by staff at the
 * salon. It must NEVER be called for ONLINE or DEPOSIT payments — those are
 * exclusively confirmed by the Stripe webhook (checkout.session.completed).
 * Calling this on an online payment would mark it paid without Stripe
 * verification, which is a critical security violation.
 *
 * Callable only by the appointment's own owner (or a dashboard role) — a
 * paymentId alone is not proof of anything, it's just a database id that
 * appears in the reservation response and URLs. PaymentStep.jsx signs the
 * caller in (via the autologin token, for brand-new guests) before ever
 * calling this, specifically so this check has a session to compare against.
 *
 * @param {string} paymentId
 * @param {string|null} transactionReference
 */
export async function confirmPayment(paymentId, transactionReference = null) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Authentification requise." };
    }

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { appointment: true },
    });

    if (!payment || !payment.appointment) {
      return { success: false, message: "Paiement introuvable" };
    }

    if (payment.appointment.userId !== session.user.id && !isAdminRole(session.user.role)) {
      // Same generic message as "not found" — don't confirm existence to a
      // caller who isn't the owner.
      return { success: false, message: "Paiement introuvable" };
    }

    // Safety guard: refuse to confirm online/deposit payments from this function.
    // Those must be confirmed exclusively by the Stripe webhook.
    if (payment.paymentType === "ONLINE" || payment.paymentType === "DEPOSIT") {
      console.error(
        `[confirmPayment] Attempted to confirm a ${payment.paymentType} payment (id=${paymentId}) outside of the Stripe webhook. This is not allowed.`
      );
      return {
        success: false,
        message: "Ce paiement doit être confirmé par Stripe. Opération refusée.",
      };
    }

    await prisma.$transaction(async (tx) => {
      // ON_SITE cash payment: the customer pays the full remaining amount at the salon.
      // paidAmount  = totalAmount (full price paid in one go at the salon)
      // remainingAmount = 0 (nothing left to pay)
      // status      = PAID
      const totalAmount = Number(payment.totalAmount);

      await tx.payment.update({
        where: { id: paymentId },
        data: {
          paidAmount: totalAmount,
          remainingAmount: 0,
          status: "PAID",
          paidAt: new Date(),
          transactionReference,
        },
      });

      await tx.transaction.create({
        data: {
          paymentId,
          amount: totalAmount,
          method: "CASH",
          transactionType: "FINAL_PAYMENT",
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

    // Same gap as createReservation: findConflictingAppointment alone says
    // nothing about closures, staff time off, working hours, or a past
    // date/time for each leg of this multi-appointment booking.
    const slotChecks = await Promise.all(
      appointments.map(({ staffServiceId, time }, i) => {
        const { appointmentDate, startTime } = timeWindows[i];
        return validateAppointmentSlot(staffServiceId, appointmentDate, startTime, time);
      })
    );
    const invalidIndex = slotChecks.findIndex((c) => !c.valid);
    if (invalidIndex !== -1) {
      return { success: false, message: slotChecks[invalidIndex].message };
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
            staffId: staffServices[i].staffId,
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
        // See createReservation's return above — gated the same way and for
        // the same reason (guest lookup can match an existing account).
        newUserCredentials: isNewUser ? { email: user.email, password: temporaryPassword } : null,
        autologinToken: isNewUser ? generateAutologinToken(user.email) : null,
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