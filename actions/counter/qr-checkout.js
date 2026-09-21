"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isTillCashOperator } from "@/lib/authorization";
import { stripe } from "@/lib/stripe";
import { roundMoney } from "@/lib/tax-policy";
import {
  COUNTER_QR_MESSAGES,
  COUNTER_QR_MINIMUM,
  COUNTER_QR_SURFACES,
  COUNTER_QR_TTL_MS,
  buildCounterQrParams,
} from "@/lib/counter/qr-checkout";

/**
 * Creating and watching a « Carte QR » payment at the counter.
 *
 * Shows a QR the client scans with their own phone. Nothing is recorded here:
 * the settle action the operator was already using does that, once it has
 * verified the session with Stripe itself (lib/counter/qr-checkout.js).
 *
 * Till operators only (admins + Marie), like every other money screen — and
 * never for an independent's sale, which the salon does not bank.
 */

async function requireOperator() {
  const session = await auth();
  if (!session?.user || !isTillCashOperator(session.user)) return { error: "Non autorisé." };
  return { session };
}

/**
 * Resolves what is being paid, whose sale it is and what it should be called
 * on the client's phone — from the database, never from the caller.
 */
async function describeTarget(surface, targetId) {
  if (surface === COUNTER_QR_SURFACES.APPOINTMENT) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        user: { select: { email: true } },
        staff: { select: { type: true } },
        staffService: { select: { service: { select: { name: true } } } },
        payment: { select: { payeeStaffId: true } },
      },
    });
    if (!appointment) return null;
    return {
      label: appointment.staffService?.service?.name ?? "Prestation",
      email: appointment.user?.email ?? null,
      independent: appointment.payment
        ? Boolean(appointment.payment.payeeStaffId)
        : appointment.staff?.type === "INDEPENDENT",
    };
  }

  if (surface === COUNTER_QR_SURFACES.ORDER) {
    const order = await prisma.order.findUnique({
      where: { id: targetId },
      select: { id: true, user: { select: { email: true } }, payment: { select: { payeeStaffId: true } } },
    });
    if (!order) return null;
    // A boutique order is always the salon's own sale.
    return { label: "Commande boutique", email: order.user?.email ?? null, independent: Boolean(order.payment?.payeeStaffId) };
  }

  const isWorkshop = surface === COUNTER_QR_SURFACES.WORKSHOP;
  const delegate = isWorkshop ? prisma.workshopReservation : prisma.formationReservation;
  const reservation = await delegate.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      customer: { select: { email: true } },
      payment: { select: { payeeStaffId: true } },
      session: {
        select: isWorkshop
          ? { workshop: { select: { title: true } } }
          : { formation: { select: { title: true } } },
      },
    },
  });
  if (!reservation) return null;
  const parent = isWorkshop ? reservation.session?.workshop : reservation.session?.formation;
  return {
    label: parent?.title ?? (isWorkshop ? "Atelier" : "Formation"),
    email: reservation.customer?.email ?? null,
    independent: Boolean(reservation.payment?.payeeStaffId),
  };
}

/**
 * @param {{ surface: string, targetId: string, amount: number }} input
 * @returns {Promise<{ success: boolean, message?: string, data?: { sessionId: string, url: string, amount: number } }>}
 */
export async function createCounterQrCheckout(input) {
  const guard = await requireOperator();
  if (guard.error) return { success: false, message: guard.error };

  const surface = typeof input?.surface === "string" ? input.surface : "";
  const targetId = typeof input?.targetId === "string" ? input.targetId.trim() : "";
  const amount = roundMoney(Number(input?.amount));

  if (!Object.values(COUNTER_QR_SURFACES).includes(surface)) {
    return { success: false, message: COUNTER_QR_MESSAGES.COUNTER_QR_SURFACE_UNKNOWN };
  }
  if (!targetId) return { success: false, message: "Vente introuvable." };
  if (!Number.isFinite(amount) || amount < COUNTER_QR_MINIMUM) {
    return { success: false, message: COUNTER_QR_MESSAGES.COUNTER_QR_BELOW_MINIMUM };
  }

  const target = await describeTarget(surface, targetId);
  if (!target) return { success: false, message: "Vente introuvable." };
  // The salon cannot take an independent's money: her sale is settled with
  // her, exactly as for « Virement » (lib/payments/awaited-transfer.js).
  if (target.independent) return { success: false, message: COUNTER_QR_MESSAGES.COUNTER_QR_INDEPENDENT };

  try {
    const session = await stripe.checkout.sessions.create(
      buildCounterQrParams({
        surface,
        targetId,
        amount,
        customerEmail: target.email,
        label: target.label,
        expiresAt: new Date(Date.now() + COUNTER_QR_TTL_MS),
      })
    );
    return { success: true, data: { sessionId: session.id, url: session.url, amount } };
  } catch (error) {
    console.error("[createCounterQrCheckout]", error);
    return { success: false, message: "Impossible de générer le QR de paiement." };
  }
}

/**
 * Polled by the counter modal while the client pays. Read-only: settling is
 * the settle action's job, so a status check can never move money.
 */
export async function getCounterQrStatus(sessionId) {
  const guard = await requireOperator();
  if (guard.error) return { success: false, message: guard.error };
  if (!sessionId || typeof sessionId !== "string") return { success: false, message: "Paiement introuvable." };

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.kind !== "counter_qr") return { success: false, message: "Paiement introuvable." };
    return {
      success: true,
      data: {
        paid: session.payment_status === "paid",
        // "expired" once Stripe closes it; "open" while the client is paying.
        expired: session.status === "expired",
      },
    };
  } catch (error) {
    console.error("[getCounterQrStatus]", error);
    return { success: false, message: "Impossible de vérifier ce paiement." };
  }
}

/** Closes a QR the operator gave up on, so it cannot be paid afterwards. */
export async function cancelCounterQrCheckout(sessionId) {
  const guard = await requireOperator();
  if (guard.error) return { success: false, message: guard.error };
  if (!sessionId || typeof sessionId !== "string") return { success: false, message: "Paiement introuvable." };

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.kind !== "counter_qr") return { success: false, message: "Paiement introuvable." };
    // Already paid: expiring it would strand real money. The operator has to
    // settle it instead.
    if (session.payment_status === "paid") {
      return { success: false, message: "Ce paiement a déjà été effectué — encaissez-le." };
    }
    if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    return { success: true };
  } catch (error) {
    console.error("[cancelCounterQrCheckout]", error);
    return { success: false, message: "Impossible d'annuler ce QR." };
  }
}
