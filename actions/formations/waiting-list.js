"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import {
  welcomeWithCredentialsEmail,
  formationWaitingListJoinConfirmationEmail,
} from "@/lib/email-templates";
import { sendEmail } from "@/lib/email";
import { validateCustomerIdentity } from "@/lib/validations/customer-identity";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import {
  TERMS_CONSENT_REQUIRED_MESSAGE,
  buildTermsAcceptanceUpdate,
  recordTermsAcceptance,
} from "@/lib/terms-consent";

/**
 * Formation equivalent of actions/workshops/waiting-list.js — same shape
 * (join / notify-all / validate-priority / convert), backed
 * by the same polymorphic WaitingListEntry table via formationSessionId
 * instead of sessionId. Kept as a separate file rather than generalizing
 * the atelier one, matching this project's existing convention of keeping
 * atelier and formation business logic structurally independent.
 */

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

/** Join the waiting list for a formation session. */
export async function joinFormationWaitingList({ sessionId, customerInfo: submittedCustomerInfo, termsAccepted }) {
  try {
    let customerInfo = submittedCustomerInfo;
    if (!sessionId || !customerInfo?.email) {
      return { success: false, message: "Données manquantes." };
    }

    // Same public-endpoint reasoning as the atelier waiting list.
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
    if (isRateLimited("join-waiting-list-formation", rateLimitKey, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX_REQUESTS })) {
      return { success: false, message: "Trop de tentatives. Veuillez patienter avant de réessayer." };
    }
    recordRateLimitHit("join-waiting-list-formation", rateLimitKey);

    const session = await prisma.formationSession.findUnique({
      where: { id: sessionId },
      include: { formation: true },
    });

    if (!session || session.status !== "SCHEDULED") {
      return { success: false, message: "Session introuvable ou non disponible." };
    }

    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    let user = await prisma.user.findUnique({ where: { email } });

    let temporaryPassword = null;
    let isNewUser = false;

    if (!user) {
      if (phone) {
        const phoneExists = await prisma.user.findUnique({ where: { phone } });
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

      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://meribeauty.com"}/login`;
      sendEmail({
        to: email,
        ...welcomeWithCredentialsEmail({ customerName: customerInfo.fullName, email, temporaryPassword, loginUrl }),
      }).catch(() => {});
    }

    // Returning customer, or an account predating consent tracking.
    await recordTermsAcceptance(prisma, user.id);

    const seatsRequested = customerInfo.seatsRequested ?? 1;

    // Serialised per session — see the atelier equivalent for why: the
    // existence check and the position calculation are read-then-write, so
    // two racing submissions otherwise produce a duplicate entry and two
    // people holding the same position number.
    const { entry, position, alreadyOnList } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`meri-waiting-list-formation-${sessionId}`}))`;

      const existing = await tx.waitingListEntry.findFirst({
        where: {
          formationSessionId: sessionId,
          customerId: user.id,
          status: { in: ["WAITING", "NOTIFIED"] },
        },
      });

      if (existing) {
        return { entry: existing, position: existing.position, alreadyOnList: true };
      }

      const lastEntry = await tx.waitingListEntry.findFirst({
        where: { formationSessionId: sessionId },
        orderBy: { position: "desc" },
      });
      const nextPosition = (lastEntry?.position ?? 0) + 1;

      const created = await tx.waitingListEntry.create({
        data: {
          formationSessionId: sessionId,
          customerId: user.id,
          seatsRequested,
          position: nextPosition,
          status: "WAITING",
        },
      });

      return { entry: created, position: nextPosition, alreadyOnList: false };
    });

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
      ...formationWaitingListJoinConfirmationEmail({
        customerName: customerInfo.fullName,
        formationTitle: session.formation.title,
        sessionDate: formatSessionDate(session.startDate),
        position,
        seatsRequested,
      }),
    }).catch((err) => console.error("[joinFormationWaitingList] confirmation email failed:", err));

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
    console.error("[joinFormationWaitingList]", error?.message || error);
    return {
      success: false,
      message:
        process.env.NODE_ENV === "development"
          ? `Erreur: ${error?.message}`
          : "Erreur lors de l'inscription à la liste d'attente.",
    };
  }
}

// checkFormationWaitingListStatus was removed alongside its atelier twin —
// unused, and as a "use server" export it answered "is this email on the
// waiting list?" about any address a caller supplied.

/** Validate a priority waiting list entry for reservation. */
export async function validateFormationWaitingListPriority(waitingListEntryId) {
  try {
    const entry = await prisma.waitingListEntry.findUnique({ where: { id: waitingListEntryId } });
    if (!entry) return { valid: false, message: "Entrée introuvable." };
    if (entry.status !== "NOTIFIED") return { valid: false, message: "Cette entrée n'est plus valide." };
    return { valid: true };
  } catch (error) {
    console.error("[validateFormationWaitingListPriority]", error);
    return { valid: false, message: "Erreur de validation." };
  }
}

/** Mark a waiting list entry as converted after a successful reservation. */
export async function convertFormationWaitingListEntry(waitingListEntryId, reservationId) {
  try {
    const entry = await prisma.waitingListEntry.findUnique({
      where: { id: waitingListEntryId },
      select: { formationSessionId: true, customerId: true },
    });
    if (!entry) return { success: false };

    const reservation = await prisma.formationReservation.findUnique({
      where: { id: reservationId },
      select: { sessionId: true, customerId: true },
    });
    if (!reservation || reservation.sessionId !== entry.formationSessionId || reservation.customerId !== entry.customerId) {
      return { success: false };
    }

    const converted = await prisma.waitingListEntry.updateMany({
      where: { id: waitingListEntryId, status: "NOTIFIED" },
      data: { status: "CONVERTED", convertedToReservationId: reservationId },
    });
    return { success: converted.count === 1 };
  } catch (error) {
    console.error("[convertFormationWaitingListEntry]", error);
    return { success: false };
  }
}
