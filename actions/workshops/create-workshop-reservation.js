"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import bcrypt from "bcrypt";
import { notifyAllInWaitingList } from "@/actions/workshops/waiting-list";
import { sendCheckoutVerificationEmail } from "@/actions/shared/send-checkout-verification-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { resolvePromoCode } from "@/actions/promo-codes";
import { isValidVatFormat } from "@/lib/vat-validation";

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
 * WorkshopReservation. Split out from createWorkshopReservation so it can
 * be called a second time — once immediately for an already-verified
 * customer, once later (via resumeCheckoutAfterVerification) after a
 * brand-new guest confirms their email. Safe to call repeatedly; it only
 * ever builds a new Stripe session, no side effects on the reservation row.
 *
 * @param {string} reservationId
 */
export async function createWorkshopReservationCheckoutSession(reservationId) {
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  try {
    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: { select: { id: true, email: true } } },
    });
    if (!reservation) return { success: false, message: "Réservation introuvable." };
    if (reservation.status !== "PENDING_DEPOSIT") {
      return { success: false, message: "Cette réservation n'est plus en attente de paiement." };
    }
    if (reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) {
      return { success: false, message: "Le délai de réservation a expiré. Veuillez recommencer." };
    }

    const { session } = reservation;
    const activity = session.workshop;
    const isFullPayment = Number(reservation.balanceDue) === 0;
    const chargeAmount = isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount);
    const workshopAction = isFullPayment ? "full_payment" : "deposit";

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card", "bancontact"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${activity.title}`,
              description: `${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""} • ${new Date(session.startDate).toLocaleDateString("fr-FR")}`,
            },
            unit_amount: Math.round(chargeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier?canceled=true&activity=${activity.id}&session=${session.id}`,
      customer_email: reservation.customer.email,
      metadata: {
        kind: "workshop",
        workshopAction,
        reservationId: reservation.id,
        sessionId: session.id,
        activityId: activity.id,
        seatsCount: String(reservation.seatsCount),
        totalPrice: String(reservation.totalPrice),
        depositAmount: String(reservation.depositAmount),
        balanceDue: String(reservation.balanceDue),
        customerUserId: reservation.customer.id,
      },
      payment_intent_data: {
        metadata: { kind: "workshop", workshopAction, reservationId: reservation.id },
      },
    });

    return { success: true, url: stripeSession.url, reservationId: reservation.id };
  } catch (error) {
    console.error("[createWorkshopReservationCheckoutSession]", error);
    return { success: false, message: "Erreur lors de la création de la session de paiement." };
  }
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
    const { sessionId, activityId, seatsCount, customerInfo, isPriority, waitingListEntryId, paymentMethod, promoCode } = data;
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

    // Resolve or create user. A brand-new account starts unverified
    // (emailVerified defaults to false) — the gate below defers both the
    // real credentials and Stripe checkout until the person confirms they
    // own this email.
    const email = customerInfo.email.trim().toLowerCase();
    const phone = customerInfo.phone?.trim() || "";
    const vatNumber = customerInfo.vatNumber?.trim() || null;
    if (vatNumber && !isValidVatFormat(vatNumber)) {
      return {
        success: false,
        message: "Numéro de TVA invalide (format attendu : BE0123456789).",
        field: "vatNumber",
      };
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
          vatNumber,
        },
      });
    } else if (vatNumber && user.vatNumber !== vatNumber) {
      // B2B customer supplying (or updating) their VAT number for invoicing —
      // never clear it just because a later booking leaves the field blank.
      user = await prisma.user.update({ where: { id: user.id }, data: { vatNumber } });
    }

    // Calculate pricing
    const depositPct = activity.depositPercentage ?? 50;
    const unitPrice = Number(activity.price);
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
      reservation = await prisma.workshopReservation.findFirst({
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

      // Capacity check + reservation insert as one atomic unit. A plain
      // "aggregate, then create" (the previous shape) lets two concurrent
      // bookings for the last seat(s) both read the same "seats free"
      // snapshot and both succeed — locking the session row first forces the
      // second transaction to wait and recompute against the first one's
      // already-committed seats.
      try {
        reservation = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM workshop_sessions WHERE id = ${sessionId} FOR UPDATE`;

          const reserved = await tx.workshopReservation.aggregate({
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
            throw new Error(`SOLD_OUT:${available}`);
          }

          return tx.workshopReservation.create({
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
            message: `Il ne reste que ${available} place${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""}. Veuillez réduire le nombre de places.`,
          };
        }
        throw err;
      }
    }

    // Brand-new or still-unverified guest: hold the seat, but stop short of
    // Stripe until they confirm the email actually belongs to them. This one
    // is awaited (unlike the later credentials email) — the interstitial we
    // show next promises "check your inbox", so we need to know it actually
    // sent before making that promise.
    if (!user.emailVerified) {
      try {
        await sendCheckoutVerificationEmail({
          email,
          fullName: user.fullName,
          resumeType: "WORKSHOP",
          resumeId: reservation.id,
        });
      } catch (err) {
        console.error("[createWorkshopReservation] verification email failed:", err);
        return { success: false, message: "Impossible d'envoyer l'email de confirmation. Veuillez réessayer." };
      }

      return { success: true, requiresEmailVerification: true, email };
    }

    const checkoutResult = await createWorkshopReservationCheckoutSession(reservation.id);
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
    console.error("[createWorkshopReservation]", error?.message || error, error?.stack || "");
    return {
      success: false,
      message: process.env.NODE_ENV === "development" ? `Erreur: ${error?.message}` : "Erreur lors de la création de la réservation.",
    };
  }
}

// Reservation cancellation now lives in actions/workshops/manage-reservation.js
// (admin-only, enforces the 48h cutoff and never issues a refund).
