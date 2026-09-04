"use server";

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { createResumeCheckoutToken, isCheckoutAuthorized } from "@/lib/resume-checkout-token";
import bcrypt from "bcrypt";
import { sendCheckoutVerificationEmail } from "@/actions/shared/send-checkout-verification-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { resolvePromoCode } from "@/lib/promo-codes";
import { isValidVatFormat, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";
import { validateCustomerIdentity, validateBillingAddress } from "@/lib/validations/customer-identity";
import { captureWarning } from "@/lib/monitoring";
import { confirmWorkshopReservationPayment } from "@/lib/workshops/fulfill-workshop-reservation-payment";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import {
  buildWorkshopReservationCreatedNotification,
  createNotificationsBulk,
  getActivityNotificationRecipients,
} from "@/lib/notifications";
import {
  hasReusableVatValidation,
  repriceTtcCataloguePrice,
  resolveServiceVatPolicy,
} from "@/lib/tax-policy";
import {
  TERMS_CONSENT_REQUIRED_MESSAGE,
  buildTermsAcceptanceUpdate,
  recordTermsAcceptance,
} from "@/lib/terms-consent";

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
export async function createWorkshopReservationCheckoutSession(reservationId, checkoutToken) {
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  try {
    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: { select: { id: true, email: true } } },
    });
    if (!reservation) return { success: false, message: "Réservation introuvable." };

    // Exported "use server" action — a bare reservationId proves nothing.
    // Authorize via a signed checkout token (guest / post-verification resume)
    // or by being signed in as the reservation's customer.
    const authSession = await auth();
    if (
      !isCheckoutAuthorized(reservation, {
        resumeType: "WORKSHOP",
        resumeId: reservationId,
        checkoutToken,
        sessionUserId: authSession?.user?.id,
      })
    ) {
      return { success: false, message: "Vous n'êtes pas autorisé(e) à démarrer le paiement de cette réservation." };
    }
    if (reservation.status !== "PENDING_DEPOSIT") {
      return { success: false, message: "Cette réservation n'est plus en attente de paiement." };
    }
    if (reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) {
      return { success: false, message: "Le délai de réservation a expiré. Veuillez recommencer." };
    }

    if (!(await isSellerLegalDataComplete())) {
      return {
        success: false,
        message: "Le paiement en ligne n'est pas disponible pour le moment. Merci de réessayer plus tard ou de nous contacter.",
      };
    }

    const { session } = reservation;
    const activity = session.workshop;
    const isFullPayment = Number(reservation.balanceDue) === 0;
    const chargeAmount = isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount);
    const workshopAction = isFullPayment ? "full_payment" : "deposit";

    // A 100%-off promo code can bring the amount due today to exactly 0 —
    // Stripe rejects a 0-value Checkout Session, so there's nothing to
    // actually charge. Confirm directly through the same fulfilment path a
    // real payment webhook uses (a synthetic "session" shaped just enough
    // for it to read), instead of forking a second, parallel implementation.
    if (chargeAmount <= 0) {
      const syntheticSession = {
        id: `free_workshop_${reservation.id}`,
        metadata: { kind: "workshop", workshopAction, reservationId: reservation.id },
        amount_total: 0,
        payment_intent: null,
      };
      await confirmWorkshopReservationPayment(syntheticSession);
      return { success: true, url: null, freeReservation: true, reservationId: reservation.id };
    }

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see docs/QUESTIONS_FOR_MARIE.md
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `${isFullPayment ? "Paiement total" : "Acompte"} - ${activity.title}`,
              description: `${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""} • ${new Date(session.startDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`,
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
    if (!Number.isInteger(capacity) || capacity < 1) {
      return { success: false, message: "Capacité de session invalide." };
    }
    const available = capacity - takenSeats;

    // This is a plain read, called on every /reservation-atelier page load —
    // it used to mass-email the entire waiting list (and re-mark everyone
    // NOTIFIED) any time available > 0, regardless of whether a seat had
    // actually just freed up. Notifying belongs on the real seat-freeing
    // events instead (cancellation, refund, session change — see
    // notifyAllInWaitingList's call sites), same as formations already do.

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
    let { sessionId, activityId, seatsCount, customerInfo, isPriority, waitingListEntryId, paymentMethod, promoCode } = data;
    const isFullPayment = paymentMethod === "FULL";

    const parsedSeatsCount = Number(seatsCount);
    if (!sessionId || !activityId || !customerInfo || !Number.isInteger(parsedSeatsCount) || parsedSeatsCount < 1) {
      return { success: false, message: "Données manquantes." };
    }
    seatsCount = parsedSeatsCount;

    // The booking form's CGV checkbox was client-side only. This action is a
    // public POST endpoint, so the consent has to be re-established here —
    // it is also what gets persisted onto the customer below.
    if (data?.termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
    }

    // A connected customer's account is the source of truth for their name
    // and email. The checkout only asks for a phone when the account does not
    // already have one; a browser-modified name/email must never replace the
    // account identity used by the reservation.
    const authSession = await auth();
    let authenticatedUser = null;
    if (authSession?.user?.id) {
      authenticatedUser = await prisma.user.findFirst({
        where: { id: authSession.user.id, isDeleted: false, isActive: true },
      });
      if (!authenticatedUser) {
        return { success: false, message: "Votre session n'est plus valide. Veuillez vous reconnecter." };
      }
      const storedPhone = authenticatedUser.phone?.startsWith("temp-") ? "" : (authenticatedUser.phone ?? "");
      customerInfo = {
        ...customerInfo,
        fullName: authenticatedUser.fullName,
        email: authenticatedUser.email,
        phone: storedPhone || customerInfo.phone,
      };
    }

    // This action can be called without the browser form and creates both a
    // customer account and a seat hold, so validate the payload here too.
    const customerValidation = validateCustomerIdentity(customerInfo, { requirePhone: true });
    if (!customerValidation.success) {
      return { success: false, field: customerValidation.field, message: customerValidation.message };
    }
    customerInfo = { ...customerInfo, ...customerValidation.data };

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
        include: { customer: { select: { email: true } } },
      });
      if (
        !wlEntry ||
        wlEntry.sessionId !== sessionId ||
        wlEntry.status !== "NOTIFIED" ||
        wlEntry.customer.email.toLowerCase() !== customerInfo.email.trim().toLowerCase()
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
    const vatNumber = customerInfo.vatNumber?.trim() ? normalizeVatNumber(customerInfo.vatNumber) : null;
    let user = authenticatedUser ?? await prisma.user.findFirst({ where: { email, isDeleted: false } });
    // Never persist a VAT number nobody has confirmed is real — it ends up
    // printed on the invoice as the customer's basis for a tax deduction.
    // Same strict gate as the profile-settings save (updateMyVatNumber):
    // VIES must actively confirm it, a network error/timeout blocks too,
    // not just a confirmed-invalid number. Consistency across every entry
    // point beats the alternative (silently accepting an unconfirmed number
    // whenever VIES happens to be slow) — the customer can just retry.
    let vatNumberToSave = null;
    // Captured alongside the number itself. lib/tax-policy.js decides
    // reverse-charge from vatValidatedAt, so storing the number without its
    // proof threw away the VIES call made two lines below and left a
    // genuinely verified B2B customer taxed as if unverified — or, when the
    // account already had an older validation, let the new number inherit the
    // previous number's timestamp. Mirrors actions/auth/register.js.
    let vatValidation = null;
    if (vatNumber) {
      if (!isValidVatFormat(vatNumber)) {
        return {
          success: false,
          message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…).",
          field: "vatNumber",
        };
      }
      vatNumberToSave = vatNumber;
      if (!hasReusableVatValidation(user, vatNumber)) {
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
        vatValidation = {
          vatValidatedAt: new Date(),
          vatValidationName: viesResult.name ?? null,
          vatValidationAddress: viesResult.address ?? null,
        };
      }
    }

    const needsPhoneBackfill = Boolean(authenticatedUser)
      && (!authenticatedUser.phone || authenticatedUser.phone.startsWith("temp-"));
    if (needsPhoneBackfill) {
      const phoneExists = await prisma.user.findFirst({
        where: { phone, isDeleted: false, NOT: { id: authenticatedUser.id } },
      });
      if (phoneExists) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà associé à un autre compte.",
          field: "phone",
        };
      }
      user = await prisma.user.update({ where: { id: authenticatedUser.id }, data: { phone } });
    }

    if (!user) {
      const phoneExists = await prisma.user.findFirst({ where: { phone, isDeleted: false } });
      if (phoneExists) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà associé à un autre compte. Veuillez en utiliser un autre ou vous connecter.",
          field: "phone",
        };
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
          phone,
          role: "CUSTOMER",
          isCompany: Boolean(vatNumberToSave),
          vatNumber: vatNumberToSave,
          ...(vatValidation ?? {}),
          ...buildTermsAcceptanceUpdate(),
        },
      });
    } else if (vatNumberToSave && (user.vatNumber !== vatNumberToSave || !user.isCompany || vatValidation)) {
      // B2B customer supplying (or updating) their VAT number for invoicing —
      // never clear it just because a later booking leaves the field blank.
      // The number and its VIES proof are always written together.
      user = await prisma.user.update({
        where: { id: user.id },
        data: { isCompany: true, vatNumber: vatNumberToSave, ...(vatValidation ?? {}) },
      });
    }

    // A booking that will be invoiced as B2B needs a billing address on file
    // — issueInvoice's assertBuyerLegalDataComplete (lib/invoicing.js) throws
    // BUYER_LEGAL_DATA_INCOMPLETE without one, and guest checkout here never
    // asked for one (unlike registration, which has required it for a
    // while — see the User.addressLine1 field comment). Confirmed bug (F1):
    // a full-price B2B guest booking used to charge the card via Stripe
    // Checkout and then roll back this entire transaction on that throw,
    // leaving a captured payment with no Payment row at all. Gated on
    // vatNumberToSave (not just "isFullPayment") because the same throw
    // hits later, unattended moments too — settling a deposit's balance in
    // the salon, or invoicing a forfeited deposit on cancellation.
    if (vatNumberToSave && !user.addressLine1) {
      const addressValidation = validateBillingAddress(customerInfo);
      if (!addressValidation.success) {
        return {
          success: false,
          field: addressValidation.field,
          message: `${addressValidation.message} Elle est obligatoire pour une réservation avec numéro de TVA.`,
        };
      }
      user = await prisma.user.update({ where: { id: user.id }, data: addressValidation.data });
    }

    // Returning customer, or an account predating consent tracking.
    await recordTermsAcceptance(prisma, user.id);

    // Calculate pricing
    const rawDepositPct = Number(activity.depositPercentage ?? 50);
    const depositPct = Number.isFinite(rawDepositPct) ? Math.min(100, Math.max(0, rawDepositPct)) : 0;
    const vatPolicy = resolveServiceVatPolicy({ customer: user });
    const catalogueUnitPrice = Number(activity.price);
    const unitPrice = repriceTtcCataloguePrice(catalogueUnitPrice, vatPolicy.vatRate);
    const totalPrice = unitPrice * seatsCount;

    // Re-validated here regardless of the client's live preview — never
    // trust a client-computed discount amount.
    let promoCodeId = null;
    let discountAmount = 0;
    let promoMaxUses = null;
    if (promoCode) {
      const promoResult = await resolvePromoCode(promoCode, totalPrice);
      if (!promoResult.success) return { success: false, message: promoResult.message };
      promoCodeId = promoResult.promoCodeId;
      discountAmount = promoResult.discountAmount;
      promoMaxUses = promoResult.maxUses;
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
          if (!Number.isInteger(capacity) || capacity < 1) {
            throw new Error("INVALID_SESSION_CAPACITY");
          }
          const available = capacity - takenSeats;

          if (seatsCount > available) {
            throw new Error(`SOLD_OUT:${available}`);
          }

          // Atomic conditional claim — only succeeds while usedCount is
          // still under the cap captured moments ago at resolvePromoCode
          // time. Two concurrent bookings racing the last use of a capped
          // code can't both win: the loser's WHERE clause matches zero rows.
          if (promoCodeId && promoMaxUses != null) {
            const claim = await tx.promoCode.updateMany({
              where: { id: promoCodeId, usedCount: { lt: promoMaxUses } },
              data: { usedCount: { increment: 1 } },
            });
            if (claim.count === 0) throw new Error("PROMO_EXHAUSTED");
          } else if (promoCodeId) {
            await tx.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } });
          }

          const created = await tx.workshopReservation.create({
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

          const recipientIds = await getActivityNotificationRecipients(
            session.animatorId,
            STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
            { tx }
          );
          if (recipientIds.length > 0) {
            await createNotificationsBulk(
              recipientIds.map((userId) =>
                buildWorkshopReservationCreatedNotification({
                  userId,
                  reservationId: created.id,
                  customerName: user.fullName,
                  activityTitle: activity.title,
                  seatsCount,
                })
              ),
              { tx }
            );
          }

          return created;
        });
      } catch (err) {
        if (typeof err.message === "string" && err.message.startsWith("SOLD_OUT:")) {
          const available = Number(err.message.slice("SOLD_OUT:".length));
          captureWarning("Workshop session sold out during checkout", { area: "stock-capacity", sessionId, available });
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
        if (err.message === "PROMO_EXHAUSTED") {
          captureWarning("Promo code usage cap lost during checkout", { area: "promo-codes" });
          return { success: false, message: "Ce code promo vient d'atteindre sa limite d'utilisation." };
        }
        if (err.message === "INVALID_SESSION_CAPACITY") {
          captureWarning("Workshop session has invalid capacity during checkout", { area: "stock-capacity", sessionId });
          return { success: false, message: "Capacité de session invalide. Contactez l'équipe Meri Beauty." };
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

    // Also handed back to the client below so it can prove authorization on
    // this reservation to convertWaitingListEntry — that action is a public
    // "use server" endpoint with no session for a guest booking, so a bare
    // waitingListEntryId/reservationId pair proves nothing on its own (see
    // isCheckoutAuthorized's doc comment).
    const checkoutToken = createResumeCheckoutToken({ resumeType: "WORKSHOP", resumeId: reservation.id, email });
    const checkoutResult = await createWorkshopReservationCheckoutSession(reservation.id, checkoutToken);
    if (!checkoutResult.success) return checkoutResult;

    return {
      success: true,
      url: checkoutResult.url,
      reservationId: reservation.id,
      checkoutToken,
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
