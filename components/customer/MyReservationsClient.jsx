"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { resumeReservationPayment } from "@/actions/payment/resume-reservation-payment";
import { cancelReservation } from "@/actions/reservation/cancel-reservation";
import {
  isWithinCancellationWindow,
  CANCELLATION_WINDOW_HOURS,
} from "@/lib/reservationRules";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const APPOINTMENT_STATUS_CONFIG = {
  PENDING: { label: "En attente", className: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Confirmé", className: "bg-emerald-100 text-emerald-800" },
  COMPLETED: { label: "Terminé", className: "bg-gray-100 text-gray-600" },
  CANCELLED: { label: "Annulé", className: "bg-red-100 text-red-700" },
  NO_SHOW: { label: "Absent", className: "bg-orange-100 text-orange-700" },
};

const PAYMENT_STATUS_CONFIG = {
  PENDING: { label: "Paiement en attente", className: "bg-amber-100 text-amber-800" },
  PARTIALLY_PAID: { label: "Acompte payé", className: "bg-blue-100 text-blue-800" },
  PAID: { label: "Payé", className: "bg-emerald-100 text-emerald-800" },
  REFUNDED: { label: "Remboursé", className: "bg-purple-100 text-purple-800" },
};

function StatusBadge({ label, className }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

// ─── Single reservation card ──────────────────────────────────────────────────

function ReservationCard({ reservation, onCancelled }) {
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [loadingCancel, setLoadingCancel] = useState(false);
  // Track local cancelled state so the card updates instantly without a full reload
  const [isCancelled, setIsCancelled] = useState(
    reservation.status === "CANCELLED",
  );

  const effectiveStatus = isCancelled ? "CANCELLED" : reservation.status;
  const apptStatusConfig =
    APPOINTMENT_STATUS_CONFIG[effectiveStatus] ?? {
      label: effectiveStatus,
      className: "bg-gray-100 text-gray-600",
    };
  const paymentStatusConfig = reservation.payment
    ? (PAYMENT_STATUS_CONFIG[reservation.payment.status] ?? {
        label: reservation.payment.status,
        className: "bg-gray-100 text-gray-600",
      })
    : null;

  // ── 48-hour window check ─────────────────────────────────────────────────
  const blocked = isWithinCancellationWindow(reservation.startTime);

  // Actions are only available for PENDING or CONFIRMED, not-yet-cancelled
  const isActionable =
    !isCancelled &&
    effectiveStatus !== "COMPLETED" &&
    effectiveStatus !== "NO_SHOW" &&
    effectiveStatus !== "CANCELLED";

  // ── Payment resume ───────────────────────────────────────────────────────
  async function handleResumePayment() {
    setLoadingPayment(true);
    try {
      const result = await resumeReservationPayment(reservation.payment.id);
      if (!result.success || !result.url) {
        toast.error(
          result.message ??
            "Impossible de créer la session de paiement. Veuillez réessayer.",
        );
        return;
      }
      window.location.href = result.url;
    } catch {
      toast.error("Une erreur est survenue. Veuillez réessayer.");
      setLoadingPayment(false);
    }
  }

  // ── Cancel ───────────────────────────────────────────────────────────────
  async function handleCancel() {
    if (loadingCancel || blocked) return;
    setLoadingCancel(true);
    try {
      const result = await cancelReservation(reservation.id);
      if (result.success) {
        setIsCancelled(true);
        toast.success(result.message ?? "Réservation annulée.");
        onCancelled?.();
      } else {
        toast.error(result.message ?? "Impossible d'annuler cette réservation.");
      }
    } catch {
      toast.error("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setLoadingCancel(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50 px-5 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#2F3A2E]">
            {reservation.service.name}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            avec {reservation.staff.fullName}
          </p>
        </div>
        <StatusBadge {...apptStatusConfig} />
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="space-y-3 px-5 py-4">
        {/* Date */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <svg
            className="h-4 w-4 shrink-0 text-[#C8A46A]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5"
            />
          </svg>
          <span className="capitalize">{formatDate(reservation.date)}</span>
        </div>

        {/* Time */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <svg
            className="h-4 w-4 shrink-0 text-[#C8A46A]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            {formatTime(reservation.startTime)} · {reservation.duration} min
          </span>
        </div>

        {/* Payment summary */}
        {reservation.payment && (
          <div className="space-y-1.5 rounded-xl bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Statut paiement</span>
              <StatusBadge {...paymentStatusConfig} />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-semibold text-[#2F3A2E]">
                {formatAmount(reservation.payment.totalAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Payé</span>
              <span className="font-semibold text-emerald-600">
                {formatAmount(reservation.payment.paidAmount)}
              </span>
            </div>
            {reservation.payment.remainingAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Reste à payer</span>
                <span className="font-semibold text-amber-600">
                  {formatAmount(reservation.payment.remainingAmount)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer actions ──────────────────────────────────────────────── */}
      <div className="space-y-2 border-t border-gray-100 px-5 py-4">
        {/* Finalise payment */}
        {reservation.awaitingPayment && !isCancelled && (
          <button
            onClick={handleResumePayment}
            disabled={loadingPayment}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8A46A] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingPayment ? (
              <>
                <Spinner />
                Redirection…
              </>
            ) : (
              <>
                <CreditCardIcon />
                Finaliser le paiement
              </>
            )}
          </button>
        )}

        {/* Modify / Cancel — only for actionable reservations */}
        {isActionable && (
          <>
            {blocked ? (
              /* 48-hour lock notice */
              <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                <p className="text-xs text-amber-700">
                  Les modifications et annulations ne sont plus disponibles
                  moins de {CANCELLATION_WINDOW_HOURS} heures avant le
                  rendez-vous.
                </p>
              </div>
            ) : (
              /* Modify + Cancel row */
              <div className="flex gap-2">
                {/* Modify — links to the reservation booking flow pre-filled */}
                <Link
                  href={`/reservation?modify=${reservation.id}`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <PencilIcon />
                  Modifier
                </Link>

                {/* Cancel */}
                <button
                  onClick={handleCancel}
                  disabled={loadingCancel}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingCancel ? (
                    <>
                      <Spinner className="text-red-500" />
                      Annulation…
                    </>
                  ) : (
                    <>
                      <XIcon />
                      Annuler
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {/* Already cancelled notice */}
        {isCancelled && (
          <p className="text-center text-xs text-gray-400">
            Cette réservation a été annulée.
          </p>
        )}
      </div>

      {/* Stripe notice only when payment button is shown */}
      {reservation.awaitingPayment && !isCancelled && (
        <p className="px-5 pb-4 text-center text-xs text-gray-400">
          🔒 Paiement sécurisé par Stripe
        </p>
      )}
    </div>
  );
}

// ─── Inline SVG micro-icons (avoid extra imports) ─────────────────────────────

function Spinner({ className = "" }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

function CreditCardIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <svg
          className="h-8 w-8 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-[#2F3A2E]">Aucune réservation</h3>
      <p className="mt-2 max-w-xs text-sm text-gray-500">
        Vous n&apos;avez pas encore de rendez-vous. Prenez votre premier
        rendez-vous en quelques secondes.
      </p>
      <Link
        href="/reservation"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b]"
      >
        Prendre un rendez-vous
      </Link>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Client component for /mes-reservations.
 *
 * - Renders reservation cards with payment, modify, and cancel actions.
 * - Modify/Cancel are hidden behind the 48-hour cancellation window check.
 * - The window check runs on the client for instant feedback but is also
 *   enforced server-side in cancelReservation().
 *
 * @param {{ reservations: Array<object> }} props
 */
export default function MyReservationsClient({ reservations }) {
  if (!reservations || reservations.length === 0) {
    return <EmptyState />;
  }

  const awaitingPayment = reservations.filter((r) => r.awaitingPayment);
  const others = reservations.filter((r) => !r.awaitingPayment);

  return (
    <div className="space-y-10">
      {/* Pending payments section */}
      {awaitingPayment.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-amber-700">
              Paiement en attente
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {awaitingPayment.map((r) => (
              <ReservationCard key={r.id} reservation={r} />
            ))}
          </div>
        </section>
      )}

      {/* All other reservations */}
      {others.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-400">
            Mes rendez-vous
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((r) => (
              <ReservationCard key={r.id} reservation={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
