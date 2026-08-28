import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { captureCriticalError } from "@/lib/monitoring";

const REFUND_EPSILON = 0.01;

// After this many failed attempts, stop auto-retrying and escalate to staff
// for manual handling in the Stripe dashboard instead — an unbounded retry
// loop on a permanently-broken card/account would just spam Stripe forever.
const MAX_RETRIES = 5;

// Shared by the bulk cron job and the single-payment admin retry (see the
// dashboard "Réconciliation" page) — both need the exact same relations to
// build a customer-facing description/email.
const STUCK_PAYMENT_INCLUDE = {
  order: { select: { orderNumber: true, user: { select: { email: true, fullName: true } } } },
  appointment: { select: { date: true, user: { select: { email: true, fullName: true } } } },
  workshopReservation: {
    select: { session: { select: { workshop: { select: { title: true } } } }, customer: { select: { email: true, fullName: true } } },
  },
  formationReservation: {
    select: { session: { select: { formation: { select: { title: true } } } }, customer: { select: { email: true, fullName: true } } },
  },
};

function describePayment(payment) {
  if (payment.order) return `commande n°${payment.order.orderNumber}`;
  if (payment.appointment) return `rendez-vous du ${payment.appointment.date.toLocaleDateString("fr-FR", { timeZone: "Europe/Brussels" })}`;
  if (payment.workshopReservation) return `réservation atelier "${payment.workshopReservation.session.workshop.title}"`;
  if (payment.formationReservation) return `réservation formation "${payment.formationReservation.session.formation.title}"`;
  return `paiement ${payment.id}`;
}

function customerEmail(payment) {
  return (
    payment.order?.user?.email ||
    payment.appointment?.user?.email ||
    payment.workshopReservation?.customer?.email ||
    payment.formationReservation?.customer?.email ||
    null
  );
}

/**
 * One retry attempt against Stripe for a single stuck Payment. Shared by the
 * bulk cron sweep (retryFailedRefunds) and the single-row admin retry
 * (retryRefundReconciliationForPayment, called from the dashboard
 * "Réconciliation" page) so both go through identical money-moving logic —
 * the dashboard action is a thin, auth-gated wrapper, never a reimplementation.
 *
 * Never throws — always resolves to an outcome so callers can report status
 * without their own try/catch.
 */
