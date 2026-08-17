import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { formationReservationConfirmationEmail } from "@/lib/email-templates";
import { issueInvoice, buildInvoiceCustomer, buildServiceInvoiceLines } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { sendFormationLowSeatsBroadcast } from "@/lib/formations/notify-low-seats";
import { refundSession } from "@/lib/stripe-refund-session";

// 1-cent tolerance for float/rounding when comparing Stripe's amount_total
// against our own expected-price calculation.
const UNDERPAYMENT_EPSILON = 0.01;

/**
 * Confirms a FormationReservation's initial (deposit or full) payment —
 * called by the Stripe webhook (checkout.session.completed) for a real
 * payment, or directly with a synthetic zero-amount `session` when a 100%
 * promo code covers the whole price and there's nothing for Stripe to
 * charge (see createFormationReservationCheckoutSession). Both callers must
 * get identical business logic — this is the single implementation, not a
 * parallel one, so a future change here can't silently diverge between the
 * real-payment and free-booking paths.
 *
 * A synthetic session only needs: id (unique, for the idempotency key),
 * metadata.reservationId, metadata.formationAction, amount_total (0),
 * payment_intent (null — refundSession no-ops without one).
 */
export async function confirmFormationReservationPayment(session) {
  const meta = session.metadata ?? {};
  const { reservationId, formationAction } = meta;

  if (!reservationId) {
    console.error("[confirmFormationReservationPayment] missing reservationId:", session.id, meta);
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

  const reservation = await prisma.formationReservation.findUnique({
    where: { id: reservationId },
    include: {
      session: { include: { formation: true } },
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
    console.error("[confirmFormationReservationPayment] FormationReservation gone, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation deleted" };
  }

  // Same failed-sale safety net as the workshops flow — never a customer
  // refund feature, since formations have no refund policy at all otherwise.
  if (reservation.status === "CANCELLED") {
    console.warn("[confirmFormationReservationPayment] Formation reservation cancelled before payment cleared, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation cancelled" };
  }

  if (reservation.status === "CONFIRMED") {
    // Already confirmed by a previous delivery of this same webhook event.
    return { received: true, alreadyProcessed: true };
  }

  const isFullPayment = formationAction === "full_payment";
  const totalAmount = Number(reservation.totalPrice);
  const paidAmount = (session.amount_total ?? 0) / 100;

  const expectedAmount = isFullPayment ? totalAmount : Number(reservation.depositAmount);
  if (paidAmount + UNDERPAYMENT_EPSILON < expectedAmount) {
    console.error(`[confirmFormationReservationPayment] UNDERPAYMENT: paid ${paidAmount} expected ${expectedAmount} for session ${session.id}`);
    await refundSession(session);
    return { received: true, refunded: true, reason: "underpayment" };
  }

  let invoice;
  try {
  ({ invoice } = await prisma.$transaction(async (tx) => {
    await tx.formationReservation.update({
      where: { id: reservation.id },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });

    const payment = await tx.payment.create({
      data: {
        formationReservationId: reservation.id,
        depositAmount: isFullPayment ? 0 : paidAmount,
        totalAmount,
        paidAmount,
        remainingAmount: Math.max(totalAmount - paidAmount, 0),
        paymentType: isFullPayment ? "ONLINE" : "DEPOSIT",
        status: isFullPayment ? "PAID" : "PARTIALLY_PAID",
        paidAt: new Date(),
        transactionReference: session.id, // idempotency key
        promoCodeId: reservation.promoCodeId,
        discountAmount: reservation.discountAmount,
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
    // due in-salon, invoiced once that's collected (same rule as workshops).
    let invoice = null;
    if (isFullPayment) {
      invoice = await issueInvoice(tx, {
        paymentId: payment.id,
        source: "FORMATION",
        totalInclVat: paidAmount,
        customer: buildInvoiceCustomer(reservation.customer),
        // See the matching workshop invoice comment above: quantity 1 at the
        // actual total avoids a divide-then-round line/total mismatch. Any
        // promo discount gets its own line (see buildServiceInvoiceLines).
        lines: buildServiceInvoiceLines({
          description: `${reservation.session.formation.title} (${reservation.seatsCount} place${reservation.seatsCount > 1 ? "s" : ""})`,
          totalAmount,
          discountAmount: Number(reservation.discountAmount),
        }),
      });
    }

    return { invoice };
  }));
  } catch (err) {
    if (err.code === "P2002") {
      return { received: true, alreadyProcessed: true };
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
        console.error("[confirmFormationReservationPayment] invoice PDF render failed:", err);
        return null;
      })
    : null;

  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { phone: true, email: true } });

  sendEmail({
    to: reservation.customer.email,
    ...formationReservationConfirmationEmail({
      customerName: reservation.customer.fullName,
      formationTitle: reservation.session.formation.title,
      sessionDate,
      seatsCount: reservation.seatsCount,
      paidAmount,
      totalAmount,
      balanceDue: Number(reservation.balanceDue),
      isFullPayment,
      salonPhone: salon?.phone,
      salonEmail: salon?.email,
    }),
    ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
  }).catch((err) => console.error("[confirmFormationReservationPayment] confirmation email failed:", err));

  sendFormationLowSeatsBroadcast(reservation.sessionId).catch((err) =>
    console.error("[confirmFormationReservationPayment] low-seats broadcast failed:", err)
  );

  return { received: true, processed: true };
}
