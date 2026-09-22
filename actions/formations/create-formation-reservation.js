"use server";

import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { auth } from "@/auth";
import { createResumeCheckoutToken, isCheckoutAuthorized } from "@/lib/resume-checkout-token";
import bcrypt from "bcrypt";
import { sendCheckoutVerificationEmail } from "@/actions/shared/send-checkout-verification-email";
import { getClientIp, isRateLimited, recordRateLimitHit } from "@/lib/rate-limit";
import { resolvePromoCode } from "@/lib/promo-codes";
import { isValidVatFormat, isViesOutage, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";
import { validateCustomerIdentity, validateBillingAddress } from "@/lib/validations/customer-identity";
import { captureWarning } from "@/lib/monitoring";
import { confirmFormationReservationPayment } from "@/lib/formations/fulfill-formation-reservation-payment";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { resolvePayeeForFormationSession, payeeCanChargeOnline, payeeCheckoutMetadata, payeeStripeOptions, PAYEE_ONLINE_UNAVAILABLE_MESSAGE } from "@/lib/payments/resolve-payee";
import { isAdminRole, STAFF_PERMISSIONS } from "@/lib/authorization";
import { OCCUPANCY_KINDS, sessionOccupancy } from "@/lib/reservations/session-occupancy";
import { RELANCE_KINDS, buildActivityCheckoutParams } from "@/lib/reservations/activity-payment-relance";
import {
  buildFormationReservationCreatedNotification,
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
import { validatePassword } from "@/lib/validations/password";

const BCRYPT_SALT_ROUNDS = 12;

// New-hold creation only (not reuse of an existing live hold) — caps how
// many unverified accounts/seat-holds one IP can spin up, since each one
// locks a seat for up to 15 minutes without anyone having proven they own
// that email yet.
const GUEST_HOLD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const GUEST_HOLD_RATE_LIMIT_MAX = 5;

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
export async function createFormationReservationCheckoutSession(reservationId, checkoutToken) {
  if (!reservationId) return { success: false, message: "Identifiant de réservation manquant." };

  try {
    const reservation = await prisma.formationReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { formation: true } }, customer: { select: { id: true, email: true } } },
    });
    if (!reservation) return { success: false, message: "Réservation introuvable." };

    // Exported "use server" action — a bare reservationId proves nothing.
    // Authorize via a signed checkout token (guest / post-verification resume)
    // or by being signed in as the reservation's customer.
    const authSession = await auth();
    if (
      !isCheckoutAuthorized(reservation, {
        resumeType: "FORMATION",
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

    const { session } = reservation;

    // Whose money this seat is: the session's animator when she is an
    // independent (charged on her own Stripe account), otherwise the salon.
    // Frozen into the Checkout Session's metadata so the webhook attributes
    // the Payment to the account the charge was actually made on.
    const payee = await resolvePayeeForFormationSession(prisma, { sessionId: session.id });
    if (!payeeCanChargeOnline(payee)) {
      return { success: false, message: PAYEE_ONLINE_UNAVAILABLE_MESSAGE };
    }
    // The salon's legal identity only gates a sale the salon invoices.
    if (!payee.staff && !(await isSellerLegalDataComplete())) {
      return {
        success: false,
        message: "Le paiement en ligne n'est pas disponible pour le moment. Merci de réessayer plus tard ou de nous contacter.",
      };
    }

    const isFullPayment = Number(reservation.balanceDue) === 0;
    const chargeAmount = isFullPayment ? Number(reservation.totalPrice) : Number(reservation.depositAmount);
    const formationAction = isFullPayment ? "full_payment" : "deposit";

    // A 100%-off promo code can bring the amount due today to exactly 0 —
    // Stripe rejects a 0-value Checkout Session, so there's nothing to
    // actually charge. Confirm directly through the same fulfilment path a
    // real payment webhook uses (a synthetic "session" shaped just enough
    // for it to read), instead of forking a second, parallel implementation.
    if (chargeAmount <= 0) {
      const syntheticSession = {
        id: `free_formation_${reservation.id}`,
        metadata: { kind: "formation", formationAction, reservationId: reservation.id, ...payeeCheckoutMetadata(payee) },
        amount_total: 0,
        payment_intent: null,
      };
      await confirmFormationReservationPayment(syntheticSession);
      return { success: true, url: null, freeReservation: true, reservationId: reservation.id };
    }

    let stripeSession;
    try {
      stripeSession = await stripe.checkout.sessions.create(
        buildActivityCheckoutParams(RELANCE_KINDS.FORMATION, reservation, { payee }),
        payeeStripeOptions(payee)
      );
    } catch (error) {
      // No checkout exists, so the client cannot pay this hold — release the
      // seat now instead of leaving it looking booked until the hold lapses.
      await prisma.formationReservation
        .updateMany({
          where: { id: reservation.id, status: "PENDING_DEPOSIT", payment: { is: null } },
          data: { status: "CANCELLED", cancelledAt: new Date(), holdExpiresAt: new Date() },
        })
        .catch((releaseError) => console.error("[checkout] failed to release unpaid hold", reservation.id, releaseError));
      throw error;
    }

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

    const takenSeats = await sessionOccupancy(prisma, {
      kind: OCCUPANCY_KINDS.FORMATION,
      sessionId,
    });
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
    let { sessionId, formationId, customerInfo, paymentMethod, isPriority, waitingListEntryId, promoCode } = data;
    const isFullPayment = paymentMethod === "FULL";

    if (!sessionId || !formationId || !customerInfo) {
      return { success: false, message: "Données manquantes." };
    }

    // The booking form's CGV checkbox was client-side only. This action is a
    // public POST endpoint, so the consent has to be re-established here —
    // it is also what gets persisted onto the customer below.
    if (data?.termsAccepted !== true) {
      return { success: false, message: TERMS_CONSENT_REQUIRED_MESSAGE };
    }

    const authSession = await auth();
    let authenticatedUser = null;
    if (authSession?.user?.id) {
      authenticatedUser = await prisma.user.findFirst({
        where: { id: authSession.user.id, isDeleted: false, isActive: true },
      });
      if (!authenticatedUser) {
        return { success: false, message: "Votre session n'est plus valide. Veuillez vous reconnecter." };
      }
      // Only apply the session override for CUSTOMER accounts. Admin/Owner/Staff
      // users can create reservations on behalf of a client — in that case the
      // form's customerInfo holds the *client's* data and must not be replaced
      // with the logged-in staff member's own name/email.
      if (!isAdminRole(authenticatedUser.role) && authenticatedUser.role !== "STAFF") {
        const storedPhone = authenticatedUser.phone?.startsWith("temp-") ? "" : (authenticatedUser.phone ?? "");
        customerInfo = {
          ...customerInfo,
          fullName: authenticatedUser.fullName,
          email: authenticatedUser.email,
          phone: storedPhone || customerInfo.phone,
        };
      }
    }

    const customerValidation = validateCustomerIdentity(customerInfo, { requirePhone: true });
    if (!customerValidation.success) {
      return { success: false, field: customerValidation.field, message: customerValidation.message };
    }
    customerInfo = { ...customerInfo, ...customerValidation.data };

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

    // Refused here, before a seat is held, rather than only at checkout.
    //
    // The gate also lives in create{Formation,Workshop}ReservationCheckoutSession
    // — it has to, because a resumed checkout from an e-mailed link enters
    // there directly. But that call happens *after* this action has created the
    // hold, and its refusal leaves the hold behind: an unpayable PENDING_DEPOSIT
    // row that occupies the place for the full 24 h window. Every visitor who
    // tried would eat another seat, so a session animated by an independent who
    // has not finished onboarding (Lyly today) would quietly fill up with holds
    // nobody can pay. Checking before anything is written costs one query and
    // makes the refusal free of side effects.
    if (!payeeCanChargeOnline(await resolvePayeeForFormationSession(prisma, { sessionId: session.id }))) {
      return { success: false, message: PAYEE_ONLINE_UNAVAILABLE_MESSAGE };
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
        wlEntry.formationSessionId !== sessionId ||
        wlEntry.status !== "NOTIFIED" ||
        wlEntry.customer.email.toLowerCase() !== customerInfo.email.trim().toLowerCase()
      ) {
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
    const vatNumber = customerInfo.vatNumber?.trim() ? normalizeVatNumber(customerInfo.vatNumber) : null;
    let user = authenticatedUser ?? await prisma.user.findFirst({ where: { email, isDeleted: false } });
    // Never persist a VAT number VIES has actively rejected — a confirmed
    // "not registered" answer, or a bad format, still blocks the booking.
    // While VIES itself is unreachable (isViesOutage), a well-formed number
    // is accepted provisionally so the booking still completes; tax then
    // follows the country code (BE 21%, foreign-EU 0%) and VIES re-checks on
    // the customer's next sale.
    let vatNumberToSave = null;
    // Captured alongside the number — see the identical fix in
    // actions/workshops/create-workshop-reservation.js. Storing the number
    // without its VIES proof discarded the check made just below, so
    // lib/tax-policy.js treated a verified B2B customer as unverified.
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
        if (!viesResult.success && !isViesOutage(viesResult)) {
          return {
            success: false,
            message: viesResult.message || "Impossible de vérifier ce numéro de TVA pour le moment. Réessayez.",
            field: "vatNumber",
          };
        }
        if (viesResult.success && !viesResult.valid) {
          return {
            success: false,
            message: "Ce numéro de TVA n'est pas reconnu comme actif par le registre européen VIES.",
            field: "vatNumber",
          };
        }
        // On a VIES outage viesResult carries no name/address — the number is
        // saved provisionally (vatValidatedAt set, name null).
        vatValidation = {
          vatValidatedAt: new Date(),
          vatValidationName: viesResult.name ?? null,
          vatValidationAddress: viesResult.address ?? null,
        };
      }
    }

    // Phone backfill only applies when a CUSTOMER is booking for themselves —
    // when an admin/staff creates a reservation on behalf of a client,
    // authenticatedUser is the admin and customerInfo holds the *client's*
    // data; we must not write the client's phone onto the admin's account.
    const isCustomerSelf = Boolean(authenticatedUser) && !isAdminRole(authenticatedUser.role) && authenticatedUser.role !== "STAFF";
    const needsPhoneBackfill = isCustomerSelf
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

      // The account is created with the password the client chose in the
      // booking form — never generated, never emailed. Mirrors
      // actions/shared/init-customer-verification.js.
      const passwordIssue = validatePassword(customerInfo.password);
      if (passwordIssue) {
        return { success: false, field: "password", message: "Veuillez choisir un mot de passe d'au moins 8 caractères." };
      }
      user = await prisma.user.create({
        data: {
          fullName: customerInfo.fullName,
          email,
          password: await bcrypt.hash(customerInfo.password, BCRYPT_SALT_ROUNDS),
          phone,
          role: "CUSTOMER",
          isCompany: Boolean(vatNumberToSave),
          vatNumber: vatNumberToSave,
          ...(vatValidation ?? {}),
          ...buildTermsAcceptanceUpdate(),
        },
      });
    } else if (!authenticatedUser && !user.emailVerified) {
      // Existing-but-unverified account (an earlier incomplete booking
      // attempt under this email) retrying — refresh the password to
      // whatever was just typed, same as the shared init-customer-verification
      // "existing unverified user" branch. Never touches a *verified*
      // account's password without authentication (see the vatNumber-only
      // branch below).
      const passwordIssue = validatePassword(customerInfo.password);
      if (passwordIssue) {
        return { success: false, field: "password", message: "Veuillez choisir un mot de passe d'au moins 8 caractères." };
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: await bcrypt.hash(customerInfo.password, BCRYPT_SALT_ROUNDS),
          ...(vatNumberToSave ? { isCompany: true, vatNumber: vatNumberToSave, ...(vatValidation ?? {}) } : {}),
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
    const rawDepositPct = Number(formation.depositPercentage ?? 50);
    const depositPct = Number.isFinite(rawDepositPct) ? Math.min(100, Math.max(0, rawDepositPct)) : 0;
    const vatPolicy = resolveServiceVatPolicy({ customer: user });
    const catalogueUnitPrice = Number(formation.price);
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
    const discountedTotal = Number(Math.max(0, totalPrice - discountAmount).toFixed(2));
    const depositAmount = isFullPayment
      ? discountedTotal
      : Number(((discountedTotal * depositPct) / 100).toFixed(2));
    // Derive the balance from the rounded total and rounded deposit so the
    // two persisted Decimal(10,2) values always add back to the total.
    const balanceDue = Number((discountedTotal - depositAmount).toFixed(2));

    // This customer's own still-live hold on this session, if any.
    const liveHold = await prisma.formationReservation.findFirst({
      where: { sessionId, customerId: user.id, status: "PENDING_DEPOSIT", holdExpiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    // A verified customer with a payment link already in her inbox must not be
    // handed a second one: both links stay payable, and paying both charges
    // her twice. Refusing is the only safe answer here — reusing the same
    // reservation would leave two live Stripe sessions pointing at it, and the
    // second payment then lands on the "already CONFIRMED" branch of
    // lib/formations/fulfill-formation-reservation-payment.js, which treats it
    // as a redelivered webhook and swallows it with no refund flag at all.
    // Until 17/09/2026 nothing stopped this: a place taken by an unpaid
    // booking used to make the session look full, which hid the problem, and
    // the paid-only rule shipped that day removed that accidental guard.
    if (liveHold && user.emailVerified) {
      return {
        success: false,
        message:
          "Vous avez déjà une réservation en attente de paiement pour cette session. " +
          "Utilisez le lien de paiement reçu par email plutôt que d'en créer une seconde, " +
          "sinon vous risquez d'être débité(e) deux fois. Contactez-nous si vous ne le retrouvez pas.",
      };
    }

    // An unverified customer (brand new, or a previous guest checkout that
    // was never confirmed) reuses their still-live hold on this session
    // instead of stacking a second one — otherwise resubmitting the form
    // before confirming would lock a seat twice. Safe for them precisely
    // because they never reached Stripe: the hold above was created without a
    // checkout session, so reuse cannot leave two payable links behind.
    let reservation = user.emailVerified ? null : liveHold;

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

          const takenSeats = await sessionOccupancy(tx, {
            kind: OCCUPANCY_KINDS.FORMATION,
            sessionId,
          });
          const capacity = session.capacity ?? formation.capacity;
          const available = capacity - takenSeats;

          if (seatsCount > available) {
            throw new Error(`SOLD_OUT:${available}`);
          }

          if (promoCodeId && promoMaxUses != null) {
            const claim = await tx.promoCode.updateMany({
              where: { id: promoCodeId, usedCount: { lt: promoMaxUses } },
              data: { usedCount: { increment: 1 } },
            });
            if (claim.count === 0) throw new Error("PROMO_EXHAUSTED");
          } else if (promoCodeId) {
            await tx.promoCode.update({ where: { id: promoCodeId }, data: { usedCount: { increment: 1 } } });
          }

          const created = await tx.formationReservation.create({
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
            STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
            { tx }
          );
          if (recipientIds.length > 0) {
            await createNotificationsBulk(
              recipientIds.map((userId) =>
                buildFormationReservationCreatedNotification({
                  userId,
                  reservationId: created.id,
                  customerName: user.fullName,
                  activityTitle: formation.title,
                  seatsCount,
                })
              ),
              { tx }
            );
          }

          return created;
        }, { timeout: 15_000 });
      } catch (err) {
        if (typeof err.message === "string" && err.message.startsWith("SOLD_OUT:")) {
          const available = Number(err.message.slice("SOLD_OUT:".length));
          captureWarning("Formation session sold out during checkout", { area: "stock-capacity", sessionId, available });
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
        if (err.message === "PROMO_EXHAUSTED") {
          captureWarning("Promo code usage cap lost during checkout", { area: "promo-codes" });
          return { success: false, message: "Ce code promo vient d'atteindre sa limite d'utilisation." };
        }
        throw err;
      }
    }

    // Brand-new or still-unverified guest: hold the seat, but stop short of
    // Stripe until they confirm the email actually belongs to them. Awaited
    // (unlike the later credentials email) — the interstitial we show next
    // promises "check your inbox", so we need to know it actually sent.
    if (!user.emailVerified) {
      // The seat above is already held — a failed *delivery* attempt must
      // not be reported as a failed reservation (the customer would retry
      // and double-book), and sendCheckoutVerificationEmail already writes
      // the verification token row before it ever tries to send, so
      // "Renvoyer le lien" on /verify-email picks this exact token straight
      // back up.
      let emailDeliveryFailed = false;
      try {
        await sendCheckoutVerificationEmail({
          email,
          fullName: user.fullName,
          resumeType: "FORMATION",
          resumeId: reservation.id,
        });
      } catch (err) {
        console.error("[createFormationReservation] verification email failed:", err);
        emailDeliveryFailed = true;
      }

      return { success: true, requiresEmailVerification: true, email, emailDeliveryFailed };
    }

    // Also handed back to the client below so it can prove authorization on
    // this reservation to convertFormationWaitingListEntry — that action is a
    // public "use server" endpoint with no session for a guest booking, so a
    // bare waitingListEntryId/reservationId pair proves nothing on its own
    // (see isCheckoutAuthorized's doc comment).
    const checkoutToken = createResumeCheckoutToken({ resumeType: "FORMATION", resumeId: reservation.id, email });
    const checkoutResult = await createFormationReservationCheckoutSession(reservation.id, checkoutToken);
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
    console.error("[createFormationReservation]", error?.message || error, error?.stack || "");
    return {
      success: false,
      message: process.env.NODE_ENV === "development" ? `Erreur: ${error?.message}` : "Erreur lors de la création de la réservation.",
    };
  }
}
