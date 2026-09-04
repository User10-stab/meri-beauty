import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import {
  paymentConfirmationEmail,
  reservationConfirmedEmail,
  reservationPaymentRequiredEmail,
  staffReservationConfirmedEmail,
  workshopSessionChangeEmail,
  workshopSeatsChangeEmail,
  staffPaymentFailedEmail,
} from "@/lib/email-templates";
import { fulfillOrderPayment } from "@/lib/orders/fulfill-order-payment";
import { confirmWorkshopReservationPayment } from "@/lib/workshops/fulfill-workshop-reservation-payment";
import { confirmFormationReservationPayment } from "@/lib/formations/fulfill-formation-reservation-payment";
import { buildAppointmentCheckInEmailAssets } from "@/lib/activities/appointment-check-in-qr";
import {
  issueCreditNote,
  issueInvoice,
  buildInvoiceCustomer,
  buildServiceInvoiceLines,
} from "@/lib/invoicing";
import { renderInvoicePdf } from "@/lib/pdf/render";
import { resolveAppointmentStatusAfterPayment } from "@/lib/appointment-status";
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
import { findLegForStripeRefund, settleRefundLeg } from "@/lib/refunds/settle-leg";
import {
  reconcileExceptionalReservationFullRefund,
  RESERVATION_REFUND_AUTHORIZATION,
} from "@/lib/payments/reconcile-reservation-refund";
import { captureCriticalError } from "@/lib/monitoring";
import { flagPaymentForManualRefund } from "@/lib/payments/flag-payment-for-manual-refund";
import {
  isForeignCheckoutSession,
  getDeploymentId,
  DEPLOYMENT_METADATA_KEY,
} from "@/lib/stripe-deployment";
import { roundMoney, resolveServiceVatPolicy, hasInvoiceableVatIdentity } from "@/lib/tax-policy";

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
  // Supports multiple comma-separated webhook secrets so that two Stripe
  // webhook endpoints (e.g. one for Connect events, one for Checkout events)
  // can both target this route. Each endpoint has its own signing secret;
  // we try every configured secret until one verifies.
  const signature = req.headers.get("stripe-signature");
  const secrets = (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (secrets.length === 0) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await req.text();

  let event;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      break;
    } catch {
      // This secret didn't match — try the next one.
    }
  }

  if (!event) {
    console.error(
      `[stripe-webhook] Signature verification failed for all ${secrets.length} configured secret(s)`
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── 1b. Ignore Checkout Sessions created by another deployment ───────────
  // Several deployments share one Stripe account (localhost, staging VPS,
  // production), and Stripe delivers every event to every endpoint. Without
  // this, a session created elsewhere reaches handlers whose database has no
  // such order/reservation, which they correctly read as a failed sale and
  // refund — cancelling a payment the originating deployment just fulfilled.
  // See lib/stripe-deployment.js.
  if (event.type.startsWith("checkout.session.") && isForeignCheckoutSession(event.data.object)) {
    console.info(
      `[stripe-webhook] ignoring ${event.type} for ${event.data.object.id} — created by deployment ` +
        `"${event.data.object.metadata?.[DEPLOYMENT_METADATA_KEY]}", this is "${getDeploymentId()}"`
    );
    return NextResponse.json({ received: true, ignored: "foreign-deployment" });
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

  // Connect direct charges can deliver payment_intent.succeeded even when
  // checkout.session.completed was missed by a local listener or endpoint.
  // Resolve the session on the connected account and run the same idempotent
  // settlement path, so a retry can recover a FAILED Payment row.
  if (event.type === "payment_intent.succeeded") {
    try {
      await handlePaymentIntentSucceeded(event.data.object, event.account);
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
  // docs/PRE_LAUNCH_FIXES.md).
  if (event.type === "charge.refunded") {
    try {
      // `event.account` is set when the event comes from a connected account
      // — an appointment refund, which is a Connect direct charge on the
      // staff member's own Stripe account. Without passing it through, any
      // Stripe call made while handling this event queries the PLATFORM
      // account and silently finds nothing.
      await handleChargeRefunded(event.data.object, event.account ?? null);
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
      result = await processAppointmentCheckoutSession(session, event.account ?? null);
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
  return roundMoney(n);
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
 * Settles any RefundLeg this charge's refunds belong to.
 *
 * This is now the PRIMARY path, not a confirmation of our own call. Confirmed
 * policy (2026-09-02): this application never issues a Stripe refund itself —
 * an OWNER/ADMIN refunds by hand in the Stripe dashboard, having been told the
 * exact amount and payment_intent by the Operations screen. This handler is
 * where that manual act is reconciled back into the ledger.
 *
 * (Deliberately worded without the API call's literal name: the security
 * contract in tests/critical/security-contracts.test.js asserts this file
 * cannot refund, by checking the source for that exact string.)
 *
 * MUST run before the external-refund reconciliation below, and MUST stop it
 * from also running. The operation already has its credit note on disk, and
 * the legacy "someone refunded from the Stripe Dashboard" path would write a
 * SECOND REFUND transaction and a SECOND credit note for one movement of
 * money. When no leg matches — a refund with no operation behind it, which is
 * still perfectly possible — nothing here fires and the old path runs
 * unchanged.
 *
 * On resolving the amount actually refunded — this was wrong once and the
 * failure was silent, so it is worth stating plainly.
 *
 * `charge.refunds` is NOT expanded on a charge.refunded webhook payload
 * (verified absent on api_version 2024-06-20). Reading `charge.refunds.data`
 * and falling back to the planned figure when it was empty therefore meant
 * the fallback ran EVERY time: an admin refunding 50 € against a 75 € leg
 * had 75 € written to the ledger and 75 € announced to the customer, and the
 * mismatch guard in settle-leg.js was dead code. The whole point of letting a
 * human type the amount into Stripe is that the ledger records what they
 * actually typed.
 *
 * So the refund list is fetched from the API when the payload does not carry
 * it, and if even that fails the amount is derived from
 * `charge.amount_refunded` — which IS always present — minus what this
 * payment's ledger already accounts for. The planned figure is never assumed.
 *
 * @returns {Promise<{settledAny: boolean, operationIds: Set<string>}>}
 */
async function settleOwnRefundLegs(charge, connectedAccountId = null) {
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;
  const chargeRefundedTotal = round2((charge.amount_refunded ?? 0) / 100);
  const operationIds = new Set();
  let settledAny = false;

  // Leg matching itself needs no Stripe call — findLegForStripeRefund reads
  // the payment_intent we already stored — so an appointment (Connect) leg
  // settles here just like a platform one. Only this listing has to be
  // pointed at the right account, or it returns nothing for a Connect charge
  // and the refund id is lost.
  let refunds = charge.refunds?.data ?? [];
  if (refunds.length === 0 && charge.id) {
    try {
      const listed = await stripe.refunds.list(
        { charge: charge.id, limit: 10 },
        connectedAccountId ? { stripeAccount: connectedAccountId } : undefined,
      );
      refunds = listed.data ?? [];
    } catch (error) {
      // Non-fatal: the amount is still recoverable from amount_refunded
      // below. Only the per-refund id (traceability) is lost.
      console.error("[stripe-webhook] could not list refunds for charge", charge.id, error);
    }
  }

  // Oldest first, so successive refunds on one charge match successive legs
  // in the order they were created.
  const candidates =
    refunds.length > 0
      ? [...refunds]
          .sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
          .map((refund) => ({ id: refund.id, amount: round2((refund.amount ?? 0) / 100) }))
      : [{ id: null, amount: null }];

  for (const candidate of candidates) {
    const leg = await findLegForStripeRefund(prisma, { refundId: candidate.id, paymentIntentId });
    if (!leg) continue;

    let amount = candidate.amount;
    if (amount == null) {
      // Last resort: what Stripe says is refunded on this charge in total,
      // minus what our ledger has already recorded for this payment. Same
      // derivation the legacy external-refund path uses below, and never the
      // planned figure — that is the bug this replaces.
      const operation = await prisma.refundOperation.findUnique({
        where: { id: leg.refundOperationId },
        select: { paymentId: true },
      });
      const recorded = await prisma.transaction.aggregate({
        where: { paymentId: operation?.paymentId ?? "", transactionType: "REFUND", isDeleted: false },
        _sum: { amount: true },
      });
      amount = round2(chargeRefundedTotal - Number(recorded._sum.amount ?? 0));
    }

    const result = await settleRefundLeg({
      prisma,
      legId: leg.id,
      stripe: {
        refundId: candidate.id ?? leg.stripeRefundId,
        paymentIntentId,
        // What the admin actually typed into Stripe. Recorded as-is so an
        // over- or under-refund shows up instead of being smoothed over.
        amount,
      },
    });
    operationIds.add(leg.refundOperationId);
    // ALREADY_SETTLED still counts as ours — a redelivered webhook must not
    // fall through to the external-refund path and duplicate the ledger.
    if (result.settled || result.reason === "ALREADY_SETTLED") settledAny = true;
  }

  return { settledAny, operationIds };
}

/**
 * Keeps our ledger honest when a refund happens outside our own refund
 * actions — most commonly staff refunding directly from the Stripe
 * Dashboard. Without this, Payment.status stays PAID and there's no
 * Transaction{REFUND} row, so the dashboard and any TVA/accounting export
 * silently disagree with what Stripe actually did.
 */
async function handleChargeRefunded(charge, connectedAccountId = null) {
  // Ours first. If this refund belongs to a RefundOperation we opened, it is
  // fully accounted for and the reconciliation below must not touch it.
  const own = await settleOwnRefundLegs(charge, connectedAccountId);
  if (own.settledAny) {
    console.info(
      `[stripe-webhook] charge.refunded settled ${own.operationIds.size} refund operation(s) we initiated`,
    );
    return;
  }

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
        const creditNote = await issueCreditNote(tx, {
          invoiceId: payment.invoice.id,
          reason: "Remboursement effectué depuis le Dashboard Stripe",
          totalInclVat: orderResult.newlyRefunded,
        });
        if (orderResult.transactionId) {
          await tx.transaction.update({ where: { id: orderResult.transactionId }, data: { creditNoteId: creditNote.id } });
        }
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

    let creditNote = null;
    if (lockedPayment.invoice) {
      creditNote = await issueCreditNote(tx, {
        invoiceId: lockedPayment.invoice.id,
        reason: "Remboursement effectué depuis le Dashboard Stripe",
        totalInclVat: newlyRefunded,
      });
    }
    await tx.transaction.create({
      data: {
        paymentId: lockedPayment.id,
        amount: newlyRefunded,
        method: "ONLINE",
        transactionType: "REFUND",
        paidAt: new Date(),
        stripePaymentIntentId,
        creditNoteId: creditNote?.id ?? null,
      },
    });
    await tx.payment.update({
      where: { id: lockedPayment.id },
      data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    });

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

async function processAppointmentCheckoutSession(session, connectedAccountId = null) {
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
    console.warn(`[stripe-webhook] Appointment ${preCheck.appointment.id} cancelled before payment cleared, flagging for manual refund: ${checkoutSessionId}`);
    await flagPaymentForManualRefund(
      session,
      "rendez-vous annulé avant que le paiement ne soit confirmé",
      { stripeAccountId: connectedAccountId },
    );
    return { received: true, refunded: false, flaggedForReview: true, reason: "appointment cancelled" };
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
    await flagPaymentForManualRefund(
      session,
      `paiement insuffisant (${amountReceivedCents} centimes reçus, ${expectedAmountCents} attendus)`,
      { stripeAccountId: connectedAccountId },
    );
    return { received: true, refunded: false, flaggedForReview: true, reason: "underpayment" };
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
    // Row lock: two deliveries of the same event (Stripe's at-least-once
    // guarantee) must not both flip this payment from PENDING.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;

    const existingPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: {
            user: {
              select: {
                fullName: true,
                email: true,
                vatNumber: true,
                vatValidatedAt: true,
                vatValidationName: true,
                addressLine1: true,
                addressLine2: true,
                addressCity: true,
                addressPostalCode: true,
                addressCountry: true,
                isCompany: true,
                billingProfile: {
                  select: {
                    companyLegalName: true,
                    companyRegistrationNo: true,
                    billingContactName: true,
                    purchaseOrderReference: true,
                  },
                },
              },
            },
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
    // confirmation-mode rule. Delegated to resolveAppointmentStatusAfterPayment
    // rather than inlined, so a delayed/duplicate webhook delivery for an
    // appointment that's already CONFIRMED (or further along) preserves its
    // current status instead of forcing it back to PENDING.
    const nextAppointmentStatus = resolveAppointmentStatusAfterPayment({
      currentStatus: appointment.status,
      confirmationMode,
    });

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

    // Full online payments are invoiced in the same transaction as settlement
    // so the gapless Belgian invoice number is never consumed on rollback.
    // Deposits are invoiced only after the remaining balance is collected.
    let invoice = null;
    if (nextPaymentStatus === "PAID" && hasInvoiceableVatIdentity(appointment.user)) {
      const bookingVatPolicy = resolveServiceVatPolicy({ customer: appointment.user });
      invoice = await issueInvoice(tx, {
        paymentId,
        source: "APPOINTMENT",
        totalInclVat: nextPaidAmount,
        customer: buildInvoiceCustomer(appointment.user),
        lines: buildServiceInvoiceLines({
          description: appointment.staffService?.service?.name ?? "Prestation",
          totalAmount: nextPaidAmount,
          discountAmount: Number(existingPayment.discountAmount ?? 0),
        }),
        vatRate: bookingVatPolicy.vatRate,
        vatTreatment: bookingVatPolicy.vatTreatment,
        taxCountryCode: bookingVatPolicy.taxCountryCode,
        taxNote: bookingVatPolicy.taxNote,
      });
    }

    // ── Notification for dashboard users ───────────────────────────────────
    // AUTOMATIC: appointment just became CONFIRMED → emit APPOINTMENT_CONFIRMED.
    // MANUAL: appointment stays PENDING (paid but waiting on salon OK) → no
    // new notif; the "APPOINTMENT_CREATED" one already exists for this event.
    if (appointment.status !== "CONFIRMED" && nextAppointmentStatus === "CONFIRMED") {
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
      invoice,
    };
    }, { timeout: 15000 });
  } catch (error) {
    // A legal-data failure happens after Stripe has captured the payment but
    // before this transaction can persist fulfilment. Record it as durable
    // manual-refund work instead of returning a 500 that Stripe will retry
    // until its retry window expires.
    if (["BUYER_LEGAL_DATA_INCOMPLETE", "SELLER_LEGAL_DATA_INCOMPLETE"].includes(error?.message)) {
      console.error(`[stripe-webhook] appointment ${appointmentId} needs manual refund after legal-data failure`, error);
      await flagPaymentForManualRefund(
        session,
        `confirmation impossible : données légales de facturation incomplètes (${error.message})`,
        { stripeAccountId: connectedAccountId },
      );
      return { received: true, refunded: false, flaggedForReview: true, reason: "legal-data-incomplete" };
    }
    throw error;
  }

  if (result?.reason === "appointment-cancelled") {
    console.warn(`[stripe-webhook] Appointment ${appointmentId} cancelled during payment processing, flagging for manual refund: ${checkoutSessionId}`);
    await flagPaymentForManualRefund(
      session,
      "rendez-vous annulé pendant le traitement du paiement",
      { stripeAccountId: connectedAccountId },
    );
    return { received: true, refunded: false, flaggedForReview: true, reason: "appointment cancelled" };
  }

  if (result?.strayCharge) {
    console.error(
      `[stripe-webhook] STRAY DUPLICATE CHARGE for appointment ${appointmentId}: session ${checkoutSessionId} settled after payment ${paymentId} was already paid via a different session. Flagging for manual refund.`
    );
    await flagPaymentForManualRefund(
      session,
      "double paiement pour le même rendez-vous",
      { stripeAccountId: connectedAccountId },
    );
    const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
    if (salon?.email) {
      sendEmail({
        to: salon.email,
        subject: `⚠️ Double paiement à rembourser — rendez-vous n°${appointmentId}`,
        text: `Un client a payé deux fois le même rendez-vous (session ${checkoutSessionId}, en plus du paiement déjà enregistré). Le remboursement automatique est désactivé — merci de rembourser ce second paiement manuellement depuis Stripe.`,
        html: `<p>Un client a payé deux fois le même rendez-vous (session ${checkoutSessionId}, en plus du paiement déjà enregistré). Le remboursement automatique est désactivé — merci de rembourser ce second paiement manuellement depuis Stripe.</p>`,
      }).catch((err) => console.error("[stripe-webhook] stray-charge alert email failed:", err));
    }
    return { received: true, refunded: false, flaggedForReview: true, reason: "stray-duplicate-charge" };
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

    const invoicePdf = result.invoice
      ? await renderInvoicePdf(result.invoice).catch((error) => {
          captureCriticalError(error, {
            area: "stripe-webhook",
            operation: "appointment-invoice-pdf",
            appointmentId,
            paymentId,
          });
          return null;
        })
      : null;
    const ticket = result.nextAppointmentStatus === "CONFIRMED"
      ? await buildAppointmentCheckInEmailAssets(appointmentId)
      : { checkInCode: null, attachment: null };
    const emailAttachments = [
      ...(invoicePdf ? [{ filename: `facture-${result.invoice.number}.pdf`, content: invoicePdf }] : []),
      ...(ticket.attachment ? [ticket.attachment] : []),
    ];

    const customerEmailTemplate = result.nextAppointmentStatus === "CONFIRMED"
      ? reservationConfirmedEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: result.appointment.date,
          time: result.appointment.startTime.toTimeString().slice(0, 5),
          paidAmount: result.nextPaidAmount,
          totalAmount: result.totalAmount,
          paymentMethod: "Carte bancaire",
          checkInCode: ticket.checkInCode,
        })
      : paymentConfirmationEmail({
          customerName: user.fullName,
          serviceName,
          staffName,
          date: result.appointment.date,
          time: result.appointment.startTime.toTimeString().slice(0, 5),
          paidAmount: result.nextPaidAmount,
          totalAmount: result.totalAmount,
          paymentMethod: "Carte bancaire",
        });

    sendEmail({
      to: user.email,
      ...customerEmailTemplate,
      ...(emailAttachments.length ? { attachments: emailAttachments } : {}),
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

async function handlePaymentIntentSucceeded(paymentIntent, connectedAccountId = null) {
  const paymentIntentId = paymentIntent?.id || null;
  if (!paymentIntentId || !connectedAccountId) {
    console.warn("[stripe-webhook] payment_intent.succeeded missing payment intent or connected account");
    return;
  }

  const sessions = await stripe.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    { stripeAccount: connectedAccountId }
  );
  const session = sessions.data?.[0];

  if (!session?.metadata?.appointmentId || !session?.metadata?.paymentId) {
    return;
  }

  await processAppointmentCheckoutSession(session, connectedAccountId);
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
    ...reservationPaymentRequiredEmail({
      customerName: appointment.user.fullName,
      serviceName: appointment.staffService.service.name,
      staffName: appointment.staffService.staff?.user?.fullName ?? "Expert",
      date: appointment.date,
      time: appointment.startTime.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" }),
      retryUrl,
    }),
  }).catch((error) => console.error("[stripe-webhook] payment-required email failed:", error));
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
    include: {
      session: { include: { workshop: true } },
      customer: {
        include: {
          billingProfile: {
            select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
          },
        },
      },
      payment: { include: { invoice: { select: { id: true } } } },
    },
  });

  if (!reservation) {
    console.error("[stripe-webhook] WorkshopReservation gone for session change, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation introuvable (frais de changement de session)");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation deleted" };
  }

  if (reservation.status === "CANCELLED") {
    // The reservation was cancelled while this fee-payment link was still
    // outstanding — the salon can't honor a session change on a booking
    // that no longer exists, same as the main reservation-confirmation path.
    console.warn("[stripe-webhook] Reservation cancelled before session-change fee cleared, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation annulée (frais de changement de session)");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation cancelled" };
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
    console.error("[stripe-webhook] Target session gone for session change, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "session cible introuvable (frais de changement de session)");
    return { received: true, refunded: false, flaggedForReview: true, reason: "target session deleted" };
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

      // Real collected revenue needs a legal document. Guarded on the
      // Payment row not already carrying one — Invoice.paymentId is @unique,
      // and a second session-change fee against the same reservation (its
      // Payment row is 1:1 and reused across fee events) would otherwise
      // collide. See the flagged edge case in the audit report: this guard
      // silently skips invoicing a legitimate second fee rather than
      // resolving where that revenue's invoice should go.
      if (!reservation.payment.invoice && hasInvoiceableVatIdentity(reservation.customer)) {
        await issueInvoice(tx, {
          paymentId: reservation.payment.id,
          source: "WORKSHOP",
          totalInclVat: changeFeeAmount,
          customer: buildInvoiceCustomer(reservation.customer),
          lines: buildServiceInvoiceLines({
            description: `Frais de changement de séance — ${reservation.session.workshop.title}`,
            totalAmount: changeFeeAmount,
          }),
        });
      }
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
    include: {
      session: { include: { workshop: true } },
      customer: {
        include: {
          billingProfile: {
            select: { companyLegalName: true, companyRegistrationNo: true, billingContactName: true, purchaseOrderReference: true },
          },
        },
      },
      payment: { include: { invoice: { select: { id: true } } } },
    },
  });

  if (!reservation) {
    console.error("[stripe-webhook] WorkshopReservation gone for seats change, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation introuvable (frais de changement de places)");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation deleted" };
  }

  if (reservation.status === "CANCELLED") {
    // The reservation was cancelled while this fee-payment link was still
    // outstanding — same failed-sale safety net as the other webhook paths.
    console.warn("[stripe-webhook] Reservation cancelled before seats-change fee cleared, flagging for manual refund:", session.id);
    await flagPaymentForManualRefund(session, "réservation annulée (frais de changement de places)");
    return { received: true, refunded: false, flaggedForReview: true, reason: "reservation cancelled" };
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

      // A seat increase raises what the reservation is actually worth —
      // keep the linked Payment row's totals in step, or settleReservation
      // (which computes the final balance/invoice purely from
      // Payment.totalAmount/remainingAmount, not WorkshopReservation.totalPrice)
      // would under-bill and under-invoice the customer at final settlement.
      // The deposit already paid is untouched (no additional deposit is
      // collected for added seats — only this flat fee, handled separately
      // above); remainingAmount is recomputed from the new total minus what's
      // actually been paid, not by adding the delta, so this can't compound
      // rounding drift if it ever ran twice.
      if (isIncrease && newTotalPrice) {
        await tx.payment.update({
          where: { id: reservation.payment.id },
          data: {
            totalAmount: Number(newTotalPrice),
            remainingAmount: Number(newTotalPrice) - Number(reservation.payment.paidAmount),
          },
        });
      }

      // Real collected revenue needs a legal document. Guarded on the
      // Payment row not already carrying one — Invoice.paymentId is @unique,
      // and a second seats-change fee against the same reservation (its
      // Payment row is 1:1 and reused across fee events) would otherwise
      // collide. See the flagged edge case in the audit report: this guard
      // silently skips invoicing a legitimate second fee rather than
      // resolving where that revenue's invoice should go.
      if (!reservation.payment.invoice && hasInvoiceableVatIdentity(reservation.customer)) {
        await issueInvoice(tx, {
          paymentId: reservation.payment.id,
          source: "WORKSHOP",
          totalInclVat: changeFeeAmount,
          customer: buildInvoiceCustomer(reservation.customer),
          lines: buildServiceInvoiceLines({
            description: `Frais de changement de nombre de places — ${reservation.session.workshop.title}`,
            totalAmount: changeFeeAmount,
          }),
        });
      }
    }
    return { claimed: true };
  });

  if (result.capacityExceeded) {
    // The session filled up between the admin starting this change and the
    // customer paying the fee — refund it rather than silently dropping the
    // increase, and tell the customer why instead of leaving them guessing
    // why their card was charged then refunded.
    console.warn(`[stripe-webhook] Seats increase for reservation ${reservation.id} would exceed capacity, flagging for manual refund:`, session.id);
    await flagPaymentForManualRefund(session, "places épuisées entre-temps (frais de changement de places)");
    sendEmail({
      to: reservation.customer.email,
      subject: `Places non disponibles — ${reservation.session.workshop.title} — Meri Beauty`,
      text:
        `Bonjour ${reservation.customer.fullName},\n\n` +
        `La session "${reservation.session.workshop.title}" s'est complétée entre-temps : nous ne pouvons pas ajouter la ou les places supplémentaires demandées. ` +
        `Notre équipe va procéder au remboursement intégral du paiement correspondant sous peu ; votre réservation reste inchangée (${previousSeatsCount} place(s)).\n\n` +
        `N'hésitez pas à nous contacter si vous souhaitez être mis(e) sur liste d'attente.\n\n` +
        `L'équipe Meri Beauty`,
      html:
        `<p>Bonjour ${reservation.customer.fullName},</p>` +
        `<p>La session "${reservation.session.workshop.title}" s'est complétée entre-temps : nous ne pouvons pas ajouter la ou les places supplémentaires demandées. ` +
        `Notre équipe va procéder au remboursement intégral du paiement correspondant sous peu ; votre réservation reste inchangée (${previousSeatsCount} place(s)).</p>` +
        `<p>N'hésitez pas à nous contacter si vous souhaitez être mis(e) sur liste d'attente.</p>` +
        `<p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[stripe-webhook] seats-capacity-refund email failed:", err));
    return { received: true, refunded: false, flaggedForReview: true, reason: "capacity exceeded" };
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
