import { Prisma } from "@prisma/client";
import { stripe as defaultStripeClient } from "@/lib/stripe";
import { prisma as defaultPrismaClient } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { issueCreditNote } from "@/lib/invoicing";
import { reconcileStripeProductOrderRefund } from "@/lib/orders/reconcile-stripe-refund";
import {
  reconcileExceptionalReservationFullRefund,
  RESERVATION_REFUND_AUTHORIZATION,
} from "@/lib/payments/reconcile-reservation-refund";
import { captureCriticalError } from "@/lib/monitoring";

// Stripe retries a failing webhook endpoint for up to 3 days, then gives up
// silently — an endpoint outage, a bad deploy, or a signature-secret
// rotation during that window permanently drops the event with nothing
// surfacing the gap. 72h lookback covers Stripe's full retry window with no
// dead zone between "still retrying" and "this job would have caught it".
const LOOKBACK_HOURS = 72;
const REFUND_EPSILON = 0.01;

function round2(value) {
  return Math.round(value * 100) / 100;
}

const PAYMENT_INCLUDE = {
  invoice: true,
  transactions: true,
  order: { include: { items: true } },
  workshopReservation: true,
  formationReservation: true,
  // Appointment payments are Stripe Connect DIRECT CHARGES on the staff's
  // own connected account (see actions/payment/createCheckoutSession.js) —
  // their refund events never reach the platform's webhook endpoint at all
  // (that needs the connected-accounts checkbox + a second signing secret
  // registered in the Stripe Dashboard, still open — see docs/PRE_LAUNCH_FIXES.md
  // P10). This job routes around that entirely: it actively queries each
  // connected account's own refunds via the platform key + `stripeAccount`,
  // which Stripe allows regardless of webhook/event-forwarding config.
  appointment: { include: { user: { select: { email: true, fullName: true } } } },
};

async function findPaymentForPaymentIntent(prismaClient, stripeClient, paymentIntentId, stripeAccount) {
  // Fast path: some Transaction row already links this PaymentIntent to a
  // Payment (backfilled the first time any refund event touches it, or set
  // directly at checkout for newer payments) — a plain DB lookup, no Stripe
  // API call, and no stripeAccount context needed since it's our own data.
  const linked = await prismaClient.transaction.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { paymentId: true },
  });
  if (linked) {
    return prismaClient.payment.findUnique({ where: { id: linked.paymentId }, include: PAYMENT_INCLUDE });
  }

  // Fallback for older Payments whose ledger predates stripePaymentIntentId:
  // resolve via the Checkout Session that created this PaymentIntent. Must
  // run in the same stripeAccount context the PaymentIntent itself lives in.
  const sessions = await stripeClient.checkout.sessions.list(
    { payment_intent: paymentIntentId, limit: 1 },
    stripeAccount ? { stripeAccount } : undefined,
  );
  const session = sessions.data[0];
  if (!session) return null;
  return prismaClient.payment.findUnique({ where: { transactionReference: session.id }, include: PAYMENT_INCLUDE });
}

/** Mirrors rejectAppointment's own cancellation email wording, for the case
 * where an appointment gets auto-cancelled by this job rather than by an
 * admin action in the dashboard. */
async function sendAppointmentRefundEmail({ customerEmail, customerName, appointmentDate }) {
  if (!customerEmail) return;
  const dateStr = appointmentDate ? new Date(appointmentDate).toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" }) : "prévu";
  await sendEmail({
    to: customerEmail,
    subject: "Rendez-vous annulé – Meri Beauty",
    text:
      `Bonjour ${customerName ?? ""},\n\n` +
      `Votre rendez-vous du ${dateStr} a été annulé suite à un remboursement intégral effectué par notre équipe. ` +
      `Le remboursement apparaîtra sur votre compte sous quelques jours.\n\nL'équipe Meri Beauty`,
    html:
      `<p>Bonjour ${customerName ?? ""},</p>` +
      `<p>Votre rendez-vous du ${dateStr} a été annulé suite à un remboursement intégral effectué par notre équipe. ` +
      `Le remboursement apparaîtra sur votre compte sous quelques jours.</p><p>L'équipe Meri Beauty</p>`,
  }).catch((err) => console.error("[reconcile-missed-refunds] appointment cancellation email failed:", err));
}

