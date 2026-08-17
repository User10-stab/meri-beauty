"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { workshopCancellationEmail } from "@/lib/email-templates";
import { isAdminRole } from "@/lib/authorization";
import { notifyAllInWaitingList } from "@/lib/workshops/notify-waiting-list";
import { checkWorkshopSessionAvailability } from "@/actions/workshops/create-workshop-reservation";
import { issueCreditNote } from "@/lib/invoicing";
import { buildRefundIdempotencyKey, pinPendingRefund, markRefundFailed, clearPendingRefund } from "@/lib/payments/pin-pending-refund";
import { settleReservation, markReservationNoShow, RESERVATION_KINDS } from "@/lib/reservations/settle-reservation";

const SESSION_CHANGE_FEE_RATE = 0.1; // 10% of the reservation's total price

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
 * Admin-only: cancels a reservation on a customer's behalf. Deposits are
 * non-refundable by default (see req: "no refund once paid the deposit") —
 * enforced here since there's no customer self-service cancel flow in this
 * app. The client confirmed exceptions should exist for medical reasons,
 * death, or genuine force majeure — `refundDeposit` is the admin's manual
 * case-by-case call, never automatic, so `reason` is required whenever it's
 * used (it's what justifies the exception in the reservation's own record).
 *
 * No time cutoff before the session: unlike a customer self-service window,
 * this is a trusted admin acting on a case she's already reviewed — the
 * most urgent exceptions (a customer hospitalized the day of the session)
 * are also the ones closest to the session date, so a cutoff here would
 * block the admin from honoring exactly the force-majeure promise made in
 * the CGV.
 */
