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
import { issueCreditNote, issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { queueManualRefund } from "@/lib/refunds/queue-manual-refund";
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
        customer: { include: { billingProfile: true } },
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

    // Deposits are non-refundable by default. When an admin grants an
    // exception, this no longer moves the money itself — confirmed policy
    // (2026-09-02): every Stripe refund is performed by hand in the Stripe
    // dashboard by an OWNER/ADMIN.
    //
    // The credit note is still issued here exactly as before. What replaces
    // the Stripe call is a RefundOperation whose legs carry the precise
    // amount and payment_intent to refund against; it sits at the top of
    // /dashboard/operations until someone has actually done it, and the
    // charge.refunded webhook settles it. Deleting the call without this
    // would have left the customer credited on paper and never paid — the
    // exact state scripts/audit-refund-states.mjs found nine times.
    //
    // Note this no longer requires payment.transactionReference: a
    // reservation settled in cash used to fall through here refunding
    // nothing AND issuing no credit note. Cash now queues a hand-over leg
    // like any other method.
    let refundQueued = false;
    const REFUND_EPSILON = 0.01;
    if (refundDeposit && reservation.payment) {
      const payment = reservation.payment;

      // Cap against what is actually still outstanding — a prior partial
      // refund (issued from the Stripe dashboard, reconciled by the
      // charge.refunded webhook) can already have returned part of this.
      const priorRefunds = await prisma.transaction.aggregate({
        where: { paymentId: payment.id, transactionType: "REFUND", isDeleted: false },
        _sum: { amount: true },
      });
      const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
      const remaining = Number(payment.paidAmount) - alreadyRefunded;

      if (remaining <= REFUND_EPSILON) {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
      } else {
        await prisma.$transaction(async (tx) => {
          const transactions = await tx.transaction.findMany({
            where: { paymentId: payment.id },
            select: {
              id: true,
              amount: true,
              method: true,
              transactionType: true,
              paidAt: true,
              isDeleted: true,
              stripePaymentIntentId: true,
              stripeCheckoutSessionId: true,
            },
          });

          let creditNoteId = null;
          if (payment.invoice) {
            const creditNote = await issueCreditNote(tx, {
              invoiceId: payment.invoice.id,
              reason: reason || "Annulation atelier — remboursement exceptionnel",
              totalInclVat: remaining,
            });
            creditNoteId = creditNote.id;
          }

          const queued = await queueManualRefund(tx, {
            paymentId: payment.id,
            source: "WORKSHOP",
            trigger: "SALON_CANCELLATION",
            reason: reason || "Annulation atelier — remboursement exceptionnel",
            amount: remaining,
            transactions,
            creditNoteId,
            invoiceId: payment.invoice?.id ?? null,
            decidedByUserId: session.user.id,
            activityType: reservation.session.workshop.type,
          });
          refundQueued = Boolean(queued);
        });
      }
    } else if (
      !refundDeposit &&
      reservation.payment &&
      Number(reservation.payment.paidAmount) > 0.01 &&
      !reservation.payment.invoice
    ) {
      // Deposit kept, not refunded — this is now final, non-refundable
      // revenue, and Belgian law requires an invoice for it just as much as
      // for a normally-settled reservation (see settleReservation's own
      // issueInvoice call). Never invoiced at collection time (see
      // lib/reservations/settle-reservation.js's doc comment), so this is
      // the only point where that invoice gets issued for a forfeited
      // deposit.
      const payment = reservation.payment;
      await prisma.$transaction(async (tx) => {
        await issueInvoice(tx, {
          paymentId: payment.id,
          source: "WORKSHOP",
          totalInclVat: Number(payment.paidAmount),
          customer: buildInvoiceCustomer(reservation.customer),
          lines: buildServiceInvoiceLines({
            description: `Annulation — acompte non remboursable — ${reservation.session.workshop.title}`,
            totalAmount: Number(payment.paidAmount),
          }),
        });
        await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      });
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
        // Always false now. The money has NOT moved at this point — an
        // admin still has to refund it in Stripe or hand it over. Telling
        // the customer "remboursé" here is exactly the claim the handoff
        // forbids; lib/refunds/notify-refund-complete.js sends that message
        // once, after every leg has actually settled.
        refunded: false,
      }),
    }).catch((err) => console.error("[cancelWorkshopReservation] email failed:", err));

    revalidatePath("/dashboard/workshops/reservations");
    revalidatePath("/dashboard/operations");
    return {
      success: true,
      message: refundDeposit
        ? refundQueued
          ? "Réservation annulée. Le remboursement est à effectuer — voir « Remboursements dus » dans Opérations."
          : "Réservation annulée. Aucun montant restant à rembourser."
        : "Réservation annulée.",
      refundQueued,
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
