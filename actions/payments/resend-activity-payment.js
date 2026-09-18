"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { activityPaymentRelanceEmail } from "@/lib/email-templates";
import { isSellerLegalDataComplete } from "@/lib/invoicing";
import { STAFF_PERMISSIONS } from "@/lib/authorization";
import { authorizeActivityReservationOperation } from "@/lib/activity-reservation-access";
import { AUDIT_ACTIONS, writeAuditLog } from "@/lib/audit-log";
import { OCCUPANCY_KINDS, sessionOccupancy } from "@/lib/reservations/session-occupancy";
import {
  resolvePayeeForActivitySession,
  payeeCanChargeOnline,
  payeeStripeOptions,
  PAYEE_ONLINE_UNAVAILABLE_MESSAGE,
} from "@/lib/payments/resolve-payee";
import {
  RELANCE_CHECKOUT_TTL_MS,
  RELANCE_HOLD_TTL_MS,
  RELANCE_KINDS,
  activityChargeAmount,
  buildActivityCheckoutParams,
  canRelanceActivityPayment,
  relanceKindConfig,
} from "@/lib/reservations/activity-payment-relance";

const KIND_DB = {
  [RELANCE_KINDS.WORKSHOP]: {
    delegate: (client) => client.workshopReservation,
    lockSession: (tx, sessionId) => tx.$queryRaw`SELECT id FROM workshop_sessions WHERE id = ${sessionId} FOR UPDATE`,
    permission: STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
    occupancyKind: OCCUPANCY_KINDS.WORKSHOP,
    dashboardPath: "/dashboard/workshops/reservations",
  },
  [RELANCE_KINDS.FORMATION]: {
    delegate: (client) => client.formationReservation,
    lockSession: (tx, sessionId) => tx.$queryRaw`SELECT id FROM formation_sessions WHERE id = ${sessionId} FOR UPDATE`,
    permission: STAFF_PERMISSIONS.FORMATION_RESERVATIONS,
    occupancyKind: OCCUPANCY_KINDS.FORMATION,
    dashboardPath: "/dashboard/formations/reservations",
  },
};

const ERROR_MESSAGES = {
  SESSION_FULL: "La séance est désormais complète : impossible de réserver à nouveau la place de ce client.",
  RESERVATION_CHANGED: "La réservation vient d'être modifiée. Rechargez la page et réessayez.",
  INVALID_SESSION_CAPACITY: "Capacité de séance invalide.",
};

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

/**
 * Every Checkout Session Stripe still knows for this booking. There is no
 * Payment row to hold a session id before the payment clears, so Stripe is
 * the only place to find the client's earlier links.
 */
async function listReservationCheckoutSessions(metadataKind, reservation, stripeOptions) {
  const matches = [];
  const createdSince = Math.floor(new Date(reservation.createdAt).getTime() / 1000) - 60;
  // An independent's seat is a direct charge on her own account, and the
  // platform cannot see those sessions at all — listing without her account
  // would find nothing and happily mint a SECOND payable link.
  for await (const checkoutSession of stripe.checkout.sessions.list(
    { created: { gte: createdSince }, limit: 100 },
    stripeOptions
  )) {
    if (checkoutSession.metadata?.kind === metadataKind && checkoutSession.metadata?.reservationId === reservation.id) {
      matches.push(checkoutSession);
    }
  }
  return matches;
}

