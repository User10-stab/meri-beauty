"use server";

import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import {
  reservationReceivedEmail,
  reservationConfirmedEmail,
  reservationCreatedAutomaticEmail,
  welcomeWithCredentialsEmail,
  multiReservationConfirmationEmail,
  staffReservationConfirmedEmail,
  staffMultipleReservationsConfirmedEmail,
} from "@/lib/email-templates";
import { getReservationPaymentDecision } from "@/lib/reservation-payment";
import { generateAutologinToken } from "@/lib/autologin";
import { resolvePromoCode } from "@/lib/promo-codes";
import { isAdminRole } from "@/lib/authorization";
import {
  createNotification,
  createNotificationsBulk,
  buildAppointmentCreatedNotification,
  buildAppointmentConfirmedNotification,
  getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients,
} from "@/lib/notifications";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";
import {
  TERMS_CONSENT_REQUIRED_MESSAGE,
  buildTermsAcceptanceUpdate,
  recordTermsAcceptance,
} from "@/lib/terms-consent";
import { buildAppointmentWindow, findConflictingAppointment, validateAppointmentSlot } from "@/lib/appointment-scheduling";
import { SessionExpiredError, PhoneAlreadyRegisteredError } from "@/lib/reservation-errors";

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
export async function resolveOrCreateCustomer(customerInfo, authenticatedUserId) {
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
        ...buildNewsletterConsentUpdate(customerInfo.newsletterSubscribed ?? false, "appointment_booking"),
        // Guest booking creates the account, so this is the moment consent is
        // given — it used to be recorded at signup only.
        ...buildTermsAcceptanceUpdate(),
      },
    });

    return { user, isNewUser: true, temporaryPassword };
  } catch (createError) {
    // P2002 = unique constraint violation — another request already
    // created this user between our findFirst and this create. The unique
    // indexes backing email/phone are active-only (partial indexes, see
    // migration 20260817153631_active_only_uniqueness), so a collision here
    // can only be against an ACTIVE user — never a soft-deleted one. The old
    // fallback re-queried without an isDeleted filter anyway and, if it
    // happened to land on a soft-deleted namesake, "revived" that account by
    // overwriting its password and forcing emailVerified: true with no proof
    // the caller actually owns that email — an account-takeover path. It
    // also force-verified whatever active user it matched, same problem.
    // The only safe outcome of a real active-row collision is: the email is
    // ours (same person double-submitting, e.g. a retried request) — reuse
    // that account as-is, without touching its verification state — or the
    // phone belongs to someone else's account under a different email, which
    // we can only refuse.
    if (createError?.code === "P2002") {
      const existingUser = await prisma.user.findFirst({
        where: { email: customerInfo.email.trim().toLowerCase(), isDeleted: false },
      });

      if (!existingUser) {
        throw new PhoneAlreadyRegisteredError();
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
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isDeleted: false },
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

    // The booking form's CGV checkbox was client-side only. This action is a
    // public POST endpoint, so the consent has to be re-established here —
    // it is also what gets persisted onto the customer below.
    if (data?.termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
    }

    // ── 2. Load staff service ────────────────────────────────────────────────
    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: true,
        staff: {
          select: {
            id: true,
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
      // Returning customer, or an account predating consent tracking.
      await recordTermsAcceptance(prisma, user.id);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        return {
          success: false,
          message: "Votre session a expiré. Veuillez vous reconnecter et réessayer.",
        };
      }
      if (err instanceof PhoneAlreadyRegisteredError) {
        return {
          success: false,
          field: "phone",
          message: "Ce numéro de téléphone est déjà associé à un autre compte. Connectez-vous ou utilisez un autre numéro.",
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

    // CASH_ONLY override: no online payment flows apply.
    // Appointment status depends ONLY on reservationConfirmationMode (the
    // same server-derived isManuallyConfirmed computed above — never a
    // second, independently-computed copy of the same thing).
    if (staffService.staff?.allowedPaymentMethods === "CASH_ONLY") {
      const effectiveIsManualMode = isManuallyConfirmed;

      const appointmentStatus = effectiveIsManualMode ? "PENDING" : "CONFIRMED";

      const { appointment } = await prisma.$transaction(async (tx) => {
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

        return { appointment };
      });

      // Notifications (outside transaction - business operation already committed)
      const staffName = staffService.staff?.user?.fullName ?? "votre experte";
      const serviceName = staffService.service?.name ?? "votre service";
      const customerName = user.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(staffService.staff?.id);

      const buildFn = appointmentStatus === "CONFIRMED"
        ? buildAppointmentConfirmedNotification
        : buildAppointmentCreatedNotification;

      if (recipientUserIds.length > 0) {
        const inputs = recipientUserIds.map((uid) =>
          buildFn({
            userId: uid,
            appointmentId: appointment.id,
            date: appointmentDate,
            startTime,
            serviceName,
            staffName,
            customerName,
          })
        );

        try {
          await createNotificationsBulk(inputs);
        } catch (err) {
          // Notification failure must never block reservation creation.
          if (err?.message === "VALIDATION_ERROR") {
            console.error("[createReservation] notification validation error:", err.fieldErrors);
          } else {
            console.error("[createReservation] notifications failed:", err);
          }
        }
      }

      // Email logic below expects these variables
      const payment = null;
      const totalAmount = rawTotalAmount;

      // Send a staff appointment email only once the appointment is confirmed.
      if (appointmentStatus === "CONFIRMED") {
        const emailRecipients = await getAppointmentEmailRecipients(staffService.staff?.id);
        for (const recipient of emailRecipients) {
          await sendEmail({
            to: recipient.email,
            ...staffReservationConfirmedEmail({
              staffName: recipient.fullName,
              customerName: user.fullName,
              serviceName,
              date: appointmentDate,
              time,
              duration: staffService.duration,
              totalAmount: rawTotalAmount,
            }),
          }).catch((err) => console.error("[createReservation] dashboard email failed:", err));
        }
      }

      if (effectiveIsManualMode) {
        await sendEmail({
          to: user.email,
          ...reservationReceivedEmail({
            customerName: user.fullName,
            serviceName,
            staffName,
            date: appointmentDate,
            time,
            duration: staffService.duration,
            totalAmount: rawTotalAmount,
          }),
        }).catch((err) => console.error("[createReservation] reservation received email failed:", err));
      } else {
        await sendEmail({
          to: user.email,
          ...reservationCreatedAutomaticEmail({
            customerName: user.fullName,
            serviceName,
            staffName,
            date: appointmentDate,
            time,
          }),
        }).catch((err) => console.error("[createReservation] confirmation email failed:", err));
      }

      await sendWelcomeEmailIfNew({ user, isNewUser, temporaryPassword }, "[createReservation]");

      return {
        success: true,
        message: effectiveIsManualMode ? "Demande de réservation envoyée" : "Réservation créée avec succès",
        data: {
          appointment,
          payment,
          user: {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
          },
          isNewUser,
          newUserCredentials: isNewUser ? { email: user.email, password: temporaryPassword } : null,
          autologinToken: isNewUser ? generateAutologinToken(user.email) : null,
        },
      };
    }

    const paymentDecision = getReservationPaymentDecision({
      appointmentCount: 1,
      confirmationMode,
      depositEnabled: Boolean(staffService.staff?.depositEnabled),
      depositPercentage: Number(staffService.staff?.depositPercentage ?? 0),
      allowedPaymentMethods: staffService.staff?.allowedPaymentMethods,
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

    // ── 7b. Appointment notification (outside transaction - business operation already committed) ──
    // Notifications are not allowed to break reservation creation.
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";
    const customerName = user.fullName;

    const recipientUserIds = await getAppointmentNotificationRecipients(staffService.staff?.id);

    const buildFn = appointmentStatus === "CONFIRMED"
      ? buildAppointmentConfirmedNotification
      : buildAppointmentCreatedNotification;

    if (recipientUserIds.length > 0) {
      try {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildFn({
              userId: uid,
              appointmentId: appointment.id,
              date: appointmentDate,
              startTime,
              serviceName,
              staffName,
              customerName,
            })
          )
        );
      } catch (err) {
        if (err?.message === "VALIDATION_ERROR") {
          console.error("[createReservation] notification validation error:", err.fieldErrors);
        } else {
          console.error("[createReservation] notifications failed:", err);
        }
      }
    }

    // ── 8. Send emails (fire-and-forget — never block the reservation) ───────
    // 8a. A pending appointment gets a pending-request email. A confirmed
    // appointment gets the simple reservation confirmation email.
    if (appointmentStatus !== "CONFIRMED") {
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
      await sendEmail({
        to: user.email,
        ...reservationCreatedAutomaticEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: appointmentDate,
          time,
        }),
      }).catch((err) => console.error("[createReservation] confirmation email failed:", err));
    }

    // 8b. Staff is notified only for a confirmed appointment. Pending
    // requests remain visible through the existing dashboard notification.
    if (appointmentStatus === "CONFIRMED") {
      const emailRecipients = await getAppointmentEmailRecipients(staffService.staffId);
      for (const recipient of emailRecipients) {
        await sendEmail({
          to: recipient.email,
          ...staffReservationConfirmedEmail({
            staffName: recipient.fullName,
            customerName: user.fullName,
            serviceName,
            date: appointmentDate,
            time,
          }),
        }).catch((err) => console.error("[createReservation] dashboard email failed:", err));
      }
    }

    // 8c. Welcome email with credentials — only for brand-new accounts
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
      include: {
        appointment: {
          include: {
            staffService: {
              include: {
                service: { select: { name: true } },
                staff: { include: { user: { select: { fullName: true } } } },
              },
            },
            user: { select: { fullName: true } },
          },
        },
      },
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

      // Payment + appointment status just transitioned to CONFIRMED/PAID —
      // emit APPOINTMENT_CONFIRMED alongside the business records so all three
      // commit or roll back together.
      const serviceName = payment.appointment.staffService?.service?.name;
      const staffName = payment.appointment.staffService?.staff?.user?.fullName;
      const customerName = payment.appointment.user?.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(payment.appointment.staffId, { tx });

      if (recipientUserIds.length > 0) {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentConfirmedNotification({
              userId: uid,
              appointmentId: payment.appointmentId,
              date: payment.appointment.date,
              startTime: payment.appointment.startTime,
              serviceName,
              staffName,
              customerName,
            })
          ),
          { tx }
        );
      }
    });

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

    // Same public-endpoint reasoning as createReservation above.
    if (data?.termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
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
                id: true,
                user: { select: { fullName: true, email: true } },
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

    // ── 3b. Check drafts against each other for same-staff overlaps ───────
    // findConflictingAppointment (below) only checks each draft against
    // appointments that already exist in the DB — two drafts in this same
    // batch booked with the same staff at overlapping times are invisible to
    // each other there, since neither exists yet when both checks run in
    // parallel. Without this, the second insert in the transaction below
    // hits the DB's overlap exclusion constraint directly and surfaces as a
    // raw, unhandled error instead of a clean validation message.
    for (let i = 0; i < appointments.length; i++) {
      for (let j = i + 1; j < appointments.length; j++) {
        if (staffServices[i].staffId !== staffServices[j].staffId) continue;
        if (timeWindows[i].appointmentDate.getTime() !== timeWindows[j].appointmentDate.getTime()) continue;
        const occupiedEndI = new Date(timeWindows[i].endTime);
        occupiedEndI.setMinutes(occupiedEndI.getMinutes() + Number(staffServices[i].margin ?? 0));
        const occupiedEndJ = new Date(timeWindows[j].endTime);
        occupiedEndJ.setMinutes(occupiedEndJ.getMinutes() + Number(staffServices[j].margin ?? 0));
        const overlap = timeWindows[i].startTime < occupiedEndJ && timeWindows[j].startTime < occupiedEndI;
        if (overlap) {
          return {
            success: false,
            message: `Les rendez-vous ${i + 1} et ${j + 1} se chevauchent avec le même membre du personnel. Veuillez choisir des horaires différents.`,
          };
        }
      }
    }

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
      // Returning customer, or an account predating consent tracking.
      await recordTermsAcceptance(prisma, user.id);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        return {
          success: false,
          message: "Votre session a expiré. Veuillez vous reconnecter et réessayer.",
        };
      }
      if (err instanceof PhoneAlreadyRegisteredError) {
        return {
          success: false,
          field: "phone",
          message: "Ce numéro de téléphone est déjà associé à un autre compte. Connectez-vous ou utilisez un autre numéro.",
        };
      }
      throw err;
    }

    // A multi-appointment booking never goes through PaymentStep — there's no
    // deposit and no online-payment step for it (see getReservationPaymentDecision's
    // appointmentCount !== 1 branch, the single source of truth for this rule).
    // Every leg lands PENDING regardless of the staff member's own
    // reservationConfirmationMode, same as CASH_ONLY/MANUAL single bookings —
    // it's confirmed later from the staff dashboard, never auto-confirmed here.
    const multiAppointmentStatus = getReservationPaymentDecision({
      appointmentCount: appointments.length,
    }).appointmentStatusBeforePayment;

    // ── 6. Create all appointments atomically ─────────────────────────────
    const createdAppointments = await prisma.$transaction(async (tx) => {
      /** @type {any[]} */
      const created = [];
      for (let i = 0; i < appointments.length; i++) {
        const { staffServiceId } = appointments[i];
        const { appointmentDate, startTime, endTime } = timeWindows[i];
        const appt = await tx.appointment.create({
          data: {
            userId: user.id,
            staffServiceId,
            staffId: staffServices[i].staffId,
            date: appointmentDate,
            startTime,
            endTime,
            status: multiAppointmentStatus,
            notes: notes || null,
          },
        });
        created.push(appt);
      }
      return created;
    });

    // ── 6b. Send notifications for all appointments (outside transaction - business operation already committed) ──
    for (let i = 0; i < createdAppointments.length; i++) {
      const appt = createdAppointments[i];
      const { appointmentDate, startTime, endTime } = timeWindows[i];
      const serviceName = staffServices[i].service?.name;
      const staffName = staffServices[i].staff?.user?.fullName;
      const customerName = user.fullName;
      const time = appointments[i].time;
      const staffId = staffServices[i].staff?.id;

      const recipientUserIds = await getAppointmentNotificationRecipients(staffId);

      if (recipientUserIds.length > 0) {
        try {
          await createNotificationsBulk(
            recipientUserIds.map((uid) =>
              buildAppointmentCreatedNotification({
                userId: uid,
                appointmentId: appt.id,
                date: appointmentDate,
                startTime: time,
                serviceName,
                staffName,
                customerName,
              })
            )
          );
        } catch (err) {
          if (err?.message === "VALIDATION_ERROR") {
            console.error("[createReservation] notification validation error:", err.fieldErrors);
          } else {
            console.error("[createReservation] notifications failed:", err);
          }
        }
      }
    }

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
        isPending: multiAppointmentStatus === "PENDING",
      }),
    }).catch((err) => console.error("[createMultipleReservations] confirmation email failed:", err));

    // 7b. Send one consolidated email to each staff/dashboard recipient.
    const staffAppointments = appointments.map(({ time }, i) => ({
      serviceName: staffServices[i].service?.name ?? "—",
      date: timeWindows[i].appointmentDate,
      time,
      duration: staffServices[i].duration,
      amount: Number(staffServices[i].price ?? 0),
      staffId: staffServices[i].staff?.id,
    }));
    const recipientsByEmail = new Map();
    for (const appointment of staffAppointments) {
      const recipients = await getAppointmentEmailRecipients(appointment.staffId);
      for (const recipient of recipients) {
        if (!recipientsByEmail.has(recipient.email)) {
          recipientsByEmail.set(recipient.email, { fullName: recipient.fullName });
        }
      }
    }
    for (const [email, recipient] of recipientsByEmail) {
      await sendEmail({
        to: email,
        ...staffMultipleReservationsConfirmedEmail({
          staffName: recipient.fullName,
          customerName: user.fullName,
          appointments: staffAppointments,
          totalAmount,
        }),
      }).catch((err) => console.error("[createMultipleReservations] consolidated staff email failed:", err));
    }

    // 7c. Welcome email for brand-new accounts
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