async function attemptRefundRetry(payment) {
  // The amount owed by THIS stuck operation, fixed at initiation time —
  // never recomputed from the Transaction ledger. Recomputing "what's left"
  // here would resolve to the full outstanding balance whenever no REFUND
  // row was ever written, which is exactly why the payment is stuck (the
  // original attempt was interrupted before that row could be committed).
  // Without a pinned amount there is nothing safe to retry automatically —
  // this must go to manual reconciliation in the Stripe dashboard instead
  // of guessing.
  if (payment.pendingRefundAmount == null) {
    return { outcome: "missing-pending-amount" };
  }
  const pinnedAmount = Number(payment.pendingRefundAmount);
  try {
    // Everything below — the prior-refund re-check, the actual Stripe
    // refund call, and this attempt's own ledger write — runs inside one
    // locked transaction so reconcileMissedRefunds (which also runs from
    // the cron sweep, concurrently) can't observe Stripe's side already
    // reflecting this refund while the local Transaction row isn't written
    // yet, and write a duplicate REFUND row for the same money movement.
    // Same lock key as reconcile-missed-refunds.js's external-refund path —
    // whichever job gets there first fully finishes before the other reads.
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`external-refund:${payment.id}`}))`
        );

        const priorRefunds = await tx.transaction.aggregate({
          where: { paymentId: payment.id, transactionType: "REFUND" },
          _sum: { amount: true },
        });
        const alreadyRefunded = Number(priorRefunds._sum.amount ?? 0);
        if (pinnedAmount - alreadyRefunded <= REFUND_EPSILON) {
          // Already fully refunded by some other path (e.g. reconciliation,
          // or this same retry racing itself) — nothing left to retry, just
          // clear the stuck state. Comparing against alreadyRefunded (not
          // just pinnedAmount, which is fixed at initiation and never zero
          // on its own) is what actually detects that case — otherwise this
          // branch never fires and a refund reconciliation.js already
          // recorded gets replayed here too, double-counting the REFUND
          // ledger entry for the same Stripe money movement.
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: "REFUNDED",
              pendingRefundAmount: null,
              pendingRefundIdempotencyKey: null,
              pendingRefundCreditNoteId: null,
            },
          });
          return { outcome: "already-refunded" };
        }

        const stripeSession = await stripe.checkout.sessions.retrieve(payment.transactionReference);
        if (!stripeSession.payment_intent) {
          return { outcome: "no-payment-intent" };
        }

        // Stable across every retry of this exact operation — a request
        // that actually reached Stripe but whose response was lost (crash,
        // timeout) replays into the same refund object instead of moving
        // money twice.
        await stripe.refunds.create(
          { payment_intent: stripeSession.payment_intent, amount: Math.round(pinnedAmount * 100) },
          { idempotencyKey: payment.pendingRefundIdempotencyKey ?? undefined }
        );

        const fullyRefunded = alreadyRefunded + pinnedAmount + REFUND_EPSILON >= Number(payment.paidAmount);
        await tx.transaction.create({
          data: {
            paymentId: payment.id,
            amount: pinnedAmount,
            method: "ONLINE",
            transactionType: "REFUND",
            paidAt: new Date(),
            stripePaymentIntentId: stripeSession.payment_intent,
            // The credit note was pinned onto the Payment before the original,
            // interrupted attempt — this retry is only ever redoing the money
            // movement, so the link it created still applies here.
            creditNoteId: payment.pendingRefundCreditNoteId,
          },
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
            refundAttemptedAt: new Date(),
            pendingRefundAmount: null,
            pendingRefundIdempotencyKey: null,
            pendingRefundCreditNoteId: null,
          },
        });
        return { outcome: "succeeded" };
      },
      { timeout: 15_000 } // two sequential Stripe calls inside the lock — default 5s is too tight
    );
    return result;
  } catch (err) {
    const nextRetryCount = payment.refundRetryCount + 1;
    const exhausted = nextRetryCount >= MAX_RETRIES;
    captureCriticalError(err, {
      area: "refund-reconciliation",
      paymentId: payment.id,
      retryCount: nextRetryCount,
      exhausted,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "REFUND_FAILED",
        refundFailureReason: err?.message?.slice(0, 500) ?? "Erreur inconnue",
        refundAttemptedAt: new Date(),
        refundRetryCount: nextRetryCount,
      },
    });

    if (exhausted) {
      const salon = await prisma.salon.findUnique({ where: { id: "main-salon" }, select: { email: true } });
      if (salon?.email) {
        const label = describePayment(payment);
        const email = customerEmail(payment);
        sendEmail({
          to: salon.email,
          subject: `⚠️ Remboursement Stripe toujours en échec après ${nextRetryCount} tentatives – ${label}`,
          text: `Le remboursement Stripe pour ${label}${email ? ` (client : ${email})` : ""} a échoué ${nextRetryCount} fois. Traitement manuel requis dans le dashboard Stripe — les nouvelles tentatives automatiques sont arrêtées pour ce paiement.`,
          html: `<p>Le remboursement Stripe pour ${label}${email ? ` (client : ${email})` : ""} a échoué ${nextRetryCount} fois. Traitement manuel requis dans le dashboard Stripe — les nouvelles tentatives automatiques sont arrêtées pour ce paiement.</p>`,
        }).catch(() => {}); // sendEmail already reports its own failures to monitoring
      }
    }

    return { outcome: "failed", exhausted, message: err?.message ?? "Erreur inconnue" };
  }
}

/**
 * For the /api/cron job runner, not called from the UI: retries every
 * Payment stuck in REFUND_PENDING (a refund attempt was interrupted, e.g.
 * by a server restart, before the synchronous try/catch that normally
 * records the outcome ever ran) or REFUND_FAILED (the Stripe call itself
 * errored). Only ever redoes the money movement — the cancellation itself
 * (stock restock, reservation status, waiting-list notify, credit note)
 * already happened synchronously at cancel time in every caller
 * (actions/boutique/orders.js, actions/appointment/manage-appointment.js,
 * actions/workshops/manage-reservation.js), decoupled from whether the
 * Stripe call succeeds — so there is nothing left to redo here except the
 * refund + its Payment/Transaction bookkeeping.
 *
 * Deliberately kept out of any "use server" module — every export from a
 * "use server" file is a public, unauthenticated POST endpoint, and this
 * moves real money via Stripe on each call. The single-payment admin retry
 * below (retryRefundReconciliationForPayment) has the same restriction —
 * actions/dashboard/webhook-recovery.js is the auth-gated "use server" layer
 * in front of it.
 */
export async function retryFailedRefunds() {
  const stuck = await prisma.payment.findMany({
    where: { status: { in: ["REFUND_PENDING", "REFUND_FAILED"] }, refundRetryCount: { lt: MAX_RETRIES } },
    include: STUCK_PAYMENT_INCLUDE,
  });

  let retried = 0;
  let succeeded = 0;
  let exhausted = 0;
  let needsManualReconciliation = 0;

  for (const payment of stuck) {
    if (!payment.transactionReference) continue;

    const result = await attemptRefundRetry(payment);
    if (result.outcome === "already-refunded") continue; // not a real retry attempt, matches prior behavior
    if (result.outcome === "missing-pending-amount") {
      // No exact amount was ever pinned for this stuck operation (e.g. a
      // pre-existing row from before that bookkeeping was added) — refusing
      // to guess is safer than resolving to the full remaining balance.
      needsManualReconciliation += 1;
      continue;
    }

    retried += 1;
    if (result.outcome === "succeeded") succeeded += 1;
    if (result.exhausted) exhausted += 1;
  }

  return { success: true, retried, succeeded, exhausted, needsManualReconciliation };
}

/**
 * Single-payment retry for the dashboard "Réconciliation" page's per-row
 * "Réessayer" button — same underlying logic as the bulk cron sweep above,
 * just scoped to one Payment and returning a human-readable outcome instead
 * of aggregate counts. Re-checks status itself (doesn't trust the caller),
 * since the row shown in the UI could be stale by the time staff clicks.
 */
export async function retryRefundReconciliationForPayment(paymentId) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: STUCK_PAYMENT_INCLUDE,
  });

  if (!payment) {
    return { success: false, message: "Paiement introuvable." };
  }
  if (!["REFUND_PENDING", "REFUND_FAILED"].includes(payment.status)) {
    return { success: false, message: "Ce paiement n'est plus en attente de réconciliation — il a déjà été traité." };
  }
  if (!payment.transactionReference) {
    return { success: false, message: "Aucune référence Stripe enregistrée pour ce paiement — traitement manuel requis dans le Dashboard Stripe." };
  }

  const result = await attemptRefundRetry(payment);

  if (result.outcome === "succeeded") {
    return { success: true, message: "Remboursement effectué avec succès." };
  }
  if (result.outcome === "already-refunded") {
    return { success: true, message: "Ce paiement était déjà entièrement remboursé — statut mis à jour." };
  }
  if (result.outcome === "no-payment-intent") {
    return { success: false, message: "Session Stripe introuvable ou incomplète — vérifiez manuellement dans le Dashboard Stripe." };
  }
  if (result.outcome === "missing-pending-amount") {
    return {
      success: false,
      message: "Aucun montant de remboursement enregistré pour cette opération — impossible de réessayer automatiquement sans risquer de rembourser le solde entier. Traitement manuel requis dans le Dashboard Stripe.",
    };
  }
  return {
    success: false,
    message: result.exhausted
      ? `Échec du remboursement (${result.message}) — nombre maximal de tentatives atteint, traitement manuel requis dans Stripe.`
      : `Échec du remboursement : ${result.message}. Vous pouvez réessayer.`,
  };
}
