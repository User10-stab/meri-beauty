"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail } from "@/lib/email-templates";
import { notifyAllInWaitingList } from "@/actions/workshops/waiting-list";

const BCRYPT_SALT_ROUNDS = 12;

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

export async function checkWorkshopSessionAvailability(sessionId) {
  try {
    const session = await prisma.workshopSession.findUnique({
      where: { id: sessionId },
      include: { workshop: true },
    });

    if (!session) return { success: false, message: "Session introuvable." };

    const reserved = await prisma.workshopReservation.aggregate({
      where: {
        sessionId,
        OR: [
          { status: { in: ["CONFIRMED", "COMPLETED"] } },
          {
            status: "PENDING_DEPOSIT",
            OR: [
              { holdExpiresAt: null },
              { holdExpiresAt: { gt: new Date() } }
            ]
          }
        ]
      },
      _sum: { seatsCount: true },
    });

    const takenSeats = reserved._sum.seatsCount ?? 0;
    const capacity = session.capacity ?? session.workshop.capacity;
    const available = capacity - takenSeats;

    // If spots are available, notify everyone on the waiting list
    if (available > 0) {
      notifyAllInWaitingList(sessionId).catch(() => {});
    }

    return {
      success: true,
      data: {
        available,
        capacity,
        takenSeats,
        session: {
          id: session.id,
          startDate: session.startDate,
          endDate: session.endDate,
        },
      },
    };
  } catch (error) {
    console.error("[checkWorkshopSessionAvailability]", error);
    return { success: false, message: "Erreur de vérification des places." };
  }
}

export async function createWorkshopReservation(data) {
  try {
    const { sessionId, activityId, seatsCount, customerInfo, isPriority, waitingListEntryId, paymentMethod } = data;
    const isFullPayment = paymentMethod === "FULL";

    if (!sessionId || !activityId || !seatsCount || !customerInfo?.email) {
      return { success: false, message: "Données manquantes." };
    }

    // Load activity + session
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
      include: { sessions: { where: { id: sessionId } } },
    });

    if (!activity || activity.status !== "PUBLISHED") {
      return { success: false, message: "Activité introuvable ou non publiée." };
    }

    const session = activity.sessions[0];
    if (!session || session.status !== "SCHEDULED") {
      return { success: false, message: "Session non disponible." };
    }

    // Validate priority access from the waiting list (first come, first served)
    if (isPriority) {
      if (!waitingListEntryId) {
        return { success: false, message: "Accès prioritaire invalide." };
      }
      const wlEntry = await prisma.waitingListEntry.findUnique({
        where: { id: waitingListEntryId },
      });
      if (
        !wlEntry ||
        wlEntry.sessionId !== sessionId ||
        wlEntry.status !== "NOTIFIED"
      ) {
        return {
          success: false,
          message: "Votre accès prioritaire n'est plus valide. Réinscrivez-vous sur la liste d'attente.",
        };
      }
    }

    // Check available capacity (also applies to priority access so the
    // fastest person to reserve wins the freed spot without overselling)
    const reserved = await prisma.workshopReservation.aggregate({
      where: {
        sessionId,
        OR: [
          { status: { in: ["CONFIRMED", "COMPLETED"] } },
          {
            status: "PENDING_DEPOSIT",
            OR: [
              { holdExpiresAt: null },
              { holdExpiresAt: { gt: new Date() } }
            ]
          }
        ]
      },
      _sum: { seatsCount: true },
    });

    const takenSeats = reserved._sum.seatsCount ?? 0;
    const capacity = session.capacity ?? activity.capacity;
    const available = capacity - takenSeats;

    if (seatsCount > available) {
      // A priority user who lost the race goes back on the waiting list
      if (isPriority && waitingListEntryId) {
        await prisma.waitingListEntry.updateMany({
          where: { id: waitingListEntryId, status: "NOTIFIED" },
          data: { status: "WAITING", notifiedAt: null, expiresAt: null },
        });
        return {
          success: false,
          message: "La place vient d'être réservée par une autre personne avant vous. Vous restez sur la liste d'attente et serez renotifié(e) si une nouvelle place se libère.",
        };
      }
      return {
        success: false,
        message: `Il ne reste que ${available} place${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}. Veuillez réduire le nombre de places.`,
      };
    }

    // Resolve or create user
    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    let user = await prisma.user.findUnique({ where: { email } });

    let temporaryPassword = null;

    if (!user) {
      // Check phone uniqueness if a phone is provided
      if (phone) {
        const phoneExists = await prisma.user.findUnique({ where: { phone } });
        if (phoneExists) {
          return {
            success: false,
            message: "Ce numéro de téléphone est déjà associé à un autre compte. Veuillez en utiliser un autre ou vous connecter.",
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

      // Send welcome email with credentials
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://meribeauty.com"}/login`;
      const emailTemplate = welcomeWithCredentialsEmail({
        customerName: customerInfo.fullName,
        email,
        temporaryPassword,
        loginUrl,
      });
      sendEmail({ to: email, ...emailTemplate }).catch(() => {});
    }

    // Calculate pricing
    const depositPct = activity.depositPercentage ?? 50;
    const unitPrice = Number(activity.price);
    const totalPrice = unitPrice * seatsCount;
    const depositAmount = isFullPayment ? totalPrice : (totalPrice * depositPct) / 100;
    const balanceDue = totalPrice - depositAmount;
    const chargeAmount = isFullPayment ? totalPrice : depositAmount;
    const workshopAction = isFullPayment ? "full_payment" : "deposit";

    // Create reservation record
    const reservation = await prisma.workshopReservation.create({
      data: {
        sessionId,
        customerId: user.id,
        seatsCount,
        totalPrice,
        depositAmount,
        balanceDue,
        status: "PENDING_DEPOSIT",
        holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // Expiration dans 15 minutes
      },
    });

    // Create Stripe Checkout Session for the deposit or the full amount
    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${activity.title}`,
              description: `${seatsCount} place${seatsCount > 1 ? "s" : ""} • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`,
            },
            unit_amount: Math.round(chargeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier?canceled=true&activity=${activityId}&session=${sessionId}`,
      customer_email: email,
      metadata: {
        kind: "workshop",
        workshopAction,
        reservationId: reservation.id,
        sessionId,
        activityId: activity.id,
        seatsCount: String(seatsCount),
        totalPrice: String(totalPrice),
        depositAmount: String(depositAmount),
        balanceDue: String(balanceDue),
        customerUserId: user.id,
      },
      payment_intent_data: {
        metadata: {
          kind: "workshop",
          workshopAction,
          reservationId: reservation.id,
        },
      },
    });

    return {
      success: true,
      url: stripeSession.url,
      reservationId: reservation.id,
      temporaryPassword,
      isNewUser: !!temporaryPassword,
      email,
    };
  } catch (error) {
    console.error("[createWorkshopReservation]", error?.message || error, error?.stack || "");
    return {
      success: false,
      message: process.env.NODE_ENV === "development" ? `Erreur: ${error?.message}` : "Erreur lors de la création de la réservation.",
    };
  }
}

// Reservation cancellation now lives in actions/workshops/manage-reservation.js
// (admin-only, enforces the 48h cutoff and never issues a refund).
