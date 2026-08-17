import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  paymentConfirmationEmail,
  reservationPaymentFailedEmail,
  staffReservationConfirmedEmail,
  workshopSessionChangeEmail,
  workshopSeatsChangeEmail,
  staffPaymentFailedEmail,
} from "@/lib/email-templates";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";
import { confirmWorkshopReservationPayment } from "@/lib/workshops/fulfill-workshop-reservation-payment";
import { confirmFormationReservationPayment } from "@/lib/formations/fulfill-formation-reservation-payment";
import { issueCreditNote } from "@/lib/invoicing";
import {
  createNotificationsBulk,
  buildAppointmentConfirmedNotification,
  buildAppointmentCancelledNotification,
  getAppointmentNotificationRecipients,
  getAppointmentEmailRecipients,
} from "@/lib/notifications";
import { notifyAllInWaitingList } from "@/lib/workshops/notify-waiting-list";
import { Prisma } from "@prisma/client";
import { reconcileStripeProductOrderRefund } from "@/lib/orders/reconcile-stripe-refund";
import {
  reconcileExceptionalReservationFullRefund,
  RESERVATION_REFUND_AUTHORIZATION,
} from "@/lib/payments/reconcile-reservation-refund";
import { captureCriticalError } from "@/lib/monitoring";
import { refundSession } from "@/lib/stripe-refund-session";

// 1-cent tolerance for float/rounding when comparing Stripe's amount_total
// against our own expected-price calculation.
const UNDERPAYMENT_EPSILON = 0.01;

/**
 * Stripe webhook handler.
 *
 * Handles three independent event families:
 *   - `checkout.session.completed` — boutique orders, workshops, and
 *     formations are all metadata-driven: no DB records exist until this
 *     handler creates them. Appointments are the exception — the Appointment
 *     + Payment rows already exist (PENDING) by the time Stripe redirects
 *     back here, created by actions/payment/createCheckoutSession.js under
 *     an advisory lock; this handler only confirms the amount and flips
 *     their status. Appointment payments are Stripe Connect direct charges
 *     on the staff member's own connected account.
 *   - `account.updated` — Stripe Connect status changes for staff payout
 *     accounts (onboarding completed, charges/payouts enabled toggled).
 *   - `payment_intent.payment_failed` — cancels the appointment tied to a
 *     failed direct-charge payment intent so it doesn't sit PENDING forever.
 *
 * Idempotency (checkout.session.completed): the session id is stored on
 * Payment.transactionReference (orders/workshops/formations) or checked via
 * a locked Payment.status read (appointments) before processing, so Stripe's
 * retry deliveries are harmless. account.updated is naturally idempotent —
 * it always just overwrites the staff row with the latest snapshot.
 *
 * Edge case (checkout.session.completed, orders/workshops/formations only):
 * if the slot/stock was taken between checkout start and payment completion,
 * the payment is automatically refunded and the customer notified.
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
      captureCriticalError(err, { area: "stripe-webhook", eventType: event.type, eventId: event.id });
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    try {
      await handlePaymentIntentFailed(event.data.object, event.account);
      return NextResponse.json({ received: true });
    } catch (err) {
      captureCriticalError(err, { area: "stripe-webhook", eventType: event.type, eventId: event.id });
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Dashboard-initiated refunds (staff refunding directly in Stripe instead
  // of through our own refund actions) would otherwise leave Payment.status
  // stuck on PAID and the ledger silently wrong — this keeps them in sync.
  // Only reaches platform-account charges (boutique/workshop/formation);
  // appointment payments are Connect direct charges on the staff's own
  // account, which this platform-level webhook doesn't receive events for
  // (needs the separate Connect webhook endpoint — see P10 in
  // PRE_LAUNCH_FIXES.md).
  if (event.type === "charge.refunded") {
    try {
      await handleChargeRefunded(event.data.object);
      return NextResponse.json({ received: true });
    } catch (err) {
      captureCriticalError(err, { area: "refund-reconciliation", eventType: event.type, eventId: event.id });
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  if (event.type === "charge.dispute.created") {
    try {
      await handleChargeDisputeCreated(event.data.object);
      return NextResponse.json({ received: true });
    } catch (err) {
      captureCriticalError(err, { area: "stripe-webhook", eventType: event.type, eventId: event.id });
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Keeps the dashboard dossier's status in sync as Stripe moves the dispute
  // through review and to a final outcome — the dossier fields staff fill in
  // (assignee, response sent, proof, conclusion) are untouched here.
  if (event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
    try {
      await handleChargeDisputeStatusChanged(event.data.object);
      return NextResponse.json({ received: true });
    } catch (err) {
      captureCriticalError(err, { area: "stripe-webhook", eventType: event.type, eventId: event.id });
      return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
  }

  // Delayed-notification payment methods (bank debits, etc.) resolve after
  // the initial checkout.session.completed delivery already saw
  // payment_status "unpaid" and was ignored below. Card (the only method
  // currently enabled) doesn't work this way today, but handling both
  // explicitly means nothing silently falls through if that ever changes
  // (e.g. Bancontact gets re-enabled).
  if (event.type === "checkout.session.async_payment_failed") {
    const failedSession = event.data.object;
    console.warn(`[stripe-webhook] async payment failed for checkout session ${failedSession.id}`, {
      kind: failedSession.metadata?.kind ?? "appointment",
      metadata: failedSession.metadata,
    });
    await notifyAppointmentPaymentFailed({
      paymentId: failedSession.metadata?.paymentId,
      appointmentId: failedSession.metadata?.appointmentId,
      failedSessionId: failedSession.id,
    });
    return NextResponse.json({ received: true });
  }

  if (event.type === "checkout.session.expired") {
    const expiredSession = event.data.object;
    console.info(`[stripe-webhook] checkout session expired: ${expiredSession.id}`, {
      kind: expiredSession.metadata?.kind ?? "appointment",
    });
    await notifyAppointmentPaymentFailed({
      paymentId: expiredSession.metadata?.paymentId,
      appointmentId: expiredSession.metadata?.appointmentId,
      failedSessionId: expiredSession.id,
    });
    return NextResponse.json({ received: true });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object;

  // Async payment methods can complete with payment_status "unpaid" — ignore
  // until the payment actually settles. (checkout.session.async_payment_succeeded
  // only ever fires once it has, but this stays as a shared safety check for
  // both event types rather than being duplicated per-branch.)
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
      // Session/seat-change fees are charged against an EXISTING confirmed
      // reservation that already has its one Payment row — handled
      // separately since there's no new Payment to create, just a
      // Transaction against the existing one. Anything else is the initial
      // deposit/full-payment booking confirmation.
      const workshopAction = session.metadata?.workshopAction;
      if (workshopAction === "session_change_fee") {
        result = await applyWorkshopSessionChangeFee(session, session.metadata);
      } else if (workshopAction === "seats_change_fee") {
        result = await applyWorkshopSeatsChangeFee(session, session.metadata);
      } else {
        result = await confirmWorkshopReservationPayment(session);
      }
    } else if (session.metadata?.kind === "formation") {
      result = await confirmFormationReservationPayment(session);
    } else {
      result = await processAppointmentCheckoutSession(session);
    }
    return NextResponse.json(result);
  } catch (err) {
    captureCriticalError(err, {
      area: "stripe-webhook",
      eventType: event.type,
      eventId: event.id,
      kind: session.metadata?.kind ?? "appointment",
      sessionId: session.id,
    });
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

// ─── charge.refunded / charge.dispute.created ────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve a Stripe charge back to our Payment row. All 4 flows store the
 * Checkout Session id on Payment.transactionReference (see
 * createCheckoutSession.js, createOrderCheckoutSession, workshop/formation
 * reservation actions), so payment_intent -> session -> Payment is the one
 * lookup path that works everywhere a session id is all we're given.
 */
