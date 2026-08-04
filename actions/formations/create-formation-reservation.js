"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import bcrypt from "bcrypt";
import { sendEmail } from "@/lib/email";
import { welcomeWithCredentialsEmail } from "@/lib/email-templates";

const BCRYPT_SALT_ROUNDS = 12;

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

export async function checkFormationSessionAvailability(sessionId) {
  try {
    const session = await prisma.formationSession.findUnique({
      where: { id: sessionId },
      include: { formation: true },
    });

    if (!session) return { success: false, message: "Session introuvable." };

    const reserved = await prisma.formationReservation.aggregate({
      where: {
        sessionId,
        OR: [
          { status: { in: ["CONFIRMED", "COMPLETED"] } },
          {
            status: "PENDING_DEPOSIT",
            OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
          },
        ],
      },
      _sum: { seatsCount: true },
    });

    const takenSeats = reserved._sum.seatsCount ?? 0;
    const capacity = session.capacity ?? session.formation.capacity;
    const available = capacity - takenSeats;

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
    console.error("[checkFormationSessionAvailability]", error);
    return { success: false, message: "Erreur de vérification des places." };
  }
}

export async function createFormationReservation(data) {
  try {
    const { sessionId, formationId, customerInfo, paymentMethod } = data;
    const isFullPayment = paymentMethod === "FULL";

    if (!sessionId || !formationId || !customerInfo?.email) {
      return { success: false, message: "Données manquantes." };
    }

    const formation = await prisma.formation.findUnique({
      where: { id: formationId },
      include: { sessions: { where: { id: sessionId } } },
    });

    if (!formation || formation.status !== "PUBLISHED") {
      return { success: false, message: "Formation introuvable ou non publiée." };
    }

    const session = formation.sessions[0];
    if (!session || session.status !== "SCHEDULED") {
      return { success: false, message: "Session non disponible." };
    }

    // PRIVATE formations only ever hold one person — the client can't
    // submit a different seat count for these regardless of the form state.
    const seatsCount = formation.type === "PRIVATE" ? 1 : Math.max(1, Number(data.seatsCount) || 1);

    // Resolve or create user
    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    let user = await prisma.user.findUnique({ where: { email } });

    let temporaryPassword = null;

    if (!user) {
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
    const depositPct = formation.depositPercentage ?? 30;
    const unitPrice = Number(formation.price);
    const totalPrice = unitPrice * seatsCount;
    const depositAmount = isFullPayment ? totalPrice : (totalPrice * depositPct) / 100;
    const balanceDue = totalPrice - depositAmount;
    const chargeAmount = isFullPayment ? totalPrice : depositAmount;
    const formationAction = isFullPayment ? "full_payment" : "deposit";

    // Capacity check + reservation insert as one atomic unit — locking the
    // session row first stops two concurrent bookings for the last seat(s)
    // from both reading the same "seats free" snapshot and both succeeding.
    let reservation;
    try {
      reservation = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM formation_sessions WHERE id = ${sessionId} FOR UPDATE`;

        const reserved = await tx.formationReservation.aggregate({
          where: {
            sessionId,
            OR: [
              { status: { in: ["CONFIRMED", "COMPLETED"] } },
              {
                status: "PENDING_DEPOSIT",
                OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }],
              },
            ],
          },
          _sum: { seatsCount: true },
        });

        const takenSeats = reserved._sum.seatsCount ?? 0;
        const capacity = session.capacity ?? formation.capacity;
        const available = capacity - takenSeats;

        if (seatsCount > available) {
          throw new Error(`SOLD_OUT:${available}`);
        }

        return tx.formationReservation.create({
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
      });
    } catch (err) {
      if (typeof err.message === "string" && err.message.startsWith("SOLD_OUT:")) {
        const available = Number(err.message.slice("SOLD_OUT:".length));
        return {
          success: false,
          message:
            available <= 0
              ? "Cette session est complète."
              : `Il ne reste que ${available} place${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}. Veuillez réduire le nombre de places.`,
        };
      }
      throw err;
    }

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "bancontact"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${formation.title}`,
              description:
                formation.type === "PRIVATE"
                  ? `Formation individuelle • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`
                  : `${seatsCount} place${seatsCount > 1 ? "s" : ""} • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`,
            },
            unit_amount: Math.round(chargeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-formation/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-formation?canceled=true&formation=${formationId}&session=${sessionId}`,
      customer_email: email,
      metadata: {
        kind: "formation",
        formationAction,
        reservationId: reservation.id,
        sessionId,
        formationId: formation.id,
        seatsCount: String(seatsCount),
        totalPrice: String(totalPrice),
        depositAmount: String(depositAmount),
        balanceDue: String(balanceDue),
        customerUserId: user.id,
      },
      payment_intent_data: {
        metadata: {
          kind: "formation",
          formationAction,
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
    console.error("[createFormationReservation]", error?.message || error, error?.stack || "");
    return {
      success: false,
      message: process.env.NODE_ENV === "development" ? `Erreur: ${error?.message}` : "Erreur lors de la création de la réservation.",
    };
  }
}
