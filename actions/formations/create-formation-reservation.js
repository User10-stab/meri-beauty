"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import bcrypt from "bcrypt";
import { sendCheckoutVerificationEmail } from "@/actions/shared/send-checkout-verification-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { resolvePromoCode } from "@/actions/promo-codes";
import { isValidVatFormat, verifyVatWithVies } from "@/lib/vat-validation";

const BCRYPT_SALT_ROUNDS = 12;

// New-hold creation only (not reuse of an existing live hold) — caps how
// many unverified accounts/seat-holds one IP can spin up, since each one
// locks a seat for up to 15 minutes without anyone having proven they own
// that email yet.
const GUEST_HOLD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const GUEST_HOLD_RATE_LIMIT_MAX = 5;

function generateTemporaryPassword() {
  return randomBytes(9).toString("base64url");
}

/**
 * Builds the Stripe Checkout Session for an already-created, still-pending
 * FormationReservation. Split out from createFormationReservation so it can
 * be called a second time — once immediately for an already-verified
 * customer, once later (via resumeCheckoutAfterVerification) after a
 * brand-new guest confirms their email. Safe to call repeatedly; it only
 * ever builds a new Stripe session, no side effects on the reservation row.
 *
 * @param {string} reservationId
 */
export async function createFormationReservationCheckoutSession(reservationId) {
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  try {
    const reservation = await prisma.formationReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { formation: true } }, customer: { select: { id: true, email: true } } },
    });
    if (!reservation) return { success: false, message: "Réservation introuvable." };
    if (reservation.status !== "PENDING_DEPOSIT") {
      return { success: false, message: "Cette réservation n'est plus en attente de paiement." };
    }
    if (reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) {
      return { success: false, message: "Le délai de réservation a expiré. Veuillez recommencer." };
    }

    const { session } = reservation;
    const formation = session.formation;
    const isFullPayment = Number(reservation.balanceDue) === 0;
    const chargeAmount = isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount);
    const formationAction = isFullPayment ? "full_payment" : "deposit";

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see QUESTIONS_FOR_MARIE.md
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${formation.title}`,
              description:
                formation.type === "PRIVATE"
                  ? `Formation individuelle • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`
                  : `${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""} • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`,
            },
            unit_amount: Math.round(chargeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-formation/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-formation?canceled=true&formation=${formation.id}&session=${session.id}`,
      customer_email: reservation.customer.email,
      metadata: {
        kind: "formation",
        formationAction,
        reservationId: reservation.id,
        sessionId: session.id,
        formationId: formation.id,
        seatsCount: String(reservation.seatsCount),
        totalPrice: String(reservation.totalPrice),
        depositAmount: String(reservation.depositAmount),
        balanceDue: String(reservation.balanceDue),
        customerUserId: reservation.customer.id,
      },
      payment_intent_data: {
        metadata: { kind: "formation", formationAction, reservationId: reservation.id },
      },
    });

    return { success: true, url: stripeSession.url, reservationId: reservation.id };
  } catch (error) {
    console.error("[createFormationReservationCheckoutSession]", error);
    return { success: false, message: "Erreur lors de la création de la session de paiement." };
  }
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
    const { sessionId, formationId, customerInfo, paymentMethod, isPriority, waitingListEntryId, promoCode } = data;
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

    // Validate priority access from the waiting list (first come, first served)
    if (isPriority) {
      if (!waitingListEntryId) {
        return { success: false, message: "Accès prioritaire invalide." };
      }
      const wlEntry = await prisma.waitingListEntry.findUnique({ where: { id: waitingListEntryId } });
      if (!wlEntry || wlEntry.formationSessionId !== sessionId || wlEntry.status !== "NOTIFIED") {
        return {
          success: false,
          message: "Votre accès prioritaire n'est plus valide. Réinscrivez-vous sur la liste d'attente.",
        };
      }
    }

    // PRIVATE formations only ever hold one person — the client can't
    // submit a different seat count for these regardless of the form state.
    const seatsCount = formation.type === "PRIVATE" ? 1 : Math.max(1, Number(data.seatsCount) || 1);

    // Resolve or create user. A brand-new account starts unverified
    // (emailVerified defaults to false) — the gate below defers both the
    // real credentials and Stripe checkout until the person confirms they
    // own this email.
    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    const vatNumber = customerInfo.vatNumber?.trim() || null;
    // Never persist a VAT number nobody has confirmed is real — it ends up
    // printed on the invoice as the customer's basis for a tax deduction.
    // Same strict gate as the profile-settings save (updateMyVatNumber):
    // VIES must actively confirm it, a network error/timeout blocks too,
    // not just a confirmed-invalid number. Consistency across every entry
    // point beats the alternative (silently accepting an unconfirmed number
    // whenever VIES happens to be slow) — the customer can just retry.
    let vatNumberToSave = null;
    if (vatNumber) {
      if (!isValidVatFormat(vatNumber)) {
        return {
          success: false,
          message: "Numéro de TVA invalide (format attendu : BE0123456789).",
          field: "vatNumber",
        };
      }
      const viesResult = await verifyVatWithVies(vatNumber);
      if (!viesResult.success) {
        return {
          success: false,
          message: viesResult.message || "Impossible de vérifier ce numéro de TVA pour le moment. Réessayez.",
          field: "vatNumber",
        };
      }
      if (!viesResult.valid) {
        return {
          success: false,
          message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES.",
          field: "vatNumber",
        };
      }
      vatNumberToSave = vatNumber;
    }
    let user = await prisma.user.findUnique({ where: { email } });

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

      // Throwaway placeholder — never shown to anyone. The real, usable
      // password is generated once the email is confirmed (see
      // actions/shared/resume-checkout-after-verification.js).
      const placeholderHash = await bcrypt.hash(generateTemporaryPassword(), BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          fullName: customerInfo.fullName,
          email,
          password: placeholderHash,
          phone: phone || `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: "CUSTOMER",
          vatNumber: vatNumberToSave,
        },
      });
    } else if (vatNumberToSave && user.vatNumber !== vatNumberToSave) {
      // B2B customer supplying (or updating) their VAT number for invoicing —
      // never clear it just because a later booking leaves the field blank.
      user = await prisma.user.update({ where: { id: user.id }, data: { vatNumber: vatNumberToSave } });
    }

    // Calculate pricing
    const depositPct = formation.depositPercentage ?? 50;
    const unitPrice = Number(formation.price);
    const totalPrice = unitPrice * seatsCount;

    // Re-validated here regardless of the client's live preview — never
    // trust a client-computed discount amount.
    let promoCodeId = null;
    let discountAmount = 0;
    if (promoCode) {
      const promoResult = await resolvePromoCode(promoCode, totalPrice);
      if (!promoResult.success) return { success: false, message: promoResult.message };
      promoCodeId = promoResult.promoCodeId;
      discountAmount = promoResult.discountAmount;
    }
    const discountedTotal = Math.max(0, totalPrice - discountAmount);

    const depositAmount = isFullPayment ? discountedTotal : (discountedTotal * depositPct) / 100;
    const balanceDue = discountedTotal - depositAmount;

    // An unverified customer (brand new, or a previous guest checkout that
    // was never confirmed) reuses their still-live hold on this session
    // instead of stacking a second one — otherwise resubmitting the form
    // before confirming would lock a seat twice.
    let reservation = null;
    if (!user.emailVerified) {
      reservation = await prisma.formationReservation.findFirst({
        where: { sessionId, customerId: user.id, status: "PENDING_DEPOSIT", holdExpiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!reservation) {
      // Rate-limited only for a genuinely new hold — reusing a live one
      // above doesn't lock anything additional, so it's exempt. This caps
      // how many seats one IP can hold against unverified emails at once.
      if (!user.emailVerified) {
        const ip = await getClientIp();
        if (isRateLimited("guest-checkout-hold", ip, { windowMs: GUEST_HOLD_RATE_LIMIT_WINDOW_MS, max: GUEST_HOLD_RATE_LIMIT_MAX })) {
          return { success: false, message: "Trop de tentatives. Veuillez réessayer dans quelques minutes." };
        }
        recordRateLimitHit("guest-checkout-hold", ip);
      }

      // Capacity check + reservation insert as one atomic unit — locking the
      // session row first stops two concurrent bookings for the last seat(s)
      // from both reading the same "seats free" snapshot and both succeeding.
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
              totalPrice: discountedTotal,
              depositAmount,
              balanceDue,
              promoCodeId,
              discountAmount,
              status: "PENDING_DEPOSIT",
              holdExpiresAt: new Date(Date.now() + 15 * 60 * 1000), // Expiration dans 15 minutes
            },
          });
        });
      } catch (err) {
        if (typeof err.message === "string" && err.message.startsWith("SOLD_OUT:")) {
          const available = Number(err.message.slice("SOLD_OUT:".length));
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
            message:
              available <= 0
                ? "Cette session est complète."
                : `Il ne reste que ${available} place${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}. Veuillez réduire le nombre de places.`,
          };
        }
        throw err;
      }
    }

    // Brand-new or still-unverified guest: hold the seat, but stop short of
    // Stripe until they confirm the email actually belongs to them. Awaited
    // (unlike the later credentials email) — the interstitial we show next
    // promises "check your inbox", so we need to know it actually sent.
    if (!user.emailVerified) {
      try {
        await sendCheckoutVerificationEmail({
          email,
          fullName: user.fullName,
          resumeType: "FORMATION",
          resumeId: reservation.id,
        });
      } catch (err) {
        console.error("[createFormationReservation] verification email failed:", err);
        return { success: false, message: "Impossible d'envoyer l'email de confirmation. Veuillez réessayer." };
      }

      return { success: true, requiresEmailVerification: true, email };
    }

    const checkoutResult = await createFormationReservationCheckoutSession(reservation.id);
    if (!checkoutResult.success) return checkoutResult;

    return {
      success: true,
      url: checkoutResult.url,
      reservationId: reservation.id,
      temporaryPassword: null,
      isNewUser: false,
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
