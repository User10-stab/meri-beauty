"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { auth } from "@/auth";
import { isCheckoutAuthorized } from "@/lib/resume-checkout-token";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail, waitingListJoinConfirmationEmail } from "@/lib/email-templates";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { validateCustomerIdentity } from "@/lib/validations/customer-identity";
import {
  TERMS_CONSENT_REQUIRED_MESSAGE,
  buildTermsAcceptanceUpdate,
  recordTermsAcceptance,
} from "@/lib/terms-consent";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 3;

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

const BCRYPT_SALT_ROUNDS = 12;

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

/**
 * Join the waiting list for a workshop session.
 * Creates the user account if needed (same logic as reservation).
 */
export async function joinWaitingList({ sessionId, customerInfo: submittedCustomerInfo, termsAccepted }) {
  try {
    let customerInfo = submittedCustomerInfo;
    if (!sessionId || !customerInfo?.email) {
      return { success: false, message: "Données manquantes." };
    }

    // The form's CGV checkbox was client-side only. Joining creates a real
    // account and a real place in the queue, so the consent has to be
    // re-established here — this is a public POST endpoint like every
    // "use server" export.
    if (termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
    }

    const customerValidation = validateCustomerIdentity(customerInfo);
    if (!customerValidation.success) {
      return { success: false, field: customerValidation.field, message: customerValidation.message };
    }
    customerInfo = { ...customerInfo, ...customerValidation.data };

    const rateLimitIp = await getClientIp();
    const rateLimitKey = `${customerInfo.email.trim().toLowerCase()}:${rateLimitIp}`;
    if (isRateLimited("join-waiting-list", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
      return { success: false, message: "Trop de tentatives. Veuillez patienter avant de réessayer." };
    }
    recordRateLimitHit("join-waiting-list", rateLimitKey);

    // Load session + workshop
    const session = await prisma.workshopSession.findUnique({
      where: { id: sessionId },
      include: { workshop: true },
    });

    if (!session || session.status !== "SCHEDULED") {
      return { success: false, message: "Session introuvable ou non disponible." };
    }

    // Resolve or create user
    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    let user = await prisma.user.findFirst({ where: { email, isDeleted: false } });

    let temporaryPassword = null;
    let isNewUser = false;

    if (!user) {
      // Check phone uniqueness
      if (phone) {
        const phoneExists = await prisma.user.findFirst({ where: { phone, isDeleted: false } });
        if (phoneExists) {
          return {
            success: false,
            message: "Ce numéro de téléphone est déjà associé à un autre compte.",
            field: "phone",
          };
        }
      }

      temporaryPassword = generateTemporaryPassword();
      const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          fullName: customerInfo.fullName,
          email,
          password: hashedPassword,
          phone: phone || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: "CUSTOMER",
          ...buildTermsAcceptanceUpdate(),
        },
      });

      isNewUser = true;

      // Send welcome email
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://meribeauty.com"}/login`;
      const emailTemplate = welcomeWithCredentialsEmail({
        customerName: customerInfo.fullName,
        email,
        temporaryPassword,
        loginUrl,
      });
      sendEmail({ to: email, ...emailTemplate }).catch(() => {});
    }

    // Returning customer, or an account predating consent tracking.
    await recordTermsAcceptance(prisma, user.id);

    const seatsRequested = customerInfo.seatsRequested ?? 1;

    // Serialised per session. The "already on the list?" check and the
    // position calculation below are read-then-write: two submissions racing
    // each other (a double-click, or the same person on two devices) both read
    // no existing entry and both read the same highest position, producing two
    // rows for one customer and two people shown the same "position #3".
    // There is no unique constraint on the table to fall back on — the entry
    // is deliberately soft-statused rather than deleted — so the lock is the
    // guard. Transaction-scoped, so it always releases even if this crashes.
    const { entry, position, alreadyOnList } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`meri-waiting-list-${sessionId}`}))`;

      const existing = await tx.waitingListEntry.findFirst({
        where: {
          sessionId,
          customerId: user.id,
          status: { in: ["WAITING", "NOTIFIED"] },
        },
      });

      if (existing) {
        return { entry: existing, position: existing.position, alreadyOnList: true };
      }

      const lastEntry = await tx.waitingListEntry.findFirst({
        where: { sessionId },
        orderBy: { position: "desc" },
      });
      const nextPosition = (lastEntry?.position ?? 0) + 1;

      const created = await tx.waitingListEntry.create({
        data: {
          sessionId,
          customerId: user.id,
          seatsRequested,
          position: nextPosition,
          status: "WAITING",
        },
      });

      return { entry: created, position: nextPosition, alreadyOnList: false };
    });

    // Nothing new happened — don't send a second confirmation email for a
    // place they already hold.
    if (alreadyOnList) {
      return {
        success: true,
        alreadyOnList: true,
        position,
        entryId: entry.id,
        seatsRequested: entry.seatsRequested,
        email,
        message: "Vous êtes déjà inscrit(e) sur la liste d'attente pour cette session.",
      };
    }

    sendEmail({
      to: email,
      ...waitingListJoinConfirmationEmail({
        customerName: customerInfo.fullName,
        activityTitle: session.workshop.title,
        sessionDate: formatSessionDate(session.startDate),
        position,
        seatsRequested,
      }),
    }).catch((err) => console.error("[joinWaitingList] confirmation email failed:", err));

    return {
      success: true,
      alreadyOnList: false,
      position,
      entryId: entry.id,
      seatsRequested,
      isNewUser,
      temporaryPassword,
      email,
    };
  } catch (error) {
    console.error("[joinWaitingList]", error?.message || error);
    return {
      success: false,
      message: process.env.NODE_ENV === "development"
        ? `Erreur: ${error?.message}`
        : "Erreur lors de l'inscription à la liste d'attente.",
    };
  }
}

// checkWaitingListStatus(sessionId, email) used to live here. Nothing called
// it, and as a "use server" export it was a public unauthenticated endpoint
// that answered "is this email on the waiting list for this session?" about
// any address a caller cared to try. joinWaitingList already reports an
// existing entry back to the person who owns it (alreadyOnList), which is the
// only place that answer was ever needed.

/**
 * Validate a priority waiting list entry for reservation.
 * Returns true if the entry is NOTIFIED (no expiry window).
 */
export async function validateWaitingListPriority(waitingListEntryId) {
  try {
    const entry = await prisma.waitingListEntry.findUnique({
      where: { id: waitingListEntryId },
    });

    if (!entry) return { valid: false, message: "Entrée introuvable." };
    if (entry.status !== "NOTIFIED") return { valid: false, message: "Cette entrée n'est plus valide." };

    return { valid: true };
  } catch (error) {
    console.error("[validateWaitingListPriority]", error);
    return { valid: false, message: "Erreur de validation." };
  }
}

/**
 * Mark a waiting list entry as converted after successful reservation.
 *
 * Both ids are client-supplied (called right after createWorkshopReservation
 * returns its new id) and this is a public "use server" endpoint with no
 * session for a guest booking — a bare (waitingListEntryId, reservationId)
 * pair proves nothing on its own, it just has to already be a real matching
 * pair, which anyone who intercepted or guessed both ids could still supply.
 * checkoutToken is the same signed capability createWorkshopReservation just
 * minted to authorize Stripe checkout on this exact reservation — requiring
 * it here (or a session that owns the reservation) closes that gap.
 */
export async function convertWaitingListEntry(waitingListEntryId, reservationId, checkoutToken) {
  try {
    const entry = await prisma.waitingListEntry.findUnique({
      where: { id: waitingListEntryId },
      select: { sessionId: true, customerId: true },
    });
    if (!entry) return { success: false };

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      select: { sessionId: true, customerId: true },
    });
    if (
      !reservation ||
      reservation.sessionId !== entry.sessionId ||
      reservation.customerId !== entry.customerId
    ) {
      return { success: false };
    }

    const authSession = await auth();
    if (
      !isCheckoutAuthorized(reservation, {
        resumeType: "WORKSHOP",
        resumeId: reservationId,
        checkoutToken,
        sessionUserId: authSession?.user?.id,
      })
    ) {
      return { success: false };
    }

    const converted = await prisma.waitingListEntry.updateMany({
      where: { id: waitingListEntryId, status: "NOTIFIED" },
      data: {
        status: "CONVERTED",
        convertedToReservationId: reservationId,
      },
    });
    return { success: converted.count === 1 };
  } catch (error) {
    console.error("[convertWaitingListEntry]", error);
    return { success: false };
  }
}