async function findPaymentByChargePaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  const session = sessions.data[0];
  if (!session) return null;
  return prisma.payment.findUnique({
    where: { transactionReference: session.id },
    include: {
      invoice: true,
      transactions: true,
      order: { include: { items: true } },
      workshopReservation: true,
      formationReservation: true,
    },
  });
}

/**
 * Keeps our ledger honest when a refund happens outside our own refund
 * actions — most commonly staff refunding directly from the Stripe
 * Dashboard. Without this, Payment.status stays PAID and there's no
 * Transaction{REFUND} row, so the dashboard and any TVA/accounting export
 * silently disagree with what Stripe actually did.
 */
async function handleChargeRefunded(charge) {
  const payment = await findPaymentByChargePaymentIntent(charge.payment_intent);
  if (!payment) {
    // Most likely an appointment (Connect direct charge) — not reachable
    // from this platform-level webhook, see the P10 note above.
    console.warn(`[stripe-webhook] charge.refunded: no matching Payment for payment_intent ${charge.payment_intent}`);
    return;
  }

  const stripeRefundedTotal = round2((charge.amount_refunded ?? 0) / 100);
  const stripePaymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const stripeRefundId = charge.refunds?.data?.at(-1)?.id ?? null;
  let reservationReconciliation = null;

  const result = await prisma.$transaction(async (tx) => {
    if (payment.orderId) {
      const orderResult = await reconcileStripeProductOrderRefund(tx, {
        paymentId: payment.id,
        stripeRefundedTotal,
        stripePaymentIntentId,
        stripeRefundId,
      });
      if (orderResult.newlyRefunded > 0.01 && payment.invoice) {
        await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: "Remboursement effectué depuis le Dashboard Stripe",
          totalInclVat: orderResult.newlyRefunded,
        });
      }
      return orderResult;
    }

    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`external-refund:${payment.id}`}))`,
    );
    const lockedPayment = await tx.payment.findUnique({
      where: { id: payment.id },
      include: {
        invoice: true,
        transactions: true,
        workshopReservation: true,
        formationReservation: true,
      },
    });
    const alreadyRecorded = lockedPayment.transactions
      .filter((transaction) => transaction.transactionType === "REFUND")
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const newlyRefunded = round2(stripeRefundedTotal - alreadyRecorded);
    const fullyRefunded = stripeRefundedTotal + 0.01 >= Number(lockedPayment.paidAmount);

    if (stripePaymentIntentId) {
      await tx.transaction.updateMany({
        where: {
          paymentId: lockedPayment.id,
          transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] },
          stripePaymentIntentId: null,
        },
        data: { stripePaymentIntentId },
      });
    }
    if (newlyRefunded <= 0.01) {
      return { handled: true, newlyRefunded: 0, fullyRefunded, alreadyProcessed: true };
    }

    await tx.transaction.create({
      data: {
        paymentId: lockedPayment.id,
        amount: newlyRefunded,
        method: "ONLINE",
        transactionType: "REFUND",
        paidAt: new Date(),
        stripePaymentIntentId,
      },
    });
    await tx.payment.update({
      where: { id: lockedPayment.id },
      data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });
    if (lockedPayment.invoice) {
      await issueCreditNote(tx, {
        invoiceId: lockedPayment.invoice.id,
        reason: "Remboursement effectué depuis le Dashboard Stripe",
        totalInclVat: newlyRefunded,
      });
    }

    reservationReconciliation = await reconcileExceptionalReservationFullRefund(tx, {
      payment: lockedPayment,
      stripeRefundedTotal,
      authorization: RESERVATION_REFUND_AUTHORIZATION.ADMIN_EXTERNAL_STRIPE_REFUND,
    });
    return { handled: true, newlyRefunded, fullyRefunded, stripeRefundId };
  });

  if (reservationReconciliation?.reconciled) {
    const notification = reservationReconciliation.reservationKind === "workshop"
      ? notifyAllInWaitingList(reservationReconciliation.sessionId)
      : import("@/lib/formations/notify-waiting-list").then(({ notifyAllInFormationWaitingList }) =>
          notifyAllInFormationWaitingList(reservationReconciliation.sessionId));
    notification.catch((err) =>
      console.error("[stripe-webhook] refund waiting-list notification failed:", err));
  }

  console.info(
    `[stripe-webhook] Synced Dashboard-initiated refund for payment ${payment.id}: €${result.newlyRefunded ?? 0}`,
    { stripePaymentIntentId, stripeRefundId },
  );
}

// Stripe's raw dispute.status values, mapped to our DisputeStatus enum.
function mapStripeDisputeStatus(status) {
  const known = [
    "NEEDS_RESPONSE",
    "UNDER_REVIEW",
    "WARNING_NEEDS_RESPONSE",
    "WARNING_UNDER_REVIEW",
    "WARNING_CLOSED",
    "WON",
    "LOST",
    "CHARGE_REFUNDED",
  ];
  const upper = String(status ?? "").toUpperCase();
  return known.includes(upper) ? upper : "NEEDS_RESPONSE";
}

/**
 * A dispute is provisional (Stripe hasn't decided the outcome yet) and has
 * a response deadline, so this deliberately does NOT change Payment.status
 * — there's no correct status to set until it resolves. This only makes
 * sure a human finds out, since disputes lost by default (no response) cost
 * both the sale and a Stripe dispute fee.
 *
 * Also creates the persistent dashboard dossier (StripeDispute) — the email
 * alert alone was a one-shot notification with nowhere durable to track who's
 * handling it, what was submitted, or the eventual outcome.
 */
async function handleChargeDisputeCreated(dispute) {
  const payment = await findPaymentByChargePaymentIntent(dispute.payment_intent);
  const amount = round2((dispute.amount ?? 0) / 100);

  if (payment) {
    await prisma.stripeDispute.upsert({
      where: { stripeDisputeId: dispute.id },
      create: {
        stripeDisputeId: dispute.id,
        paymentId: payment.id,
        stripeChargeId: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null,
        amount,
        reason: dispute.reason ?? null,
        status: mapStripeDisputeStatus(dispute.status),
        dueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
      },
      // Redelivery of the same event — refresh the Stripe-owned fields only,
      // never the staff-filled dossier fields (assignee/response/proof/conclusion).
      update: {
        amount,
        reason: dispute.reason ?? null,
        status: mapStripeDisputeStatus(dispute.status),
        dueBy: dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null,
      },
    });
  } else {
    console.warn(`[stripe-webhook] charge.dispute.created: no matching Payment for payment_intent ${dispute.payment_intent} — dossier not created`);
  }

  const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
  if (!salon?.email) return;

  const deadline = dispute.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })
    : "non communiquée";

  await sendEmail({
    to: salon.email,
    subject: `⚠️ Litige Stripe ouvert — €${amount.toFixed(2)}`,
    text:
      `Un client a contesté un paiement de €${amount.toFixed(2)} (motif Stripe : ${dispute.reason}).\n` +
      `Paiement interne : ${payment?.id ?? "introuvable — vérifier manuellement dans Stripe"}\n` +
      `Date limite de réponse : ${deadline}\n\n` +
      `Un dossier a été créé dans le Dashboard (Paiements > Litiges Stripe) — assignez-le à un responsable.`,
    html:
      `<p>Un client a contesté un paiement de <strong>€${amount.toFixed(2)}</strong> (motif Stripe : ${dispute.reason}).</p>` +
      `<p>Paiement interne : ${payment?.id ?? "introuvable — vérifier manuellement dans Stripe"}</p>` +
      `<p>Date limite de réponse : <strong>${deadline}</strong></p>` +
      `<p>Un dossier a été créé dans le Dashboard (Paiements &gt; Litiges Stripe) — assignez-le à un responsable.</p>`,
  }).catch((err) => console.error("[stripe-webhook] dispute alert email failed:", err));

  console.warn(`[stripe-webhook] Dispute opened for payment_intent ${dispute.payment_intent}, payment ${payment?.id ?? "unknown"}`);
}

/**
 * charge.dispute.updated / charge.dispute.closed — Stripe moving the dispute
 * through review (under_review) or to its final outcome (won/lost/
 * warning_closed/charge_refunded). Only touches the Stripe-owned fields; the
 * staff-filled dossier stays exactly as they left it.
 */
async function handleChargeDisputeStatusChanged(dispute) {
  const existing = await prisma.stripeDispute.findUnique({ where: { stripeDisputeId: dispute.id } });
  if (!existing) {
    // No dossier row — most likely the dispute.created event predates this
    // feature, or its Payment couldn't be matched at creation time. Nothing
    // durable to update; the Stripe Dashboard remains the source of truth.
    console.warn(`[stripe-webhook] ${dispute.id}: no dossier row to update status on`);
    return;
  }

  await prisma.stripeDispute.update({
    where: { stripeDisputeId: dispute.id },
    data: { status: mapStripeDisputeStatus(dispute.status) },
  });
}

// ─── checkout.session.completed (appointments) ───────────────────────────────
//
// Unlike orders/workshops/formations, the Appointment + Payment rows already
// exist (status PENDING) before Stripe is ever involved — created by
// actions/payment/createCheckoutSession.js at the moment the customer chose
// to pay online, inside a transaction guarded by a Postgres advisory lock
// keyed on the reservation's fingerprint. This handler's job is narrower: to
// confirm the payment amount, mark it PAID/PARTIALLY_PAID, and confirm the
// appointment — never to create the reservation itself.
//
// Payments are Stripe Connect **direct charges** on the staff member's own
// connected account (see createCheckoutSession.js) — the platform never
// holds these funds.

function toDecimal(value) {
  return Number(value ?? 0);
}

function toMinorUnitCents(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.round(numericValue * 100);
}

function normalizePaymentScenario(value) {
  return String(value ?? "").trim().toUpperCase();
}

function validateCheckoutSessionMetadata(session) {
  const metadata = session?.metadata ?? {};
  const appointmentId = String(metadata.appointmentId ?? "").trim();
  const paymentId = String(metadata.paymentId ?? "").trim();
  const paymentScenario = normalizePaymentScenario(metadata.paymentScenario);
  const issues = [];

  if (!appointmentId) issues.push("missing appointmentId");
  if (!paymentId) issues.push("missing paymentId");
  if (!paymentScenario || (paymentScenario !== "FULL_ONLINE" && paymentScenario !== "DEPOSIT_ONLINE")) {
    issues.push(`unsupported paymentScenario: ${paymentScenario || "<empty>"}`);
  }

  return { appointmentId, paymentId, paymentScenario, issues };
}

async function processAppointmentCheckoutSession(session) {
  const checkoutSessionId = session?.id || null;
  const paymentIntentId = session?.payment_intent || null;

  if (!checkoutSessionId) {
    console.warn("[stripe-webhook] checkout.session.completed missing checkout session ID");
    return { received: true, warning: "missing session id" };
  }

  const { appointmentId, paymentId, paymentScenario, issues } = validateCheckoutSessionMetadata(session);

  if (!appointmentId || !paymentId || issues.length > 0) {
    console.warn(`[stripe-webhook] checkout.session.completed metadata validation failed for ${checkoutSessionId}`, {
      issues,
      metadata: session?.metadata ?? {},
    });
    return { received: true, warning: "invalid metadata" };
  }

  // ── Pre-transaction safety checks ───────────────────────────────────────
  // Both of these must refund the customer and stop — we never want to
  // confirm (or even leave PAID) a booking the salon can't honor. They are
  // done outside the transaction so the Stripe refund call is not held under
  // a row lock, and they mirror the workshop/formation paths.
  const preCheck = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      depositAmount: true,
      appointment: { select: { id: true, status: true } },
    },
  });

  if (!preCheck || !preCheck.appointment) {
    console.warn(`[stripe-webhook] Payment/appointment not found for checkout session ${checkoutSessionId}`);
    return { received: true, reason: "payment-not-found" };
  }

  // (a) Cancelled-while-in-flight — the customer (or staff) cancelled this
  // appointment while the Stripe charge was still clearing. Mirrors the
  // workshop path's "reservation.status === CANCELLED" refund-and-skip.
  // Without this, the webhook would resurrect the cancelled appointment and
  // charge a customer who explicitly cancelled.
  if (preCheck.appointment.status === "CANCELLED") {
    console.warn(`[stripe-webhook] Appointment ${preCheck.appointment.id} cancelled before payment cleared, refunding: ${checkoutSessionId}`);
    await refundSession(session);
    return { received: true, refunded: true, reason: "appointment cancelled" };
  }

  // (b) Amount mismatch / underpayment — refund what was actually charged
  // rather than silently leaving the customer's money taken with no booking.
  // Uses an epsilon for float safety, matching the workshop/formation paths.
  const amountReceivedCents = Number(session?.amount_total ?? 0);
  const expectedAmountCents =
    paymentScenario === "FULL_ONLINE"
      ? toMinorUnitCents(toDecimal(preCheck.totalAmount))
      : toMinorUnitCents(toDecimal(preCheck.depositAmount));
  if (amountReceivedCents + UNDERPAYMENT_EPSILON < expectedAmountCents) {
    console.error(
      `[stripe-webhook] UNDERPAYMENT for checkout session ${checkoutSessionId}: expected ${expectedAmountCents} cents, received ${amountReceivedCents} cents`
    );
    await refundSession(session);
    return { received: true, refunded: true, reason: "underpayment" };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Row lock: two deliveries of the same event (Stripe's at-least-once
    // guarantee) must not both flip this payment from PENDING.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;

    const existingPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            user: { select: { fullName: true } },
            staffService: {
              include: {
                service: { select: { name: true } },
                staff: { include: { user: { select: { fullName: true } } },
              },
            },
          },
        },
      },
    }
    });

    if (!existingPayment || !existingPayment.appointment) {
      console.warn(`[stripe-webhook] Payment/appointment not found for checkout session ${checkoutSessionId}`);
      return { processed: false, reason: "payment-not-found" };
    }

    if (existingPayment.status === "PAID" || existingPayment.status === "PARTIALLY_PAID") {
      // Same session retried (Stripe's at-least-once delivery) is harmless —
      // nothing to do. But a DIFFERENT session settling here means the
      // customer abandoned this one, resumed via resumeReservationPayment
      // (which creates a fresh session for the same Payment row), paid
      // through the new one, and then this original session *also* cleared
      // late (e.g. a delayed-notification method). That's a real second
      // charge Stripe actually captured — refund it below rather than
      // silently dropping the event, or the customer is out that money with
      // no record of why.
      return {
        processed: false,
        reason: "already-processed",
        strayCharge: checkoutSessionId !== existingPayment.transactionReference,
      };
    }

    // Re-check cancellation here, after the lock: the pre-transaction check
    // above only rules out an appointment that was already cancelled before
    // we started. There's a real gap between that check and this point — a
    // customer/staff cancellation doesn't take the Payment row's FOR UPDATE
    // lock, so it can slip in and commit in between. Without this re-check,
    // this transaction would still confirm/PAID an appointment the customer
    // explicitly cancelled moments before the charge cleared. The refund
    // itself stays outside the transaction (same reasoning as the
    // pre-transaction block: don't hold the Stripe call under a row lock).
    if (existingPayment.appointment.status === "CANCELLED") {
      return { processed: false, reason: "appointment-cancelled" };
    }

    // Amount verification + cancelled-appointment refund happen in the
    // pre-transaction block above (so the Stripe refund isn't held under a
    // row lock). If we reach here, the amount matched and the appointment is
    // still in a payable state.
    const totalAmount = toDecimal(existingPayment.totalAmount);
    const depositAmount = toDecimal(existingPayment.depositAmount);

    const nextPaidAmount = paymentScenario === "FULL_ONLINE" ? totalAmount : depositAmount;
    const nextRemainingAmount = Math.max(0, totalAmount - nextPaidAmount);
    const nextPaymentStatus = nextRemainingAmount > 0 ? "PARTIALLY_PAID" : "PAID";

    const appointment = existingPayment.appointment;
    const confirmationMode = appointment.staffService?.staff?.reservationConfirmationMode ?? "MANUAL";
    // AUTOMATIC mode confirms as soon as the required online payment clears,
    // regardless of any remaining salon balance. MANUAL mode still needs
    // staff review — the payment is recorded but the appointment stays PENDING.
    // An ACCEPTED appointment reached this webhook through the staff-review
    // confirmation page, so successful payment completes that acceptance even
    // when the staff default is MANUAL. New bookings still follow the normal
    // confirmation-mode rule.
    const nextAppointmentStatus = confirmationMode === "AUTOMATIC" || appointment.status === "ACCEPTED"
      ? "CONFIRMED"
      : "PENDING";

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        paidAmount: nextPaidAmount,
        remainingAmount: nextRemainingAmount,
        status: nextPaymentStatus,
        paidAt: new Date(),
        transactionReference: checkoutSessionId,
      },
    });

    await tx.appointment.update({
      where: { id: appointmentId },
      data: { status: nextAppointmentStatus },
    });

    await tx.transaction.create({
      data: {
        paymentId,
        amount: nextPaidAmount,
        method: "ONLINE",
        transactionType: paymentScenario === "FULL_ONLINE" ? "FINAL_PAYMENT" : "DEPOSIT",
        paidAt: new Date(),
        stripeCheckoutSessionId: checkoutSessionId,
        stripePaymentIntentId: paymentIntentId,
      },
    });

    // ── Notification for dashboard users ───────────────────────────────────
    // AUTOMATIC: appointment just became CONFIRMED → emit APPOINTMENT_CONFIRMED.
    // MANUAL: appointment stays PENDING (paid but waiting on salon OK) → no
    // new notif; the "APPOINTMENT_CREATED" one already exists for this event.
    if (nextAppointmentStatus === "CONFIRMED") {
      const serviceName = appointment.staffService?.service?.name;
      const staffName = appointment.staffService?.staff?.user?.fullName;
      const customerName = appointment.user?.fullName;
      const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId, { tx });

      if (recipientUserIds.length > 0) {
        await createNotificationsBulk(
          recipientUserIds.map((uid) =>
            buildAppointmentConfirmedNotification({
              userId: uid,
              appointmentId: appointment.id,
              date: appointment.date,
              startTime: appointment.startTime,
              serviceName,
              staffName,
              customerName,
            })
          ),
          { tx }
        );
      }
    }

    return {
      processed: true,
      appointment,
      user: appointment.userId,
      nextPaidAmount,
      totalAmount,
      nextAppointmentStatus,
    };
  });

  if (result?.reason === "appointment-cancelled") {
    console.warn(`[stripe-webhook] Appointment ${appointmentId} cancelled during payment processing, refunding: ${checkoutSessionId}`);
    await refundSession(session);
    return { received: true, refunded: true, reason: "appointment cancelled" };
  }

  if (result?.strayCharge) {
    console.error(
      `[stripe-webhook] STRAY DUPLICATE CHARGE for appointment ${appointmentId}: session ${checkoutSessionId} settled after payment ${paymentId} was already paid via a different session. Refunding.`
    );
    await refundSession(session);
    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
    if (salon?.email) {
      sendEmail({
        to: salon.email,
        subject: `⚠️ Double paiement remboursé — rendez-vous n°${appointmentId}`,
        text: `Un client a payé deux fois le même rendez-vous (session ${checkoutSessionId}, en plus du paiement déjà enregistré). Le second paiement vient d'être automatiquement remboursé via Stripe.`,
        html: `<p>Un client a payé deux fois le même rendez-vous (session ${checkoutSessionId}, en plus du paiement déjà enregistré). Le second paiement vient d'être automatiquement remboursé via Stripe.</p>`,
      }).catch((err) => console.error("[stripe-webhook] stray-charge alert email failed:", err));
    }
    return { received: true, refunded: true, reason: "stray-duplicate-charge" };
  }

  if (!result?.processed) {
    return { received: true, alreadyProcessed: result?.reason === "already-processed", reason: result?.reason };
  }

  // ── Emails — fire-and-forget, never fail the webhook ────────────────────
  const [user, staffService] = await Promise.all([
    prisma.user.findUnique({ where: { id: result.appointment.userId } }),
    prisma.staffService.findUnique({
      where: { id: result.appointment.staffServiceId },
      include: { service: true, staff: { include: { user: { select: { fullName: true } } } } },
    }),
  ]);

  if (user) {
    const staffName = staffService?.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService?.service?.name ?? "votre service";

    sendEmail({
      to: user.email,
      ...paymentConfirmationEmail({
        customerName: user.fullName,
        serviceName,
        staffName,
        date: result.appointment.date,
        time: result.appointment.startTime.toTimeString().slice(0, 5),
        paidAmount: result.nextPaidAmount,
        totalAmount: result.totalAmount,
        paymentMethod: "Carte bancaire",
      }),
    }).catch((err) => console.error("[stripe-webhook] appointment confirmation email failed:", err));
  }

  if (result.nextAppointmentStatus === "CONFIRMED") {
    const recipients = await getAppointmentEmailRecipients(result.appointment.staffId);
    const staffName = staffService?.staff?.user?.fullName ?? "votre experte";
    const serviceName = staffService?.service?.name ?? "votre service";
    for (const recipient of recipients) {
      sendEmail({
        to: recipient.email,
        ...staffReservationConfirmedEmail({
          staffName: recipient.fullName,
          customerName: user?.fullName ?? "Client",
          serviceName,
          date: result.appointment.date,
          time: result.appointment.startTime.toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "Europe/Brussels",
          }),
          duration: staffService?.duration,
          totalAmount: result.totalAmount,
        }),
      }).catch((err) => console.error("[stripe-webhook] staff confirmation email failed:", err));
    }
  }

  return { received: true, processed: true };
}

