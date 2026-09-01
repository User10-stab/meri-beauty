import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { qrPngAttachment } from "@/lib/qrcode";
import { CHECK_IN_KINDS, ensureCheckInCode } from "@/lib/activities/check-in-code";
import { workshopReservationConfirmationEmail } from "@/lib/email-templates";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { sendLowSeatsBroadcast } from "@/lib/workshops/notify-low-seats";
import { flagPaymentForManualRefund } from "@/lib/payments/flag-payment-for-manual-refund";
import {
  createNotificationsBulk,
  buildWorkshopReservationPaidNotification,
  getActivityNotificationRecipients,
} from "@/lib/notifications";
import { STAFF_PERMISSIONS } from "@/lib/authorization";

// 1-cent tolerance for float/rounding when comparing Stripe's amount_total
// against our own expected-price calculation.
const UNDERPAYMENT_EPSILON = 0.01;

/**
 * Confirms a WorkshopReservation's initial (deposit or full) payment —
 * called by the Stripe webhook (checkout.session.completed) for a real
 * payment, or directly with a synthetic zero-amount `session` when a 100%
 * promo code covers the whole price and there's nothing for Stripe to
 * charge (see createWorkshopReservationCheckoutSession). Both callers must
 * get identical business logic — this is the single implementation, not a
 * parallel one, so a future change here can't silently diverge between the
 * real-payment and free-booking paths.
 *
 * A synthetic session only needs: id (unique, for the idempotency key),
 * metadata.reservationId, metadata.workshopAction, amount_total (0),
 * payment_intent (null — flagPaymentForManualRefund no-ops without one).
 *
 * No automatic Stripe refund is ever issued from here (2 Sep 2026) — a
 * missing/cancelled reservation or an underpayment is flagged for a human to
 * refund manually from the Stripe Dashboard instead. See
 * flagPaymentForManualRefund's own doc for why.
 */
