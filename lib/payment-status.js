/**
 * lib/payment-status.js
 *
 * Single source of truth for reading payment state.
 *
 * Every page that needs to display payment information (success page,
 * customer payment history, staff payment dashboard) should call
 * getPaymentStatus instead of building its own Prisma query.
 *
 * This module is intentionally read-only — it never mutates any record.
 * The Stripe webhook remains the sole authority for updating payment status.
 *
 * Lookup strategies (pass exactly one):
 *   - stripeSessionId  → matches Payment.transactionReference
 *   - paymentId        → matches Payment.id directly
 *   - appointmentId    → matches Payment.appointmentId
 */

import { prisma } from "@/lib/prisma";

// ─── Internal query ───────────────────────────────────────────────────────────

/**
 * Shared Prisma include shape used by every lookup variant.
 * Keep this in one place so future additions (e.g. reviews) only require
 * a single change.
 */
const PAYMENT_STATUS_INCLUDE = {
  transactions: {
    where: { isDeleted: false },
    orderBy: { paidAt: "asc" },
  },
  appointment: {
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          avatar: true,
        },
      },
      staffService: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          staff: {
            select: {
              id: true,
              reservationConfirmationMode: true,
              depositEnabled: true,
              depositPercentage: true,
              stripeChargesEnabled: true,
              stripePayoutsEnabled: true,
              user: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          },
        },
      },
    },
  },
};

// ─── Normaliser ───────────────────────────────────────────────────────────────

/**
 * Converts all Prisma Decimal fields to plain JS numbers so callers never
 * need to call Number() or toString() themselves.
 *
 * @param {object} payment - Raw Prisma Payment record with nested relations
 * @returns {PaymentStatusResult}
 */
function normalizePaymentStatus(payment) {
  return {
    // ── Payment ──────────────────────────────────────────────────────────
    payment: {
      id: payment.id,
      appointmentId: payment.appointmentId,
      depositAmount: Number(payment.depositAmount),
      totalAmount: Number(payment.totalAmount),
      paidAmount: Number(payment.paidAmount),
      remainingAmount: Number(payment.remainingAmount),
      paymentType: payment.paymentType,         // "ON_SITE" | "ONLINE" | "DEPOSIT"
      status: payment.status,                    // "PENDING" | "PAID" | "PARTIALLY_PAID" | "REFUNDED"
      paidAt: payment.paidAt,
      transactionReference: payment.transactionReference, // Stripe session ID
      isDeleted: payment.isDeleted,
    },

    // ── Appointment ───────────────────────────────────────────────────────
    appointment: {
      id: payment.appointment.id,
      date: payment.appointment.date,
      startTime: payment.appointment.startTime,
      endTime: payment.appointment.endTime,
      status: payment.appointment.status,        // "PENDING" | "CONFIRMED" | ...
      notes: payment.appointment.notes,
      isDeleted: payment.appointment.isDeleted,
    },

    // ── Customer ──────────────────────────────────────────────────────────
    customer: payment.appointment.user,

    // ── Staff ─────────────────────────────────────────────────────────────
    staff: {
      id: payment.appointment.staffService.staff.id,
      reservationConfirmationMode:
        payment.appointment.staffService.staff.reservationConfirmationMode,
      depositEnabled: payment.appointment.staffService.staff.depositEnabled,
      depositPercentage: Number(
        payment.appointment.staffService.staff.depositPercentage
      ),
      stripeChargesEnabled:
        payment.appointment.staffService.staff.stripeChargesEnabled,
      stripePayoutsEnabled:
        payment.appointment.staffService.staff.stripePayoutsEnabled,
      user: payment.appointment.staffService.staff.user,
    },

    // ── Service ───────────────────────────────────────────────────────────
    service: payment.appointment.staffService.service,

    // ── StaffService (price / duration) ──────────────────────────────────
    staffService: {
      id: payment.appointment.staffService.id,
      price: Number(payment.appointment.staffService.price),
      duration: payment.appointment.staffService.duration,
      photo: payment.appointment.staffService.photo,
    },

    // ── Transactions ──────────────────────────────────────────────────────
    transactions: payment.transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      method: t.method,                          // "CASH" | "CARD" | "ONLINE"
      transactionType: t.transactionType,        // "DEPOSIT" | "FINAL_PAYMENT" | "REFUND"
      paidAt: t.paidAt,
      stripeCheckoutSessionId: t.stripeCheckoutSessionId,
      stripePaymentIntentId: t.stripePaymentIntentId,
    })),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieve the full payment state for a reservation.
 *
 * Pass exactly one of the three lookup keys.
 *
 * @param {{
 *   stripeSessionId?: string,
 *   paymentId?: string,
 *   appointmentId?: string,
 * }} lookup
 *
 * @returns {Promise<PaymentStatusResult | null>}
 *   Returns null when no matching payment is found.
 *   Throws on unexpected database errors.
 */
export async function getPaymentStatus({ stripeSessionId, paymentId, appointmentId } = {}) {
  // Build the where clause from whichever key was provided
  let where;

  if (stripeSessionId) {
    where = { transactionReference: stripeSessionId, isDeleted: false };
  } else if (paymentId) {
    where = { id: paymentId, isDeleted: false };
  } else if (appointmentId) {
    where = { appointmentId, isDeleted: false };
  } else {
    throw new Error(
      "[getPaymentStatus] At least one of stripeSessionId, paymentId, or appointmentId must be provided"
    );
  }

  const payment = await prisma.payment.findFirst({
    where,
    include: PAYMENT_STATUS_INCLUDE,
  });

  if (!payment) return null;

  return normalizePaymentStatus(payment);
}

/**
 * @typedef {Object} PaymentStatusResult
 * @property {{
 *   id: string,
 *   appointmentId: string,
 *   depositAmount: number,
 *   totalAmount: number,
 *   paidAmount: number,
 *   remainingAmount: number,
 *   paymentType: string,
 *   status: string,
 *   paidAt: Date | null,
 *   transactionReference: string | null,
 *   isDeleted: boolean,
 * }} payment
 *
 * @property {{
 *   id: string,
 *   date: Date,
 *   startTime: Date,
 *   endTime: Date,
 *   status: string,
 *   notes: string | null,
 *   isDeleted: boolean,
 * }} appointment
 *
 * @property {{
 *   id: string,
 *   fullName: string,
 *   email: string,
 *   phone: string,
 *   avatar: string | null,
 * }} customer
 *
 * @property {{
 *   id: string,
 *   reservationConfirmationMode: string,
 *   depositEnabled: boolean,
 *   depositPercentage: number,
 *   stripeChargesEnabled: boolean,
 *   stripePayoutsEnabled: boolean,
 *   user: { id: string, fullName: string, email: string, avatar: string | null },
 * }} staff
 *
 * @property {{
 *   id: string,
 *   name: string,
 *   description: string | null,
 * }} service
 *
 * @property {{
 *   id: string,
 *   price: number,
 *   duration: number,
 *   photo: string,
 * }} staffService
 *
 * @property {Array<{
 *   id: string,
 *   amount: number,
 *   method: string,
 *   transactionType: string,
 *   paidAt: Date,
 *   stripeCheckoutSessionId: string | null,
 *   stripePaymentIntentId: string | null,
 * }>} transactions
 */