/**
 * Scans one Stripe account's refunds (the platform account when
 * `stripeAccount` is undefined, or one staff member's connected account) and
 * replays the same idempotent reconcile helpers the webhook uses for any
 * refund our ledger doesn't yet fully reflect.
 */
async function scanAccount({ stripeClient, prismaClient, stripeAccount, cutoffUnix, seenChargeIds }) {
  let checked = 0;
  let reconciled = 0;
  const failures = [];
  const requestOptions = stripeAccount ? { stripeAccount } : undefined;

  let startingAfter;
  try {
  for (;;) {
    const page = await stripeClient.refunds.list(
      { created: { gte: cutoffUnix }, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      requestOptions,
    );

    for (const refund of page.data) {
      const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
      const dedupeKey = stripeAccount ? `${stripeAccount}:${chargeId}` : chargeId;
      if (refund.status !== "succeeded" || !chargeId || seenChargeIds.has(dedupeKey)) continue;
      seenChargeIds.add(dedupeKey);
      checked += 1;

      try {
        // Re-fetch the charge for its authoritative cumulative amount_refunded
        // — a refund list entry only carries that one refund's own amount,
        // not the running total, and several partial refunds can land on the
        // same charge within the lookback window.
        const charge = await stripeClient.charges.retrieve(chargeId, undefined, requestOptions);
        const paymentIntentId =
          typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!paymentIntentId) continue;

        const payment = await findPaymentForPaymentIntent(prismaClient, stripeClient, paymentIntentId, stripeAccount);
        if (!payment) continue; // Not ours, or a payout/transfer refund unrelated to a booking.

        const alreadyRecorded = payment.transactions
          .filter((t) => t.transactionType === "REFUND")
          .reduce((sum, t) => sum + Number(t.amount), 0);
        const stripeRefundedTotal = round2((charge.amount_refunded ?? 0) / 100);
        if (stripeRefundedTotal <= alreadyRecorded + REFUND_EPSILON) continue; // webhook (or a prior run) already caught this

        const stripeRefundId = charge.refunds?.data?.at(-1)?.id ?? refund.id;
        let appointmentReconciliation = null;

        await prismaClient.$transaction(async (tx) => {
          if (payment.orderId) {
            const result = await reconcileStripeProductOrderRefund(tx, {
              paymentId: payment.id,
              stripeRefundedTotal,
              stripePaymentIntentId: paymentIntentId,
              stripeRefundId,
            });
            if (result.newlyRefunded > REFUND_EPSILON && payment.invoice) {
              const creditNote = await issueCreditNote(tx, {
                invoiceId: payment.invoice.id,
                reason: "Remboursement Stripe reconcilié (webhook manqué)",
                totalInclVat: result.newlyRefunded,
              });
              if (result.transactionId) {
                await tx.transaction.update({ where: { id: result.transactionId }, data: { creditNoteId: creditNote.id } });
              }
            }
            return;
          }

          // Generic (appointment/workshop/formation) ledger sync — mirrors
          // handleChargeRefunded's own non-order branch in the webhook route.
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`external-refund:${payment.id}`}))`,
          );
          const locked = await tx.payment.findUnique({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
          const recorded = locked.transactions
            .filter((t) => t.transactionType === "REFUND")
            .reduce((sum, t) => sum + Number(t.amount), 0);
          const newlyRefunded = round2(stripeRefundedTotal - recorded);
          if (newlyRefunded <= REFUND_EPSILON) return;
          const fullyRefunded = stripeRefundedTotal + REFUND_EPSILON >= Number(locked.paidAmount);

          await tx.transaction.updateMany({
            where: { paymentId: locked.id, transactionType: { in: ["DEPOSIT", "FINAL_PAYMENT"] }, stripePaymentIntentId: null },
            data: { stripePaymentIntentId: paymentIntentId },
          });
          let creditNote = null;
          if (locked.invoice) {
            creditNote = await issueCreditNote(tx, {
              invoiceId: locked.invoice.id,
              reason: "Remboursement Stripe reconcilié (webhook manqué)",
              totalInclVat: newlyRefunded,
            });
          }
          await tx.transaction.create({
            data: {
              paymentId: locked.id,
              amount: newlyRefunded,
              method: "ONLINE",
              transactionType: "REFUND",
              paidAt: new Date(refund.created * 1000),
              stripePaymentIntentId: paymentIntentId,
              creditNoteId: creditNote?.id ?? null,
            },
          });
          await tx.payment.update({
            where: { id: locked.id },
            data: { status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" },
          });

          const reservationReconciliation = await reconcileExceptionalReservationFullRefund(tx, {
            payment: locked,
            stripeRefundedTotal,
            authorization: RESERVATION_REFUND_AUTHORIZATION.ADMIN_EXTERNAL_STRIPE_REFUND,
          });
          if (reservationReconciliation?.reconciled && reservationReconciliation.reservationKind === "appointment") {
            appointmentReconciliation = reservationReconciliation;
          }
        });

        if (appointmentReconciliation) await sendAppointmentRefundEmail(appointmentReconciliation);

        reconciled += 1;
        console.warn(
          `[reconcile-missed-refunds] Recovered a refund the webhook missed — payment ${payment.id}, charge ${chargeId}` +
            (stripeAccount ? ` (connected account ${stripeAccount})` : ""),
        );
      } catch (error) {
        failures.push({ chargeId, stripeAccount: stripeAccount ?? null, message: error?.message ?? "Erreur inconnue" });
        captureCriticalError(error, { area: "refund-reconciliation", chargeId, stripeAccount: stripeAccount ?? null });
      }
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data.at(-1).id;
  }
  } catch (error) {
    // stripeClient.refunds.list() itself failed — most commonly a revoked or
    // stale Stripe Connect account (staff disconnected, or platform access
    // was revoked on their side). This must never take down reconciliation
    // for the platform account or any OTHER connected account — the caller's
    // per-account loop keeps going regardless of what this function returns,
    // so surface it as one failure entry instead of throwing and losing every
    // account scanned after this one.
    failures.push({ chargeId: null, stripeAccount: stripeAccount ?? null, message: error?.message ?? "Erreur inconnue" });
    captureCriticalError(error, {
      area: "refund-reconciliation",
      context: "scanAccount:list",
      stripeAccount: stripeAccount ?? "platform",
    });
  }

  return { checked, reconciled, failures };
}

/**
 * Safety net for lib/orders/reconcile-stripe-refund.js /
 * lib/payments/reconcile-reservation-refund.js, both of which only run when
 * the Stripe `charge.refunded` webhook is actually delivered. Scans the
 * platform account (boutique/workshop/formation payments) AND every staff
 * member's connected Stripe account (appointment payments — Connect direct
 * charges, see PAYMENT_INCLUDE's comment above), independently re-deriving
 * refund state from Stripe's List Refunds API rather than trusting webhook
 * delivery, and replaying the exact same, already-idempotent reconciliation
 * helpers the webhook uses. Safe to run on a schedule — a no-op whenever
 * nothing was actually missed.
 *
 * Deliberately does NOT touch app/api/webhooks/stripe/route.js — it
 * duplicates the small amount of "generic" ledger-sync logic (the
 * appointment/workshop/formation branch) that lives inline there rather
 * than importing it, so this file has no coupling to that route's internals.
 */
export async function reconcileMissedRefunds({
  stripeClient = defaultStripeClient,
  prismaClient = defaultPrismaClient,
} = {}) {
  const cutoffUnix = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  const seenChargeIds = new Set();

  const platformResult = await scanAccount({ stripeClient, prismaClient, stripeAccount: undefined, cutoffUnix, seenChargeIds });

  const connectedStaff = await prismaClient.staff.findMany({
    where: { stripeAccountId: { not: null } },
    select: { stripeAccountId: true },
  });

  let checked = platformResult.checked;
  let reconciled = platformResult.reconciled;
  const failures = [...platformResult.failures];

  for (const staff of connectedStaff) {
    const result = await scanAccount({
      stripeClient,
      prismaClient,
      stripeAccount: staff.stripeAccountId,
      cutoffUnix,
      seenChargeIds,
    });
    checked += result.checked;
    reconciled += result.reconciled;
    failures.push(...result.failures);
  }

  return { checked, reconciled, failures };
}
