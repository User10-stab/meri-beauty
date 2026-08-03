"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail, waitingListNotificationEmail, waitingListJoinConfirmationEmail } from "@/lib/email-templates";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
export async function joinWaitingList({ sessionId, customerInfo }) {
  try {
    if (!sessionId || !customerInfo?.email) {
      return { success: false, message: "Données manquantes." };
    }

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
    let user = await prisma.user.findUnique({ where: { email } });

    let temporaryPassword = null;
    let isNewUser = false;

    if (!user) {
      // Check phone uniqueness
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

    // Check if already on waiting list for this session
    const existing = await prisma.waitingListEntry.findFirst({
      where: {
        sessionId,
        customerId: user.id,
        status: { in: ["WAITING", "NOTIFIED"] },
      },
    });

    if (existing) {
      return {
        success: true,
        position: existing.position,
        entryId: existing.id,
        message: "Vous êtes déjà inscrit(e) sur la liste d'attente pour cette session.",
      };
    }

    // Calculate next position
    const lastEntry = await prisma.waitingListEntry.findFirst({
      where: { sessionId },
      orderBy: { position: "desc" },
    });
    const nextPosition = (lastEntry?.position ?? 0) + 1;

    // Create waiting list entry
    const seatsRequested = customerInfo.seatsRequested ?? 1;
    const entry = await prisma.waitingListEntry.create({
      data: {
        sessionId,
        customerId: user.id,
        seatsRequested,
        position: nextPosition,
        status: "WAITING",
      },
    });

    sendEmail({
      to: email,
      ...waitingListJoinConfirmationEmail({
        customerName: customerInfo.fullName,
        activityTitle: session.workshop.title,
        sessionDate: formatSessionDate(session.startDate),
        position: nextPosition,
        seatsRequested,
      }),
    }).catch((err) => console.error("[joinWaitingList] confirmation email failed:", err));

    return {
      success: true,
      position: nextPosition,
      entryId: entry.id,
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

/**
 * Notify everyone on the waiting list that a spot is available.
 * Called when a reservation is cancelled or a seat frees up.
 * The spot goes to the first person who finalizes their reservation.
 * The link stays valid as long as the session remains bookable (no 2h window).
 */
export async function notifyAllInWaitingList(sessionId) {
  try {
    // Find all WAITING entries
    const waitingEntries = await prisma.waitingListEntry.findMany({
      where: {
        sessionId,
        status: "WAITING",
      },
      orderBy: { position: "asc" },
      include: {
        customer: true,
        session: {
          include: { workshop: true },
        },
      },
    });

    if (waitingEntries.length === 0) {
      return { success: true, notified: 0, message: "Personne en liste d'attente." };
    }

    await prisma.waitingListEntry.updateMany({
      where: {
        sessionId,
        status: "WAITING",
      },
      data: {
        status: "NOTIFIED",
        notifiedAt: new Date(),
      },
    });

    // Send notification email to everyone
    const session = waitingEntries[0].session;
    const sessionDate = new Date(session.startDate).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    for (const entry of waitingEntries) {
      const reservationUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier?activity=${session.workshopId}&session=${sessionId}&priority=true&wl=${entry.id}`;
      const emailTemplate = waitingListNotificationEmail({
        customerName: entry.customer.fullName,
        activityTitle: session.workshop.title,
        sessionDate,
        reservationUrl,
      });

      sendEmail({ to: entry.customer.email, ...emailTemplate }).catch(() => {});
    }

    return {
      success: true,
      notified: waitingEntries.length,
    };
  } catch (error) {
    console.error("[notifyAllInWaitingList]", error?.message || error);
    return { success: false, message: "Erreur lors de la notification." };
  }
}

/**
 * Check if a user is already on the waiting list for a session.
 */
export async function checkWaitingListStatus(sessionId, customerEmail) {
  try {
    if (!sessionId || !customerEmail) return { success: true, data: null };

    const user = await prisma.user.findUnique({
      where: { email: customerEmail.trim().toLowerCase() },
    });

    if (!user) return { success: true, data: null };

    const entry = await prisma.waitingListEntry.findFirst({
      where: {
        sessionId,
        customerId: user.id,
        status: { in: ["WAITING", "NOTIFIED"] },
      },
    });

    if (!entry) return { success: true, data: null };

    return {
      success: true,
      data: {
        id: entry.id,
        position: entry.position,
        status: entry.status,
        expiresAt: entry.expiresAt,
      },
    };
  } catch (error) {
    console.error("[checkWaitingListStatus]", error?.message || error);
    return { success: false, data: null };
  }
}

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

    return { valid: true, entry };
  } catch (error) {
    console.error("[validateWaitingListPriority]", error);
    return { valid: false, message: "Erreur de validation." };
  }
}

/**
 * Mark a waiting list entry as converted after successful reservation.
 */
export async function convertWaitingListEntry(waitingListEntryId, reservationId) {
  try {
    await prisma.waitingListEntry.update({
      where: { id: waitingListEntryId },
      data: {
        status: "CONVERTED",
        convertedToReservationId: reservationId,
      },
    });
    return { success: true };
  } catch (error) {
    console.error("[convertWaitingListEntry]", error);
    return { success: false };
  }
}
