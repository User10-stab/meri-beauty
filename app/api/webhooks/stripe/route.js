import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  paymentConfirmationEmail,
  welcomeWithCredentialsEmail,
} from "@/lib/email-templates";
import { fulfillOrderPayment } from "@/actions/boutique/orders";

const BCRYPT_SALT_ROUNDS = 12;
const LOGIN_URL = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/login`
  : "https://meribeauty.com/login";

/**
 * Stripe webhook handler.
 *
 * Processes `checkout.session.completed` for reservation payments created by
 * actions/payment/createCheckoutSession.js. All reservation data travels in the
 * session metadata — no DB records exist until this handler runs.
 *
 * Idempotency: the session id is stored on Payment.transactionReference and
 * checked before processing, so Stripe's retry deliveries are harmless.
 *
 * Edge case: if the slot was taken between checkout start and payment
 * completion, the payment is automatically refunded and the customer notified —
 * no appointment is created.
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

  // ── 2. Only handle completed checkouts; acknowledge everything else ──────
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
    // Order checkouts carry metadata.kind === "order" (see
    // actions/boutique/orders.js#createOrderCheckoutSession); anything else
    // is the appointment reservation flow, unchanged from before.
    const result =
      session.metadata?.kind === "order"
        ? await fulfillOrderPayment(session)
        : await processCheckoutSession(session);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[stripe-webhook] Processing failed:", err);
    // 500 → Stripe retries the delivery. Idempotency check makes retries safe.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

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
  await prisma.$transaction(async (tx) => {
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
  });

  // ── 10. Emails — fire-and-forget, never fail the webhook ─────────────────
  const staffName = staffService.staff?.user?.fullName ?? "votre experte";
  const serviceName = staffService.service?.name ?? "votre service";

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