/** Stripe Connect `account.updated` — see handleAccountUpdated above; kept as a case in the same dispatcher. */
async function handlePaymentIntentFailed(paymentIntent, connectedAccountId = null) {
  const paymentIntentId = paymentIntent?.id || null;
  if (!paymentIntentId) {
    console.warn("[stripe-webhook] payment_intent.payment_failed missing payment intent ID");
    return;
  }

  const transaction = await prisma.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    include: {
      payment: {
        include: {
          appointment: {
            include: {
              user: { select: { fullName: true } },
              staffService: {
                include: {
                  service: { select: { name: true } },
                  staff: {
                    include: {
                      user: { select: { fullName: true, email: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!transaction?.payment?.appointment) {
    const paymentId = paymentIntent?.metadata?.paymentId;
    const appointmentId = paymentIntent?.metadata?.appointmentId;
    if (paymentId && appointmentId) {
      await notifyAppointmentPaymentFailed({ paymentId, appointmentId, failedSessionId: null });
      return;
    }

    // Older Checkout Sessions may not have PaymentIntent metadata. Resolve
    // their session metadata from the connected account when Stripe includes it.
    if (connectedAccountId) {
      const sessions = await stripe.checkout.sessions.list(
        { payment_intent: paymentIntentId, limit: 1 },
        { stripeAccount: connectedAccountId }
      );
      const session = sessions.data?.[0];
      if (session?.metadata?.paymentId && session?.metadata?.appointmentId) {
        await notifyAppointmentPaymentFailed({
          paymentId: session.metadata.paymentId,
          appointmentId: session.metadata.appointmentId,
          failedSessionId: session.id,
        });
        return;
      }
    }

    console.warn(`[stripe-webhook] Transaction/appointment not found for payment intent ${paymentIntentId}`);
    return;
  }

  const payment = transaction.payment;
  const appointment = payment.appointment;

  await notifyAppointmentPaymentFailed({
    paymentId: payment.id,
    appointmentId: payment.appointmentId,
    failedSessionId: payment.transactionReference,
});

  // Dashboard notifications (outside transaction - business operation already committed)
  const serviceName = appointment.staffService?.service?.name;
  const customerName = appointment.user?.fullName;
  const recipientUserIds = await getAppointmentNotificationRecipients(appointment.staffId);

  if (recipientUserIds.length > 0) {
    try {
      await createNotificationsBulk(
        recipientUserIds.map((uid) =>
          buildAppointmentCancelledNotification({
            userId: uid,
            appointmentId: appointment.id,
            date: appointment.date,
            startTime: appointment.startTime,
            serviceName,
            reason: "Paiement échoué",
            customerName,
          })
        )
      );
    } catch (err) {
      if (err?.message === "VALIDATION_ERROR") {
        console.error("[stripe-webhook] notification validation error:", err.fieldErrors);
      } else {
        console.error("[stripe-webhook] notifications failed:", err);
      }
    }
  }

  // Send email to assigned staff member and admin/owner users about payment failure
  const emailRecipients = await getAppointmentEmailRecipients(appointment.staffId);
  for (const recipient of emailRecipients) {
    await sendEmail({
      to: recipient.email,
      ...staffPaymentFailedEmail({
        staffName: recipient.fullName,
        customerName: appointment.user?.fullName,
        serviceName: appointment.staffService?.service?.name,
        date: appointment.date,
        time: appointment.startTime ? appointment.startTime.toTimeString().slice(0, 5) : "",
      }),
    }).catch((err) => console.error("[stripe-webhook] dashboard payment failed email error:", err));
  }

  console.info(`[stripe-webhook] Payment failed for payment intent ${paymentIntentId}`, {
    paymentId: payment.id,
    appointmentId: payment.appointmentId,
    failureReason: paymentIntent?.last_payment_error?.message || "Unknown",
  });
}

async function notifyAppointmentPaymentFailed({ paymentId, appointmentId, failedSessionId = null }) {
  if (!paymentId || !appointmentId) return;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      appointment: {
        include: {
          user: { select: { fullName: true, email: true } },
          staffService: {
            include: {
              service: { select: { name: true } },
              staff: { include: { user: { select: { fullName: true } } } },
            },
          },
        },
      },
    },
  });
  if (!payment?.appointment || payment.appointment.id !== appointmentId) return;

  const changed = await prisma.payment.updateMany({
    where: { id: payment.id, status: "PENDING" },
    data: { status: "FAILED", ...(failedSessionId ? { transactionReference: failedSessionId } : {}) },
  });
  if (changed.count !== 1) return;

  const appointment = payment.appointment;
  const retryUrl = `${process.env.NEXT_PUBLIC_APP_URL}/reservation/retry-payment?paymentId=${encodeURIComponent(payment.id)}`;
  await sendEmail({
    to: appointment.user.email,
    ...reservationPaymentFailedEmail({
      customerName: appointment.user.fullName,
      serviceName: appointment.staffService.service.name,
      staffName: appointment.staffService.staff?.user?.fullName ?? "Expert",
      date: appointment.date,
      time: appointment.startTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }),
      retryUrl,
    }),
  }).catch((error) => console.error("[stripe-webhook] payment-failed email failed:", error));
}

// ─── checkout.session.completed (workshops/events, formations) ───────────────
// The actual confirm-the-reservation logic lives in
// lib/workshops/fulfill-workshop-reservation-payment.js and
// lib/formations/fulfill-formation-reservation-payment.js — shared with the
// zero-total (100%-promo) direct-fulfilment path in
// createWorkshopReservationCheckoutSession / createFormationReservationCheckoutSession,
// so there's exactly one implementation instead of two that can drift apart.

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

  if (reservation.status === "CANCELLED") {
    // The reservation was cancelled while this fee-payment link was still
    // outstanding — the salon can't honor a session change on a booking
    // that no longer exists, same as the main reservation-confirmation path.
    console.warn("[stripe-webhook] Reservation cancelled before session-change fee cleared, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation cancelled" };
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

  const claimed = await prisma.$transaction(async (tx) => {
    // Atomic claim gated on the reservation still pointing at the OLD
    // session — this Payment row has no unique transactionReference to lean
    // on (it's a Transaction against an existing Payment, not a new one), so
    // without this, two near-simultaneous deliveries of the same event both
    // pass the plain read-check above and both apply the fee.
    const claim = await tx.workshopReservation.updateMany({
      where: { id: reservation.id, sessionId: { not: newSessionId } },
      data: {
        sessionId: newSessionId,
        previousSessionId: oldSessionId,
        changeFeeAmount: { increment: changeFeeAmount },
      },
    });
    if (claim.count === 0) return false;

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
    return true;
  });

  if (!claimed) {
    return { received: true, alreadyProcessed: true };
  }

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
    timeZone: "Europe/Brussels",
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

/** Applies an admin-mediated seat-count change once its flat 10% fee has cleared. */
async function applyWorkshopSeatsChangeFee(session, meta) {
  const { reservationId, newSeatsCount, newTotalPrice, newDepositAmount } = meta;
  const seats = Number(newSeatsCount);

  if (!reservationId || !Number.isInteger(seats)) {
    console.error("[stripe-webhook] seats_change_fee missing metadata:", session.id, meta);
    return { received: true, warning: "missing metadata" };
  }

  const reservation = await prisma.workshopReservation.findUnique({
    where: { id: reservationId },
    include: { session: { include: { workshop: true } }, customer: true, payment: true },
  });

  if (!reservation) {
    console.error("[stripe-webhook] WorkshopReservation gone for seats change, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation deleted" };
  }

  if (reservation.status === "CANCELLED") {
    // The reservation was cancelled while this fee-payment link was still
    // outstanding — same failed-sale safety net as the other webhook paths.
    console.warn("[stripe-webhook] Reservation cancelled before seats-change fee cleared, refunding:", session.id);
    await refundSession(session);
    return { received: true, refunded: true, reason: "reservation cancelled" };
  }

  if (reservation.seatsCount === seats) {
    // Already applied — a Stripe retry of the same event.
    return { received: true, alreadyProcessed: true };
  }

  const changeFeeAmount = (session.amount_total ?? 0) / 100;
  const previousSeatsCount = reservation.seatsCount;
  const isIncrease = seats > previousSeatsCount;

  const result = await prisma.$transaction(async (tx) => {
    // Capacity re-check for an increase, under the same session-row lock
    // createWorkshopReservation takes for the initial booking. Without this,
    // two admins each increasing seats on the same near-full session both
    // see room available (checked only at fee-link creation, minutes
    // earlier, no lock) and both webhooks land here and both apply —
    // overbooking the session. Locking + re-aggregating here, inside the
    // same transaction as the claim below, closes that window.
    if (isIncrease) {
      await tx.$queryRaw`SELECT id FROM workshop_sessions WHERE id = ${reservation.sessionId} FOR UPDATE`;
      const reserved = await tx.workshopReservation.aggregate({
        where: {
          sessionId: reservation.sessionId,
          id: { not: reservation.id },
          status: { in: ["CONFIRMED", "COMPLETED"] },
        },
        _sum: { seatsCount: true },
      });
      const takenByOthers = reserved._sum.seatsCount ?? 0;
      const capacity = reservation.session.capacity ?? reservation.session.workshop.capacity;
      if (takenByOthers + seats > capacity) {
        return { claimed: false, capacityExceeded: true };
      }
    }

    // Atomic claim gated on the seat count still being the OLD value — same
    // reasoning as the session-change fee above: no unique transactionReference
    // to lean on here, so two near-simultaneous deliveries of the same event
    // would otherwise both pass the plain read-check and both apply the fee.
    const claim = await tx.workshopReservation.updateMany({
      where: { id: reservation.id, seatsCount: { not: seats } },
      data: {
        seatsCount: seats,
        changeFeeAmount: { increment: changeFeeAmount },
        // Only an increase recomputes the price owed — a decrease stays
        // fee-only (the non-refundable-deposit policy means removing seats
        // doesn't unwind money already collected for them). newTotalPrice/
        // newDepositAmount were computed once at fee-link creation time and
        // passed through metadata rather than re-derived here, so this
        // can't drift from what the customer was actually shown/charged.
        ...(isIncrease && newTotalPrice
          ? {
              totalPrice: Number(newTotalPrice),
              depositAmount: Number(newDepositAmount),
              balanceDue: Number(newTotalPrice) - Number(newDepositAmount),
            }
          : {}),
      },
    });
    if (claim.count === 0) return { claimed: false };

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
    return { claimed: true };
  });

  if (result.capacityExceeded) {
    // The session filled up between the admin starting this change and the
    // customer paying the fee — refund it rather than silently dropping the
    // increase, and tell the customer why instead of leaving them guessing
    // why their card was charged then refunded.
    console.warn(`[stripe-webhook] Seats increase for reservation ${reservation.id} would exceed capacity, refunding:`, session.id);
    await refundSession(session);
    sendEmail({
      to: reservation.customer.email,
      subject: `Places non disponibles — ${reservation.session.workshop.title} — Meri Beauty`,
      text:
        `Bonjour ${reservation.customer.fullName},\n\n` +
        `La session "${reservation.session.workshop.title}" s'est complétée entre-temps : nous ne pouvons pas ajouter la ou les places supplémentaires demandées. ` +
        `Le paiement correspondant a été intégralement remboursé et votre réservation reste inchangée (${previousSeatsCount} place(s)).\n\n` +
        `N'hésitez pas à nous contacter si vous souhaitez être mis(e) sur liste d'attente.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${reservation.customer.fullName},</p>` +
        `<p>La session "${reservation.session.workshop.title}" s'est complétée entre-temps : nous ne pouvons pas ajouter la ou les places supplémentaires demandées. ` +
        `Le paiement correspondant a été intégralement remboursé et votre réservation reste inchangée (${previousSeatsCount} place(s)).</p>` +
        `<p>N'hésitez pas à nous contacter si vous souhaitez être mis(e) sur liste d'attente.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[stripe-webhook] seats-capacity-refund email failed:", err));
    return { received: true, refunded: true, reason: "capacity exceeded" };
  }

  if (!result.claimed) {
    return { received: true, alreadyProcessed: true };
  }

  sendEmail({
    to: reservation.customer.email,
    ...workshopSeatsChangeEmail({
      customerName: reservation.customer.fullName,
      activityTitle: reservation.session.workshop.title,
      previousSeatsCount,
      newSeatsCount: seats,
      changeFeeAmount,
    }),
  }).catch((err) => console.error("[stripe-webhook] seats change email failed:", err));

  return { received: true, processed: true };
}
