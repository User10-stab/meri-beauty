"use server";

import { randomBytes } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import {
  reservationReceivedEmail,
  welcomeWithCredentialsEmail,
} from "@/lib/email-templates";
import { buildNewsletterConsentUpdate } from "@/lib/newsletter-consent";

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
 * Creates an appointment (no payment record at this stage).
 *
 * Behaviour:
 *  - If customerInfo.userId is provided (authenticated session), uses that user directly.
 *  - Otherwise finds an existing user by email, or creates a new CUSTOMER account.
 *  - For new accounts: generates + hashes a temporary password, sends a welcome email
 *    with credentials, and returns { temporaryPassword, email } so the client can
 *    call signIn() and auto-authenticate the customer.
 *  - Creates appointment with status PENDING (waiting for salon confirmation).
 *  - Sends a "reservation received" email to the customer (fire-and-forget).
 *  - NO payment record is created at this stage.
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
 *   notes?: string,
 * }} data
 */
export async function createAppointment(data) {
  try {
    const session = await auth();
    const { staffServiceId, date, time, customerInfo, notes } = data;

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!staffServiceId || !date || !time || !customerInfo) {
      return { success: false, message: "Données manquantes" };
    }

    // ── 2. Load staff service ────────────────────────────────────────────────
    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: true,
        staff: { include: { user: { select: { fullName: true } } } },
      },
    });

    if (!staffService) {
      return { success: false, message: "Service introuvable" };
    }

    // ── 3. Build appointment times ───────────────────────────────────────────
    const [hour, minute] = time.split(":").map(Number);
    const appointmentDate = new Date(date);
    appointmentDate.setHours(0, 0, 0, 0); // date-only — no time component

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
      return { success: false, message: "Ce créneau n'est plus disponible" };
    }

    // ── 5. Resolve or create the customer user ───────────────────────────────
    let user = null;
    let isNewUser = false;
    let temporaryPassword = null; // only set for brand-new accounts

    if (session?.user?.id) {
      // Authenticated session — always use the session's own id, never the
      // client-supplied customerInfo.userId (that was a trust-the-client
      // IDOR: any logged-in customer could pass a victim's id and book
      // appointments under their account).
      user = await prisma.user.findUnique({
        where: { id: session.user.id, isDeleted: false },
      });

      if (!user) {
        return {
          success: false,
          message: "Compte introuvable. Veuillez vous reconnecter.",
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
            ...buildNewsletterConsentUpdate(customerInfo.newsletterSubscribed ?? false, "appointment_booking"),
          },
        });

        isNewUser = true;
      }
    }

    // ── 6. Create appointment with PENDING status ─────────────────────────────
    const appointment = await prisma.appointment.create({
      data: {
        userId: user.id,
        staffServiceId,
        staffId: staffService.staffId,
        date: appointmentDate,
        startTime,
        endTime,
        status: "PENDING", // Waiting for salon confirmation
        notes: notes || null,
      },
      include: {
        staffService: {
          include: {
            service: true,
            staff: { include: { user: { select: { fullName: true } } } },
          },
        },
      },
    });

    // ── 7. Send emails (fire-and-forget — never block the reservation) ───────
    const staffName = staffService.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService.service?.name ?? "votre service";

    // 7a. Reservation received — sent to all customers
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
      console.error("[createAppointment] reservation received email failed:", err)
    );

    // 7b. Welcome email with credentials — only for brand-new accounts
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
        console.error("[createAppointment] welcome email failed:", err)
      );
    }

    // ── 8. Return result ─────────────────────────────────────────────────────
    return {
      success: true,
      message: "Réservation créée avec succès",
      data: {
        appointment,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
        isNewUser,
        // Only returned for new accounts so the client can call signIn()
        newUserCredentials: isNewUser
          ? { email: user.email, password: temporaryPassword }
          : null,
      },
    };
  } catch (error) {
    console.error("[createAppointment]", error);
    return {
      success: false,
      message: "Erreur lors de la création de la réservation",
    };
  }
}