/**
 * Staff "Relancer le paiement" for an atelier or formation booking whose
 * online payment never went through: puts the seat back on hold, mints a
 * fresh Stripe Checkout link and e-mails it to the booking's own client.
 * See lib/reservations/activity-payment-relance.js for why this differs from
 * the appointment relance.
 *
 * The Stripe webhook stays the only thing that confirms the booking.
 *
 * @param {{ kind: "WORKSHOP"|"FORMATION", id: string }} input
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function resendActivityReservationPayment({ kind, id } = {}) {
  const db = KIND_DB[kind];
  if (!db || !id) return { success: false, message: "Réservation introuvable." };
  const config = relanceKindConfig(kind);

  let newCheckoutSession = null;
  let seatHeld = false;
  // Hoisted: the catch below expires the unused session, and it has to do
  // that on the account the session was created on.
  let stripeOptions;
  try {
    const session = await auth();
    const access = await authorizeActivityReservationOperation({
      kind,
      reservationId: id,
      user: session?.user,
      capability: db.permission,
    });
    if (!access.success) return access;

    const reservation = await db.delegate(prisma).findUnique({
      where: { id },
      include: {
        session: { include: { [config.parentKey]: true } },
        customer: { select: { id: true, email: true, fullName: true } },
        payment: { select: { id: true } },
      },
    });
    if (!reservation) return { success: false, message: "Réservation introuvable." };

    if (!canRelanceActivityPayment(reservation)) {
      return {
        success: false,
        message: reservation.payment
          ? "Un paiement est déjà enregistré pour cette réservation."
          : "Le paiement de cette réservation ne peut plus être relancé.",
      };
    }
    if (!reservation.customer?.email) {
      return { success: false, message: "Ce client n'a pas d'adresse e-mail." };
    }
    // Whose money this seat is — the same answer the original booking froze,
    // so a relance never moves a charge from one Stripe account to another.
    const payee = await resolvePayeeForActivitySession(prisma, { kind, sessionId: reservation.sessionId });
    if (!payeeCanChargeOnline(payee)) {
      return { success: false, message: PAYEE_ONLINE_UNAVAILABLE_MESSAGE };
    }
    stripeOptions = payeeStripeOptions(payee);
    // The salon's legal identity only gates a sale the salon invoices.
    if (!payee.staff && !(await isSellerLegalDataComplete())) {
      return { success: false, message: "Le paiement en ligne n'est pas disponible pour le moment." };
    }

    // A client who already paid — or whose bank payment is still processing —
    // must never receive a second link. Earlier links that are still open are
    // closed, so only the new one can be paid.
    const earlierSessions = await listReservationCheckoutSessions(config.metadataKind, reservation, stripeOptions);
    if (earlierSessions.some((s) => s.status === "complete")) {
      return {
        success: false,
        message: "Stripe a déjà reçu un paiement pour cette réservation (ou il est en cours de traitement). Vérifiez les Opérations avant toute relance.",
      };
    }
    for (const earlier of earlierSessions) {
      // expire(id, params, options) — the request options are the THIRD
      // argument. Passed second, `{ stripeAccount }` is sent as a body field
      // and Stripe answers "Received unknown parameter: stripeAccount", which
      // threw the whole relance. It only ever bit an independent's booking:
      // payeeStripeOptions() returns undefined for the salon, and
      // expire(id, undefined) is perfectly valid.
      if (earlier.status === "open") await stripe.checkout.sessions.expire(earlier.id, {}, stripeOptions);
    }

    const now = Date.now();
    const holdExpiresAt = new Date(now + RELANCE_HOLD_TTL_MS);
    newCheckoutSession = await stripe.checkout.sessions.create(
      buildActivityCheckoutParams(kind, reservation, { expiresAt: new Date(now + RELANCE_CHECKOUT_TTL_MS), payee }),
      stripeOptions
    );

    // Seat back on hold, atomically against capacity — the same session lock
    // the public booking flow takes, so a concurrent booking cannot take the
    // last seat in between.
    const parent = reservation.session[config.parentKey];
    await prisma.$transaction(async (tx) => {
      await db.lockSession(tx, reservation.sessionId);
      const taken = await sessionOccupancy(tx, {
        kind: db.occupancyKind,
        sessionId: reservation.sessionId,
        excludeReservationId: reservation.id,
      });
      const capacity = reservation.session.capacity ?? parent.capacity;
      if (!Number.isInteger(capacity) || capacity < 1) throw new Error("INVALID_SESSION_CAPACITY");
      if (taken + reservation.seatsCount > capacity) throw new Error("SESSION_FULL");

      const claim = await db.delegate(tx).updateMany({
        where: {
          id: reservation.id,
          status: reservation.status,
          cancelledByUserId: null,
          payment: { is: null },
        },
        data: { status: "PENDING_DEPOSIT", holdExpiresAt, cancelledAt: null },
      });
      if (claim.count === 0) throw new Error("RESERVATION_CHANGED");

      await writeAuditLog(tx, {
        action: AUDIT_ACTIONS.RESERVATION_PAYMENT_RELAUNCHED,
        entityType: kind === RELANCE_KINDS.WORKSHOP ? "WorkshopReservation" : "FormationReservation",
        entityId: reservation.id,
        before: { status: reservation.status, holdExpiresAt: reservation.holdExpiresAt },
        after: { status: "PENDING_DEPOSIT", holdExpiresAt },
        metadata: { stripeCheckoutSessionId: newCheckoutSession.id, expiredSessionIds: earlierSessions.filter((s) => s.status === "open").map((s) => s.id) },
      });
    }, { timeout: 15_000 });
    seatHeld = true;

    const { chargeAmount } = activityChargeAmount(reservation);
    const emailResult = await sendEmail({
      to: reservation.customer.email,
      ...activityPaymentRelanceEmail({
        customerName: reservation.customer.fullName,
        activityLabel: config.label,
        activityTitle: parent.title,
        sessionDate: formatSessionDate(reservation.session.startDate),
        seatsCount: reservation.seatsCount,
        amountToPay: chargeAmount,
        totalAmount: Number(reservation.totalPrice),
        paymentUrl: newCheckoutSession.url,
        expiresAt: new Date(now + RELANCE_CHECKOUT_TTL_MS),
      }),
    });

    revalidatePath(db.dashboardPath);
    if (!emailResult?.success) {
      return {
        success: false,
        message: "La place est de nouveau réservée, mais l'e-mail n'a pas pu être envoyé. Réessayez la relance.",
      };
    }
    return { success: true, message: "Lien de paiement renvoyé au client par e-mail. La place est réservée 24 h." };
  } catch (error) {
    // The new link must not stay payable for a booking that was not put back
    // on hold.
    if (newCheckoutSession && !seatHeld) {
      await stripe.checkout.sessions.expire(newCheckoutSession.id, {}, stripeOptions).catch((expireError) =>
        console.error("[resendActivityReservationPayment] could not expire unused session:", expireError)
      );
    }
    if (ERROR_MESSAGES[error?.message]) return { success: false, message: ERROR_MESSAGES[error.message] };
    console.error("[resendActivityReservationPayment]", error);
    return { success: false, message: "Erreur lors de la relance du paiement. Veuillez réessayer." };
  }
}