export async function cancelWorkshopReservation(reservationId, { reason, refundDeposit = false } = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      return { success: false, message: "Non authentifié." };
    }
    if (!isAdminRole(session.user.role)) {
      // Deletion = client-facing cancellation, kept admin-only to avoid disputes.
      return { success: false, message: "Non autorisé." };
    }

    if (refundDeposit && !reason?.trim()) {
      return { success: false, message: "Un motif est requis pour rembourser l'acompte à titre exceptionnel." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: {
        session: { include: { workshop: true } },
        customer: true,
        payment: { include: { invoice: true } },
      },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status === "CANCELLED") {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    const noteLine = refundDeposit
      ? `Annulation (acompte remboursé à titre exceptionnel) : ${reason}`
      : reason
      ? `Annulation : ${reason}`
      : null;

    // Atomic claim gated on the reservation not already being cancelled —
    // without this, two concurrent cancels (double-click, or two admins)
    // both pass the plain read-then-check above and both refund.
    const claim = await prisma.workshopReservation.updateMany({
      where: { id: reservationId, status: { not: "CANCELLED" } },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: session.user.id,
        notes: noteLine ? `${reservation.notes ? `${reservation.notes}\n` : ""}${noteLine}` : reservation.notes,
      },
    });
    if (claim.count === 0) {
      return { success: false, message: "Cette réservation est déjà annulée." };
    }

    // Deposits are non-refundable by default — never stripe.refunds.create()
    // here unless the admin explicitly granted an exception above. The
    // credit note is issued as soon as that exception is granted (same
    // decoupled-from-Stripe-success pattern as orders.js/manage-appointment.js
    // — it's a record of the business decision to credit the customer, not
    // of the money having actually moved yet), so a failed/retried Stripe
    // call never leaves it missing.
    let refundFailed = false;
    const REFUND_EPSILON = 0.01;
    if (refundDeposit && reservation.payment?.transactionReference) {
      const payment = reservation.payment;

      // Cap against what's actually still outstanding — a prior partial
      // refund (e.g. issued manually from the Stripe Dashboard, reconciled
      // via the charge.refunded webhook) can already have refunded part of
      // this payment. Mirrors rejectAppointment's exact pattern — without
      // it, this over-counts in the ledger (and could double-refund on
      // Stripe's side if the payment_intent still had a partial balance).
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: payment.id, transactionType: "REFUND" },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      const remaining = Number(payment.paidAmount) - alreadyRefunded;

      if (remaining <= REFUND_EPSILON) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      } else {
        // Pinned in the same transaction as the credit note — see
        // lib/payments/pin-pending-refund.js's doc comment for why this has
        // to happen before the Stripe call below, not just in its catch.
        const refundIdempotencyKey = buildRefundIdempotencyKey("workshop-cancel", payment.id);
        await prisma.$transaction(async (tx) => {
          await pinPendingRefund(tx, payment.id, remaining, refundIdempotencyKey);
          if (payment.invoice) {
            await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: reason || "Annulation atelier — remboursement exceptionnel",
              totalInclVat: remaining,
            });
          }
        });

        try {
          const checkoutSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
          if (checkoutSession.payment_intent) {
            const stripePaymentIntentId =
              typeof checkoutSession.payment_intent === "string"
                ? checkoutSession.payment_intent
                : checkoutSession.payment_intent.id;
            await stripe.refunds.create(
              {
                payment_intent: stripePaymentIntentId,
                amount: Math.round(remaining * 100),
                metadata: { kind: "workshop_admin_exception", reservationId, adminUserId: session.user.id },
              },
              { idempotencyKey: refundIdempotencyKey }
            );

            const fullyRefunded = remaining + REFUND_EPSILON >= Number(payment.paidAmount);
            await prisma.$transaction([
              clearPendingRefund(prisma, payment.id, fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED"),
              prisma.transaction.updateMany({
                where: {
                  paymentId: payment.id,
                  transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
                  stripePaymentIntentId: null,
                },
                data: { stripePaymentIntentId },
              }),
              prisma.transaction.create({
                data: {
                  paymentId: payment.id,
                  amount: remaining,
                  method: "ONLINE",
                  transactionType: "REFUND",
                  paidAt: new Date(),
                  stripeCheckoutSessionId: payment.transactionReference,
                  stripePaymentIntentId,
                },
              }),
            ]);
          }
        } catch (err) {
          // The reservation is already cancelled and the credit note already
          // issued — that stays. But don't let the customer email below claim
          // a refund that didn't happen; surface this to staff instead.
          // pendingRefundAmount/idempotencyKey are left set (not cleared) so
          // the cron retry job (lib/payments/retry-failed-refunds.js) can
          // pick it up even if this email is missed.
          console.error("[cancelWorkshopReservation] REFUND FAILED for", reservationId, err);
          refundFailed = true;
          await markRefundFailed(prisma, payment.id, err);
        }
      }
    }

    notifyAllInWaitingList(reservation.sessionId).catch((err) =>
      console.error("[cancelWorkshopReservation] waiting-list notify failed:", err)
    );

    sendEmail({
      to: reservation.customer.email,
      ...workshopCancellationEmail({
        customerName: reservation.customer.fullName,
        activityTitle: reservation.session.workshop.title,
        sessionDate: formatSessionDate(reservation.session.startDate),
        refunded: refundDeposit && !refundFailed,
      }),
    }).catch((err) => console.error("[cancelWorkshopReservation] email failed:", err));

    if (refundFailed) {
      const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
      if (salon?.email) {
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement Stripe échoué – Réservation atelier n°${reservationId}`,
          text: `Le remboursement Stripe pour la réservation atelier n°${reservationId} (client : ${reservation.customer.email}) a échoué. Traitement manuel requis dans le dashboard Stripe.`,
          html: `<p>Le remboursement Stripe pour la réservation atelier n°${reservationId} (client : ${reservation.customer.email}) a échoué. Traitement manuel requis dans le dashboard Stripe.</p>`,
        }).catch((err) => console.error("[cancelWorkshopReservation] refund-failure alert email failed:", err));
      }
    }

    revalidatePath("/dashboard/workshops/reservations");
    return {
      success: true,
      message: refundDeposit
        ? refundFailed
          ? "Réservation annulée. Le remboursement n'a pas pu être traité automatiquement — notre équipe s'en occupe."
          : "Réservation annulée et acompte remboursé."
        : "Réservation annulée.",
      refundFailed,
    };
  } catch (error) {
    console.error("[cancelWorkshopReservation]", error);
    return { success: false, message: "Erreur lors de l'annulation." };
  }
}

/**
 * Admin-only: moves a confirmed reservation to a different session of the
 * SAME activity, charging a 10% fee via a Stripe Checkout link. The move
 * only takes effect once the fee is paid — see the "session_change_fee"
 * branch in app/api/webhooks/stripe/route.js.
 */
export async function changeReservationSession(reservationId, newSessionId) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: true },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status !== "CONFIRMED") {
      return { success: false, message: "Seule une réservation confirmée peut être modifiée." };
    }
    if (newSessionId === reservation.sessionId) {
      return { success: false, message: "Cette réservation est déjà sur cette séance." };
    }

    const newSession = await prisma.workshopSession.findUnique({
      where: { id: newSessionId },
      include: { workshop: true },
    });
    if (!newSession) {
      return { success: false, message: "Séance cible introuvable." };
    }
    // Same-activity only — "changing your place" means a different date of
    // the same atelier, not switching to a different workshop entirely.
    if (newSession.workshopId !== reservation.session.workshopId) {
      return { success: false, message: "Le changement de séance n'est possible qu'au sein du même atelier." };
    }

    const availability = await checkWorkshopSessionAvailability(newSessionId);
    if (!availability.success || availability.data.available < reservation.seatsCount) {
      return { success: false, message: "La séance cible n'a pas assez de places disponibles." };
    }

    const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE;

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see docs/QUESTIONS_FOR_MARIE.md
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Frais de modification - ${reservation.session.workshop.title}`,
              description: `Changement de séance (${new Date(newSession.startDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })})`,
            },
            unit_amount: Math.round(changeFeeAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/workshops/reservations`,
      customer_email: reservation.customer.email,
      metadata: {
        kind: "workshop",
        workshopAction: "session_change_fee",
        reservationId: reservation.id,
        newSessionId,
        changeFeeAmount: String(changeFeeAmount),
      },
      payment_intent_data: {
        metadata: {
          kind: "workshop",
          workshopAction: "session_change_fee",
          reservationId: reservation.id,
        },
      },
    });

    return {
      success: true,
      message: "Lien de paiement généré. Envoyez-le au client pour finaliser le changement.",
      paymentUrl: stripeSession.url,
      changeFeeAmount,
    };
  } catch (error) {
    console.error("[changeReservationSession]", error);
    return { success: false, message: "Erreur lors de la modification de la séance." };
  }
}

/**
 * Admin-only: changes the number of seats on an existing CONFIRMED
 * reservation, via a Stripe Checkout link.
 *
 * A flat 10% fee (of the reservation's original total price) always
 * applies, matching the confirmed pricing rule. On top of that, when seats
 * are being ADDED, the customer must also pay for the extra seats — at the
 * same paid ratio they originally chose (full payment or a deposit) — or
 * the salon is left owed the difference with no way to invoice it. Seat
 * DECREASES stay fee-only with no price/deposit adjustment: the deposit
 * policy is "never refunded regardless of reason," so removing seats
 * doesn't unwind money already collected for them.
 */
export async function changeReservationSeats(reservationId, newSeatsCount) {
  try {
    const session = await auth();
    if (!session?.user || !isAdminRole(session.user.role)) {
      return { success: false, message: "Non autorisé." };
    }

    const seats = Number(newSeatsCount);
    if (!Number.isInteger(seats) || seats < 1) {
      return { success: false, message: "Le nombre de places doit être un entier positif." };
    }

    const reservation = await prisma.workshopReservation.findUnique({
      where: { id: reservationId },
      include: { session: { include: { workshop: true } }, customer: true },
    });
    if (!reservation) {
      return { success: false, message: "Réservation introuvable." };
    }
    if (reservation.status !== "CONFIRMED") {
      return { success: false, message: "Seule une réservation confirmée peut être modifiée." };
    }
    if (seats === reservation.seatsCount) {
      return { success: false, message: "Cette réservation a déjà ce nombre de places." };
    }

    const capacity = reservation.session.capacity ?? reservation.session.workshop.capacity;
    if (seats > capacity) {
      return { success: false, message: `La capacité maximale de cette séance est de ${capacity} personnes.` };
    }

    // Only enforce availability when INCREASING — the reservation's own
    // current seats already count as "taken," so the room available for
    // this change is what's free PLUS what this reservation already holds.
    if (seats > reservation.seatsCount) {
      const availability = await checkWorkshopSessionAvailability(reservation.sessionId);
      const roomForThisReservation = (availability.data?.available ?? 0) + reservation.seatsCount;
      if (!availability.success || seats > roomForThisReservation) {
        return { success: false, message: "Pas assez de places disponibles sur cette séance pour cette augmentation." };
      }
    }

    const changeFeeAmount = Number(reservation.totalPrice) * SESSION_CHANGE_FEE_RATE;

    // On an increase, the customer must also pay for the added seats — at
    // the same ratio they originally paid (1.0 for a full payment, the
    // deposit % for a deposit booking) — so the salon isn't left owed the
    // untracked difference. Computed once here and passed through Stripe
    // metadata so the webhook applies these exact figures rather than
    // re-deriving them from a reservation row that may have moved on.
    let priceDelta = 0;
    let newTotalPrice = Number(reservation.totalPrice);
    let newDepositAmount = Number(reservation.depositAmount);
    if (seats > reservation.seatsCount) {
      const unitPrice = Number(reservation.totalPrice) / reservation.seatsCount;
      const paidRatio = Number(reservation.depositAmount) / Number(reservation.totalPrice);
      newTotalPrice = unitPrice * seats;
      newDepositAmount = paidRatio * newTotalPrice;
      priceDelta = newDepositAmount - Number(reservation.depositAmount);
    }
    const amountToCharge = changeFeeAmount + priceDelta;

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Bancontact disabled for now — see docs/QUESTIONS_FOR_MARIE.md
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: `Frais de modification - ${reservation.session.workshop.title}`,
              description: `Modification du nombre de places (${reservation.seatsCount} → ${seats})${
                priceDelta > 0 ? " — inclut le prix des places ajoutées" : ""
              }`,
            },
            unit_amount: Math.round(amountToCharge * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation-atelier/succes?reservation_id=${reservation.id}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/workshops/reservations`,
      customer_email: reservation.customer.email,
      metadata: {
        kind: "workshop",
        workshopAction: "seats_change_fee",
        reservationId: reservation.id,
        newSeatsCount: String(seats),
        changeFeeAmount: String(changeFeeAmount),
        newTotalPrice: String(newTotalPrice),
        newDepositAmount: String(newDepositAmount),
      },
      payment_intent_data: {
        metadata: {
          kind: "workshop",
          workshopAction: "seats_change_fee",
          reservationId: reservation.id,
        },
      },
    });

    return {
      success: true,
      message: "Lien de paiement généré. Envoyez-le au client pour finaliser le changement.",
      paymentUrl: stripeSession.url,
      changeFeeAmount: amountToCharge,
    };
  } catch (error) {
    console.error("[changeReservationSeats]", error);
    return { success: false, message: "Erreur lors de la modification du nombre de places." };
  }
}

/**
 * Admin-only: closes out an atelier reservation, collecting the 50% on-site
 * balance and issuing the final invoice. Before this existed there was no
 * way to record that money at all — see lib/reservations/settle-reservation.js.
 */
export async function completeWorkshopReservation(reservationId, { method, paymentConfirmed } = {}) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { success: false, message: "Non autorisé." };

  const result = await settleReservation({
    kind: "WORKSHOP",
    reservationId,
    method,
    paymentConfirmed,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.WORKSHOP.revalidatePath);
  return result;
}

/** Admin-only: records a no-show. Never refunds — the deposit is kept by design. */
export async function markWorkshopReservationNoShow(reservationId) {
  const session = await auth();
  if (!session?.user) return { success: false, message: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { success: false, message: "Non autorisé." };

  const result = await markReservationNoShow({
    kind: "WORKSHOP",
    reservationId,
    actorId: session.user.id,
  });

  if (result.success) revalidatePath(RESERVATION_KINDS.WORKSHOP.revalidatePath);
  return result;
}
