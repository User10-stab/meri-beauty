import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  paymentConfirmationEmail,
  welcomeWithCredentialsEmail,
  workshopReservationConfirmationEmail,
  workshopSessionChangeEmail,
} from "@/lib/email-templates";
import { fulfillOrderPayment } from "@/actions/boutique/orders";
import { issueInvoice } from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { sendLowSeatsBroadcast } from "@/actions/workshops/notify-low-seats";
import { notifyAllInWaitingList } from "@/actions/workshops/waiting-list";

const BCRYPT_SALT_ROUNDS = 12;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

/**
 * Stripe webhook handler.
 *
 * Handles two independent event families:
 *   - `checkout.session.completed` — boutique orders and appointment
 *     reservation payments created by createOrderCheckoutSession /
 *     actions/payment/createCheckoutSession.js. All reservation data
 *     travels in the session metadata — no DB records exist until this
 *     handler runs for the appointment path.
 *   - `account.updated` — Stripe Connect status changes for staff payout
 *     accounts (onboarding completed, charges/payouts enabled toggled).
 *
 * Idempotency (checkout.session.completed): the session id is stored on
 * Payment.transactionReference and checked before processing, so Stripe's
 * retry deliveries are harmless. account.updated is naturally idempotent —
 * it always just overwrites the staff row with the latest snapshot.
 *
 * Edge case (checkout.session.completed, appointments only): if the slot
 * was taken between checkout start and payment completion, the payment is
 * automatically refunded and the customer notified — no appointment is
 * created.
 */