export async function confirmWorkshopReservationPayment(session) {
  const meta = session.metadata ?? {};
  const { reservationId, workshopAction } = meta;

  if (!reservationId) {
    console.error("[confirmWorkshopReservationPayment] missing reservationId:", session.id, meta);
    return { received: true, warning: "missing metadata" };
  }

  // ── Idempotency — was this session already processed? ────────────────────
  const existing = await prisma.payment.findFirst({
    where: { transactionReference: session.id },
    select: { id: true },
  });
  if (existing) {
    return { received: true, alreadyProcessed: true };
  }

  const reservation = await prisma.workshopReservation.findUnique({
    where: { id: reservationId },
    include: {
      session: { include: { workshop: true } },
      customer: {
        include: {
          billingProfile: {
            select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
          },
        },
      },
    },
  });

  if (!reservation) {
    console.error("[confirmWorkshopReservationPayment] WorkshopReservation gone, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation introuvable");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation deleted" };
  }

  // The salon can't honor a sale it already voided (e.g. an admin cancelled
  // this reservation while the payment was in flight) — a failed sale, not a
  // voluntary cancellation of an honored booking, so it still needs a refund
  // (done manually now — see flagPaymentForManualRefund).
  if (reservation.status === "CANCELLED") {
    console.warn("[confirmWorkshopReservationPayment] Reservation cancelled before payment cleared, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation annulée avant que le paiement ne soit confirmé");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation cancelled" };
  }

  if (reservation.status === "CONFIRMED") {
    // Already confirmed by a previous delivery of this same webhook event.
    return { received: true, alreadyProcessed: true };
  }

  const isFullPayment = workshopAction === "full_payment";
  const totalAmount = Number(reservation.totalPrice);
  const paidAmount = (session.amount_total ?? 0) / 100;

  const expectedAmount = isFullPayment ? totalAmount : Number(reservation.depositAmount);
  if (paidAmount + UNDERPAYMENT_EPSILON < expectedAmount) {
    console.error(`[confirmWorkshopReservationPayment] UNDERPAYMENT: paid ${paidAmount} expected ${expectedAmount} for session ${session.id}`);
    await flagPaymentForManualRefund(session, `paiement insuffisant (${paidAmount}€ reçus, ${expectedAmount}€ attendus)`);
    return { received: true, refunded: false, flaggedForReview: true, reason: "underpayment" };
  }

  let invoice;
  try {
  ({ invoice } = await prisma.$transaction(async (tx) => {
    // A late payer's checkout session stays payable for up to 24h, but the
    // 15-minute hold (holdExpiresAt) can lapse long before that and free the
    // seat for someone else to take — checkWorkshopSessionAvailability
    // already excludes an expired hold from its live capacity count. Without
    // re-checking capacity here, this confirm would happily reinstate a seat
    // that was already resold, overbooking the session.
    if (reservation.status === "PENDING_DEPOSIT") {
      const otherReserved = await tx.workshopReservation.aggregate({
        where: {
          sessionId: reservation.sessionId,
          id: { not: reservation.id },
          OR: [
            { status: { in: ["CONFIRMED", "COMPLETED"] } },
            { status: "PENDING_DEPOSIT", OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: new Date() } }] },
          ],
        },
        _sum: { seatsCount: true },
      });
      const capacity = reservation.session.capacity ?? reservation.session.workshop.capacity;
      if (!Number.isInteger(capacity) || capacity < 1) {
        throw new Error("INVALID_SESSION_CAPACITY");
      }
      const takenSeats = otherReserved._sum.seatsCount ?? 0;
      if (takenSeats + reservation.seatsCount > capacity) {
        throw new Error("HOLD_EXPIRED_OVERBOOKED");
      }
    }

    // Atomic, conditional on the reservation still being PENDING_DEPOSIT —
    // `reservation` above was fetched *before* this transaction opened, so a
    // concurrent cancellation (hold-expiry sweep, an admin voiding the
    // booking, a second delivery of this same webhook) between that read and
    // here would otherwise go undetected: the code would blindly flip status
    // back to CONFIRMED, resurrecting a reservation the business had already
    // and intentionally cancelled. Gating the write on the live status turns
    // that into a detectable no-op instead of a silent overwrite.
    const { count } = await tx.workshopReservation.updateMany({
      where: { id: reservation.id, status: "PENDING_DEPOSIT" },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });
    if (count === 0) {
      throw new Error("RESERVATION_NO_LONGER_PENDING");
    }

    const payment = await tx.payment.create({
      data: {
        workshopReservationId: reservation.id,
        depositAmount: isFullPayment ? 0 : paidAmount,
        totalAmount,
        paidAmount,
        remainingAmount: Math.max(totalAmount - paidAmount, 0),
        paymentType: isFullPayment ? "ONLINE" : "DEPOSIT",
        status: isFullPayment ? "PAID" : "PARTIALLY_PAID",
        promoCodeId: reservation.promoCodeId,
        discountAmount: reservation.discountAmount,
        paidAt: new Date(),
        transactionReference: session.id, // idempotency key
      },
    });

    await tx.transaction.create({
      data: {
        paymentId: payment.id,
        amount: paidAmount,
        method: "ONLINE",
        transactionType: isFullPayment ? "FINAL_PAYMENT" : "DEPOSIT",
        paidAt: new Date(),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      },
    });

    // Only fully-settled payments are invoiced — a deposit leaves a balance
    // due in-salon, invoiced once that's collected (same rule as appointments).
    let invoice = null;
    if (isFullPayment) {
      invoice = await issueInvoice(tx, {
        paymentId: payment.id,
        source: "WORKSHOP",
        totalInclVat: paidAmount,
        customer: buildInvoiceCustomer(reservation.customer),
        // quantity: 1 with unitPrice = the actual total collected, not
        // seatsCount at a divided-back unit price — dividing then
        // re-multiplying independently-rounded numbers can leave the line
        // a cent off the invoice total (e.g. 100/3 -> 33.33 x 3 = 99.99).
        // Seat count is still visible in the description. Any promo
        // discount gets its own line rather than being baked silently into
        // the unit price (see buildServiceInvoiceLines).
        lines: buildServiceInvoiceLines({
          description: `${reservation.session.workshop.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
          totalAmount,
          discountAmount: Number(reservation.discountAmount),
        }),
      });
    }

    // Salon side — fires on a deposit too: the seat is taken and money moved
    // either way, which is exactly what the salon needs to know. Admins
    // always; the session's animator only if they have an account and hold
    // WORKSHOP_RESERVATIONS (see getActivityNotificationRecipients).
    const recipientIds = await getActivityNotificationRecipients(
      reservation.session.animatorId,
      STAFF_PERMISSIONS.WORKSHOP_RESERVATIONS,
      { tx }
    );
    if (recipientIds.length > 0) {
      await createNotificationsBulk(
        recipientIds.map((userId) =>
          buildWorkshopReservationPaidNotification({
            userId,
            reservationId: reservation.id,
            activityTitle: reservation.session.workshop.title,
            customerName: reservation.customer.fullName,
            seatsCount: reservation.seatsCount,
            paidAmount,
            isDeposit: !isFullPayment,
          })
        ),
        { tx }
      );
    }

    return { invoice };
  // Same shape as lib/orders/fulfill-order-payment.js: capacity re-check,
  // payment, invoice numbering and notifications are all sequential DB round
  // trips that can exceed Prisma's 5000ms default timeout against Neon and
  // silently fail to fulfil a real payment. 20s/10s gives real headroom.
  }, { timeout: 20000, maxWait: 10000 }));
  } catch (err) {
    if (err.code === "P2002") {
      return { received: true, alreadyProcessed: true };
    }
    if (err.message === "RESERVATION_NO_LONGER_PENDING") {
      const fresh = await prisma.workshopReservation.findUnique({
        where: { id: reservation.id },
        select: { status: true },
      });
      if (fresh?.status === "CONFIRMED") {
        // A second delivery of this same webhook event won the race —
        // nothing left to do, no refund, no duplicate email.
        return { received: true, alreadyProcessed: true };
      }
      // Cancelled concurrently (hold-expiry sweep, an admin voiding the
      // booking) between the initial fetch and this transaction — the money
      // that just came in has no honored booking behind it, flagged for a
      // human to refund manually.
      console.warn(
        `[confirmWorkshopReservationPayment] Reservation cancelled concurrently, flagging for manual refund:`,
        session.id
      );
      await flagPaymentForManualRefund(session, "réservation annulée pendant le traitement du paiement");
      return { received: true, refunded: false, flaggedForReview: true, reason: "reservation cancelled concurrently" };
    }
    if (err.message === "HOLD_EXPIRED_OVERBOOKED" || err.message === "INVALID_SESSION_CAPACITY") {
      console.warn(
        `[confirmWorkshopReservationPayment] Hold expired and seats resold for reservation ${reservation.id}, flagging for manual refund:`,
        session.id
      );
      await prisma.workshopReservation.updateMany({
        where: { id: reservation.id, status: "PENDING_DEPOSIT" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await flagPaymentForManualRefund(session, "places épuisées avant la confirmation du paiement");
      sendEmail({
        to: reservation.customer.email,
        subject: `Places épuisées – ${reservation.session.workshop.title} – Meri Beauty`,
        text:
          `Bonjour ${reservation.customer.fullName},\n\n` +
          `Votre réservation pour l'atelier "${reservation.session.workshop.title}" a expiré avant votre paiement et les places ont depuis été réattribuées. ` +
          `Notre équipe va procéder à votre remboursement intégral sous peu. Vous pouvez réserver à nouveau si des places sont encore disponibles.\n\n` +
          `L'équipe Meri Beauty`,
        html:
          `<p>Bonjour ${reservation.customer.fullName},</p>` +
          `<p>Votre réservation pour l'atelier "${reservation.session.workshop.title}" a expiré avant votre paiement et les places ont depuis été réattribuées. ` +
          `Notre équipe va procéder à votre remboursement intégral sous peu. Vous pouvez réserver à nouveau si des places sont encore disponibles.</p>` +
          `<p>L'équipe Meri Beauty</p>`,
      }).catch((emailErr) => console.error("[confirmWorkshopReservationPayment] overbooking-refund email failed:", emailErr));
      return { received: true, refunded: false, flaggedForReview: true, reason: err.message === "INVALID_SESSION_CAPACITY" ? "invalid session capacity" : "hold expired, seats resold" };
    }
    throw err;
  }

  const sessionDate = new Date(reservation.session.startDate).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });

  const invoicePdf = invoice
    ? await renderInvoicePdf(invoice).catch((err) => {
        console.error("[confirmWorkshopReservationPayment] invoice PDF render failed:", err);
        return null;
      })
    : null;

  // Minted here, AFTER the payment transaction has committed — never inside
  // it. A unique-index collision on the generated code would otherwise sit on
  // the same rollback path as a captured Stripe charge. `ensureCheckInCode` is
  // idempotent, so the profile page's own lazy mint stays a harmless no-op.
  const checkInCode = await ensureCheckInCode(prisma, CHECK_IN_KINDS.WORKSHOP, reservation.id).catch((err) => {
    console.error("[confirmWorkshopReservationPayment] check-in code generation failed:", err);
    return null;
  });

  // The ticket goes out with the confirmation rather than living only in
  // "Mon compte": the customer needs it at the door, on their phone, and most
  // never open their account page.
  const ticketQr = checkInCode
    ? await qrPngAttachment(checkInCode, `billet-atelier-${checkInCode}.png`).catch((err) => {
        console.error("[confirmWorkshopReservationPayment] ticket QR generation failed:", err);
        return null;
      })
    : null;

  const emailAttachments = [
    ...(invoicePdf ? [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] : []),
    ...(ticketQr ? [ticketQr] : []),
  ];

  sendEmail({
    to: reservation.customer.email,
    ...workshopReservationConfirmationEmail({
      customerName: reservation.customer.fullName,
      activityTitle: reservation.session.workshop.title,
      sessionDate,
      seatsCount: reservation.seatsCount,
      paidAmount,
      totalAmount,
      balanceDue: Number(reservation.balanceDue),
      isFullPayment,
      checkInCode,
    }),
    ...(emailAttachments.length ? { attachments: emailAttachments } : {}),
  }).catch((err) => console.error("[confirmWorkshopReservationPayment] confirmation email failed:", err));

  // Fire-and-forget: the one place seat counts actually change from a real
  // payment event, so this is where the low-seats threshold gets checked.
  sendLowSeatsBroadcast(reservation.sessionId).catch((err) =>
    console.error("[confirmWorkshopReservationPayment] low-seats broadcast failed:", err)
  );

  return { received: true, processed: true };
}
