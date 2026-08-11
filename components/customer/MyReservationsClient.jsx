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
    timeZone: "Europe/Brussels",
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
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
    <div className="group relative overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-xl hover:border-[#2f3a2e]/30 hover:-translate-y-1">
      {/* Gradient accent line at top */}
      <div className="h-1.5 w-full bg-gradient-to-r from-[#2f3a2e] via-[#4a5a48] to-[#C8A46A]" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="relative p-6 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold text-[#2F3A2E] leading-tight">
              {reservation.service.name}
            </h3>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#2f3a2e] to-[#4a5a48]">
                <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <span className="font-medium">avec {reservation.staff.fullName}</span>
            </div>
          </div>
          <StatusBadge {...apptStatusConfig} />
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="space-y-3 px-6 pb-4">
        {/* Date and Time in modern cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#2f3a2e]/5 to-[#4a5a48]/5 p-4 border border-[#2f3a2e]/10">
            <div className="relative z-10">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <svg className="h-3.5 w-3.5 text-[#2f3a2e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                <span>Date</span>
              </div>
              <p className="text-sm font-bold text-gray-800 capitalize leading-tight">
                {formatDate(reservation.date)}
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#C8A46A]/10 to-[#C8A46A]/5 p-4 border border-[#C8A46A]/20">
            <div className="relative z-10">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <svg className="h-3.5 w-3.5 text-[#C8A46A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Heure</span>
              </div>
              <p className="text-sm font-bold text-gray-800 leading-tight">
                {formatTime(reservation.startTime)}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{reservation.duration} min</p>
            </div>
          </div>
        </div>

        {/* Payment summary with modern design */}
        {reservation.payment && (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-white p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Paiement</span>
              <StatusBadge {...paymentStatusConfig} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Total</span>
                <span className="font-bold text-[#2F3A2E]">
                  {formatAmount(reservation.payment.totalAmount)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Payé</span>
                <span className="font-bold text-emerald-600">
                  {formatAmount(reservation.payment.paidAmount)}
                </span>
              </div>
              {reservation.payment.remainingAmount > 0 && (
                <div className="flex items-center justify-between text-sm pt-2 border-t-2 border-gray-200">
                  <span className="text-gray-700 font-semibold">Reste à payer</span>
                  <span className="font-bold text-amber-600 text-base">
                    {formatAmount(reservation.payment.remainingAmount)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Footer actions ──────────────────────────────────────────────── */}
      <div className="space-y-3 border-t border-gray-100 bg-gradient-to-b from-gray-50/50 to-white px-6 py-5">
        {/* Finalise payment */}
        {reservation.awaitingPayment && !isCancelled && (
          <button
            onClick={handleResumePayment}
            disabled={loadingPayment}
            className="group/btn relative w-full overflow-hidden rounded-xl bg-[#2f3a2e] px-4 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#3d4e3b] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {loadingPayment ? (
                <>
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Redirection…
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                  </svg>
                  Finaliser le paiement
                </>
              )}
            </span>
          </button>
        )}

        {/* Modify / Cancel — only for actionable reservations */}
        {isActionable && (
          <>
            {blocked ? (
              /* 48-hour lock notice */
              <div className="flex items-start gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <p className="text-xs text-amber-800 leading-relaxed font-medium">
                  Les modifications et annulations ne sont plus disponibles
                  moins de {CANCELLATION_WINDOW_HOURS} heures avant le
                  rendez-vous.
                </p>
              </div>
            ) : (
              /* Modify + Cancel row */
              <div className="grid grid-cols-2 gap-3">
                {/* Modify — links to the reservation booking flow pre-filled */}
                <Link
                  href={`/reservation?modify=${reservation.id}`}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-700 transition-all hover:border-[#2f3a2e] hover:text-[#2f3a2e] hover:shadow-md"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Modifier
                </Link>

                {/* Cancel */}
                <button
                  onClick={handleCancel}
                  disabled={loadingCancel}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 transition-all hover:bg-red-100 hover:border-red-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingCancel ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Annulation…
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
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
          <div className="rounded-xl border-2 border-gray-200 bg-gray-100 px-4 py-3 text-center">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              Cette réservation a été annulée.
            </p>
          </div>
        )}
      </div>

      {/* Stripe notice only when payment button is shown */}
      {reservation.awaitingPayment && !isCancelled && (
        <div className="px-6 pb-4 pt-2">
          <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1.5 font-medium">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Paiement sécurisé par Stripe
          </p>
        </div>
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
    <div className="space-y-8">
      {/* Pending payments section */}
      {awaitingPayment.length > 0 && (
        <section>
          <div className="mb-6 flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-700">
              Paiement en attente
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {awaitingPayment.map((r) => (
              <ReservationCard key={r.id} reservation={r} />
            ))}
          </div>
        </section>
      )}

      {/* All other reservations */}
      {others.length > 0 && (
        <section>
          <h2 className="mb-6 text-sm font-bold uppercase tracking-wider text-gray-400">
            Mes rendez-vous
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((r) => (
              <ReservationCard key={r.id} reservation={r} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