export async function POST(req) {
  // ── 1. Verify the signature against the raw body ─────────────────────────
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event;
  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── 2. Route by event type ────────────────────────────────────────────────
  if (event.type === "account.updated") {
    try {
      await handleAccountUpdated(event.data.object);
      return NextResponse.json({ received: true });
    } catch (err) {
      console.error("[stripe-webhook] account.updated processing failed:", err);
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object;

  // Async payment methods can complete with payment_status "unpaid" — ignore
  // until the payment actually settles.
  if (session.payment_status !== "paid") {
    return NextResponse.json({ received: true });
  }

  try {
    // Dispatch by metadata.kind: "order" (boutique, createOrderCheckoutSession),
    // "workshop" (workshop deposit/full-payment/session-change-fee, see
    // actions/workshops/create-workshop-reservation.js and manage-reservation.js),
    // anything else falls through to the appointment reservation flow.
    let result;
    if (session.metadata?.kind === "order") {
      result = await fulfillOrderPayment(session);
    } else if (session.metadata?.kind === "workshop") {
      result = await processWorkshopCheckoutSession(session);
    } else {
      result = await processCheckoutSession(session);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[stripe-webhook] Processing failed:", err);
    // 500 → Stripe retries the delivery. Idempotency check makes retries safe.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

// ─── account.updated (Stripe Connect) ────────────────────────────────────────

/**
 * Handle stripe.account.updated event.
 *
 * Stripe sends this event whenever a connected account's status changes,
 * including after the user completes onboarding, updates their bank details,
 * or when their account capabilities change.
 */
async function handleAccountUpdated(account) {
  const { id: stripeAccountId, charges_enabled, payouts_enabled } = account;

  if (!stripeAccountId) {
    console.warn("[stripe-webhook] account.updated event missing account ID");
    return;
  }

  const staff = await prisma.staff.findUnique({
    where: { stripeAccountId },
    select: { id: true },
  });

  if (!staff) {
    console.warn(
      `[stripe-webhook] No staff found for Stripe account: ${stripeAccountId}`
    );
    return;
  }

  await prisma.staff.update({
    where: { id: staff.id },
    data: {
      stripeChargesEnabled: charges_enabled ?? false,
      stripePayoutsEnabled: payouts_enabled ?? false,
    },
  });

  console.log(
    `[stripe-webhook] Updated staff ${staff.id}: ` +
    `charges_enabled=${charges_enabled}, payouts_enabled=${payouts_enabled}`
  );
}

// ─── checkout.session.completed (appointments) ───────────────────────────────

async function processCheckoutSession(session) {
  const meta = session.metadata ?? {};
  const {
    staffServiceId,
    date,
    time,
    notes,
    customerFullName,
    customerEmail,
    customerPhone,
    customerUserId,
    newsletterSubscribed,
    paymentMethod,
  } = meta;

  if (!staffServiceId || !date || !time || !customerEmail) {
    // Malformed metadata is not retryable — acknowledge and log loudly.
    console.error("[stripe-webhook] Session missing metadata:", session.id, meta);
    return { received: true, warning: "missing metadata" };
  }

  // ── 3. Idempotency — was this session already processed? ─────────────────
  const existing = await prisma.payment.findFirst({
    where: { transactionReference: session.id },
    select: { id: true },
  });
  if (existing) {
    return { received: true, alreadyProcessed: true };
  }

  // ── 4. Load the staff service ─────────────────────────────────────────────
  const staffService = await prisma.staffService.findUnique({
    where: { id: staffServiceId },
    include: {
      service: true,
      staff: { include: { user: { select: { fullName: true } } } },
    },
  });

  if (!staffService) {
    // Paid for a service that no longer exists — refund and stop.
    console.error("[stripe-webhook] StaffService gone, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "service deleted" };
  }

  // ── 5. Rebuild appointment times (same logic as createCheckoutSession) ───
  const [hour, minute] = time.split(":").map(Number);
  const appointmentDate = new Date(date);
  appointmentDate.setHours(0, 0, 0, 0);

  const startTime = new Date(appointmentDate);
  startTime.setHours(hour, minute, 0, 0);

  const endTime = new Date(startTime);
  endTime.setMinutes(endTime.getMinutes() + staffService.duration);

  // ── 6. Slot still free? If not: refund, notify, create nothing ───────────
  const conflict = await prisma.appointment.findFirst({
    where: {
      staffServiceId,
      date: appointmentDate,
      startTime: { lte: endTime },
      endTime: { gte: startTime },
      status: { in: ["PENDING", "CONFIRMED"] },
      isDeleted: false,
    },
  });

  if (conflict) {
    console.warn("[stripe-webhook] Slot conflict after payment, refunding:", session.id);
    await refundSession(session);

    sendEmail({
      to: customerEmail,
      subject: "Créneau indisponible – Remboursement effectué – Meri Beauty",
      text:
        `Bonjour ${customerFullName},\n\n` +
        `Le créneau que vous aviez choisi a malheureusement été réservé pendant votre paiement. ` +
        `Votre paiement a été intégralement remboursé — le remboursement apparaîtra sur votre compte sous quelques jours.\n\n` +
        `Nous vous invitons à choisir un autre créneau sur notre site.\n\n` +
        `Toutes nos excuses pour ce contretemps,\nL'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${customerFullName},</p>` +
        `<p>Le créneau que vous aviez choisi a malheureusement été réservé pendant votre paiement. ` +
        `Votre paiement a été <strong>intégralement remboursé</strong> — il apparaîtra sur votre compte sous quelques jours.</p>` +
        `<p>Nous vous invitons à choisir un autre créneau sur notre site.</p>` +
        `<p>Toutes nos excuses pour ce contretemps,<br/>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[stripe-webhook] conflict email failed:", err));

    return { received: true, refunded: true, reason: "slot conflict" };
  }

  // ── 7. Resolve or create the customer (mirrors createReservation) ────────
  let user = null;
  let isNewUser = false;
  let temporaryPassword = null;

  if (customerUserId) {
    user = await prisma.user.findUnique({
      where: { id: customerUserId, isDeleted: false },
    });
  }

  if (!user) {
    user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: customerEmail.trim().toLowerCase() },
          ...(customerPhone ? [{ phone: customerPhone.trim() }] : []),
        ],
        isDeleted: false,
      },
    });
  }

  if (!user) {
    temporaryPassword = randomBytes(9).toString("base64url");
    const hashedPassword = await bcrypt.hash(temporaryPassword, BCRYPT_SALT_ROUNDS);

    user = await prisma.user.create({
      data: {
        fullName: (customerFullName || customerEmail).trim(),
        email: customerEmail.trim().toLowerCase(),
        phone: (customerPhone || "").trim(),
        password: hashedPassword,
        role: "CUSTOMER",
        emailVerified: true,
        isActive: true,
        newsletterSubscribed: newsletterSubscribed === "true",
      },
    });
    isNewUser = true;
  }

  // ── 8. Amounts — what Stripe actually charged is the source of truth ─────
  const totalAmount = Number(staffService.price);
  const paidAmount = (session.amount_total ?? 0) / 100;
  const isFullPayment = paymentMethod === "ONLINE";

  // ── 9. Create appointment + payment + transaction atomically ─────────────
  const { invoice } = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        userId: user.id,
        staffServiceId,
        date: appointmentDate,
        startTime,
        endTime,
        status: "CONFIRMED", // money received — confirmed immediately
        notes: notes || null,
      },
    });

    const payment = await tx.payment.create({
      data: {
        appointmentId: appointment.id,
        depositAmount: isFullPayment ? 0 : paidAmount,
        totalAmount,
        paidAmount,
        remainingAmount: Math.max(totalAmount - paidAmount, 0),
        paymentType: isFullPayment ? "ONLINE" : "DEPOSIT",
        status: isFullPayment ? "PAID" : "PARTIALLY_PAID",
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
      },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        appointmentId: appointment.id,
        type: "APPOINTMENT_CONFIRMED",
        title: "Réservation confirmée",
        message: `Votre réservation du ${appointmentDate.toLocaleDateString("fr-FR")} à ${time} est confirmée.`,
        status: "PENDING",
      },
    });

    await tx.notification.create({
      data: {
        userId: user.id,
        appointmentId: appointment.id,
        type: "PAYMENT_RECEIVED",
        title: "Paiement reçu",
        message: `Paiement de €${paidAmount.toFixed(2)} reçu avec succès.`,
        status: "PENDING",
      },
    });

    // Only fully-settled payments are invoiced — a deposit (PARTIALLY_PAID)
    // has a balance still due in-salon, invoiced once that's collected.
    let invoice = null;
    if (isFullPayment) {
      invoice = await issueInvoice(tx, {
        paymentId: payment.id,
        source: "APPOINTMENT",
        totalInclVat: paidAmount,
        customer: { fullName: user.fullName, email: user.email, vatNumber: user.vatNumber },
        lines: [{ description: staffService.service?.name ?? "Prestation", quantity: 1, unitPrice: totalAmount }],
      });
    }

    return { invoice };
  });

  // ── 10. Emails — fire-and-forget, never fail the webhook ─────────────────
  const staffName = staffService.staff?.user?.fullName ?? "votre experte";
  const serviceName = staffService.service?.name ?? "votre service";

  const invoicePdf = invoice
    ? await renderInvoicePdf(invoice).catch((err) => {
        console.error("[stripe-webhook] invoice PDF render failed:", err);
        return null;
      })
    : null;

  sendEmail({
    to: user.email,
    ...paymentConfirmationEmail({
      customerName: user.fullName,
      serviceName,
      staffName,
      date: appointmentDate,
      time,
      paidAmount,
      totalAmount,
      paymentMethod: "Carte bancaire",
    }),
    ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
  }).catch((err) => console.error("[stripe-webhook] confirmation email failed:", err));

  if (isNewUser && temporaryPassword) {
    sendEmail({
      to: user.email,
      ...welcomeWithCredentialsEmail({
        customerName: user.fullName,
        email: user.email,
        temporaryPassword,
        loginUrl: LOGIN_URL,
      }),
    }).catch((err) => console.error("[stripe-webhook] welcome email failed:", err));
  }

  return { received: true, processed: true };
}

// ─── checkout.session.completed (workshops/events) ───────────────────────────

async function processWorkshopCheckoutSession(session) {
  const meta = session.metadata ?? {};
  const { reservationId, workshopAction } = meta;

  if (!reservationId) {
    console.error("[stripe-webhook] Workshop session missing reservationId:", session.id, meta);
    return { received: true, warning: "missing metadata" };
  }

  // Session-change fees are charged against an EXISTING confirmed
  // reservation that already has its one Payment row (Payment.
  // workshopReservationId is 1:1) — handled separately since there's no
  // new Payment to create, just a Transaction against the existing one.
  if (workshopAction === "session_change_fee") {
    return applyWorkshopSessionChangeFee(session, meta);
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
    include: { session: { include: { workshop: true } }, customer: true },
  });

  if (!reservation) {
    console.error("[stripe-webhook] WorkshopReservation gone, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation deleted" };
  }

  // The salon can't honor a sale it already voided (e.g. an admin cancelled
  // this reservation while the payment was in flight) — this is the one
  // exception to "no refunds": a failed sale, not a voluntary cancellation
  // of an honored booking.
  if (reservation.status === "CANCELLED") {
    console.warn("[stripe-webhook] Reservation cancelled before payment cleared, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation cancelled" };
  }

  if (reservation.status === "CONFIRMED") {
    // Already confirmed by a previous delivery of this same webhook event.
    return { received: true, alreadyProcessed: true };
  }

  const isFullPayment = workshopAction === "full_payment";
  const totalAmount = Number(reservation.totalPrice);
  const paidAmount = (session.amount_total ?? 0) / 100;

  const { invoice } = await prisma.$transaction(async (tx) => {
    await tx.workshopReservation.update({
      where: { id: reservation.id },
      data: { status: "CONFIRMED", holdExpiresAt: null },
    });

    const payment = await tx.payment.create({
      data: {
        workshopReservationId: reservation.id,
        depositAmount: isFullPayment ? 0 : paidAmount,
        totalAmount,
        paidAmount,
        remainingAmount: Math.max(totalAmount - paidAmount, 0),
        paymentType: isFullPayment ? "ONLINE" : "DEPOSIT",
        status: isFullPayment ? "PAID" : "PARTIALLY_PAID",
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
        customer: {
          fullName: reservation.customer.fullName,
          email: reservation.customer.email,
          vatNumber: reservation.customer.vatNumber,
        },
        lines: [
          {
            description: reservation.session.workshop.title,
            quantity: reservation.seatsCount,
            unitPrice: totalAmount / reservation.seatsCount,
          },
        ],
      });
    }

    return { invoice };
  });

  const sessionDate = new Date(reservation.session.startDate).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const invoicePdf = invoice
    ? await renderInvoicePdf(invoice).catch((err) => {
        console.error("[stripe-webhook] workshop invoice PDF render failed:", err);
        return null;
      })
    : null;

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
    }),
    ...(invoicePdf ? { attachments: [{ filename: `facture-${invoice.number}.pdf`, content: invoicePdf }] } : {}),
  }).catch((err) => console.error("[stripe-webhook] workshop confirmation email failed:", err));

  // Fire-and-forget: the one place seat counts actually change from a real
  // payment event, so this is where the low-seats threshold gets checked.
  sendLowSeatsBroadcast(reservation.sessionId).catch((err) =>
    console.error("[stripe-webhook] low-seats broadcast failed:", err)
  );

  return { received: true, processed: true };
}

/** Applies an admin-mediated session change once its 10% fee has cleared. */
async function applyWorkshopSessionChangeFee(session, meta) {
  const { reservationId, newSessionId } = meta;

  if (!reservationId || !newSessionId) {
    console.error("[stripe-webhook] session_change_fee missing metadata:", session.id, meta);
    return { received: true, warning: "missing metadata" };
  }

  const reservation = await prisma.workshopReservation.findUnique({
    where: { id: reservationId },
    include: { session: { include: { workshop: true } }, customer: true, payment: true },
  });

  if (!reservation) {
    console.error("[stripe-webhook] WorkshopReservation gone for session change, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation deleted" };
  }

  if (reservation.sessionId === newSessionId) {
    // Already applied — a Stripe retry of the same event.
    return { received: true, alreadyProcessed: true };
  }

  const newSession = await prisma.workshopSession.findUnique({
    where: { id: newSessionId },
    include: { workshop: true },
  });
  if (!newSession) {
    console.error("[stripe-webhook] Target session gone for session change, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "target session deleted" };
  }

  const changeFeeAmount = (session.amount_total ?? 0) / 100;
  const oldSessionId = reservation.sessionId;
  const oldSessionDate = new Date(reservation.session.startDate);

  await prisma.$transaction(async (tx) => {
    await tx.workshopReservation.update({
      where: { id: reservation.id },
      data: {
        sessionId: newSessionId,
        previousSessionId: oldSessionId,
        changeFeeAmount: { increment: changeFeeAmount },
      },
    });

    if (reservation.payment) {
      await tx.transaction.create({
        data: {
          paymentId: reservation.payment.id,
          amount: changeFeeAmount,
          method: "ONLINE",
          transactionType: "FINAL_PAYMENT",
          paidAt: new Date(),
        },
      });
    }
  });

  // The old session just freed up the seats this reservation held.
  notifyAllInWaitingList(oldSessionId).catch((err) =>
    console.error("[stripe-webhook] waiting-list notify failed:", err)
  );

  const dateOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };

  sendEmail({
    to: reservation.customer.email,
    ...workshopSessionChangeEmail({
      customerName: reservation.customer.fullName,
      activityTitle: reservation.session.workshop.title,
      previousSessionDate: oldSessionDate.toLocaleDateString("fr-FR", dateOptions),
      newSessionDate: new Date(newSession.startDate).toLocaleDateString("fr-FR", dateOptions),
      changeFeeAmount,
    }),
  }).catch((err) => console.error("[stripe-webhook] session change email failed:", err));

  return { received: true, processed: true };
}

/** Refunds the payment behind a checkout session. */
async function refundSession(session) {
  if (!session.payment_intent) return;
  try {
    await stripe.refunds.create({ payment_intent: session.payment_intent });
  } catch (err) {
    // Log — the money question must never be silently swallowed.
    console.error("[stripe-webhook] REFUND FAILED for", session.id, err);
    throw err; // 500 → Stripe retries → refund retried
  }
}
