"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getPaymentStatusBySession } from "@/actions/payment/get-payment-status-by-session";

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_500;
const POLL_TIMEOUT_MS  = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day:     "2-digit",
    month:   "long",
    year:    "numeric",
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("fr-FR", {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount) {
  return new Intl.NumberFormat("fr-FR", {
    style:    "currency",
    currency: "EUR",
  }).format(amount);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-[#2F3A2E] text-right">{value}</span>
    </div>
  );
}

function AmountRow({ label, value, highlight }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span
        className={`text-sm font-semibold ${
          highlight === "green"  ? "text-emerald-600" :
          highlight === "amber"  ? "text-amber-600"   :
          "text-[#2F3A2E]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Spinner shown while waiting for the webhook. */
function Polling() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      {/* Animated ring */}
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-[#C8A46A]/20" />
        <div className="absolute inset-0 rounded-full border-4 border-t-[#C8A46A] animate-spin" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">
          Confirmation en cours…
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Nous attendons la confirmation de votre paiement. Merci de patienter.
        </p>
      </div>
    </div>
  );
}

/** Shown when polling times out without a confirmed payment. */
function PollingTimeout({ sessionId }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
        <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">
          Paiement en cours de traitement
        </h2>
        <p className="mt-2 text-sm text-gray-500 max-w-sm">
          Votre paiement a bien été reçu mais la confirmation prend un peu plus de temps que prévu.
          Vous recevrez un email de confirmation dès que le traitement sera finalisé.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors"
      >
        Retour à l'accueil
      </Link>
    </div>
  );
}

/** Shown when session_id is missing or payment is not found at all. */
function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
        <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#2F3A2E]">Réservation introuvable</h2>
        <p className="mt-2 text-sm text-gray-500 max-w-sm">
          Nous n'avons pas pu retrouver votre réservation. Si vous avez été débité,
          contactez-nous en indiquant votre email de réservation.
        </p>
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        <Link
          href="/reservation"
          className="inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors"
        >
          Nouvelle réservation
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-semibold text-[#2F3A2E] hover:bg-gray-50 transition-colors"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}

/** The main success card rendered once we have confirmed payment data. */
function SuccessCard({ data }) {
  const { payment, appointment, customer, staff, service, staffService, transactions } = data;

  const isManual    = staff.reservationConfirmationMode === "MANUAL";
  const isConfirmed = appointment.status === "CONFIRMED";
  const isFullPaid  = payment.remainingAmount === 0;

  // Time formatted from the startTime stored in the DB
  const appointmentTime = formatTime(appointment.startTime);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-12">

      {/* ── Status banner ── */}
      {isConfirmed ? (
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#2F3A2E]">Réservation confirmée</h1>
          <p className="text-sm text-gray-500">
            Votre paiement a été reçu et votre rendez-vous est confirmé.
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#2F3A2E]">Paiement reçu</h1>
          <p className="text-sm text-gray-500 max-w-sm">
            Votre paiement a bien été reçu. Votre réservation est en attente de
            confirmation par notre équipe.
          </p>
        </div>
      )}

      {/* ── Manual confirmation notice ── */}
      {isManual && !isConfirmed && (
        <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 px-5 py-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            En attente d'approbation
          </p>
          <p className="text-sm text-amber-700 leading-relaxed">
            Notre équipe va examiner votre demande et vous enverra un email de
            confirmation dès que votre rendez-vous sera approuvé.
          </p>
        </div>
      )}

      {/* ── Appointment details ── */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C8A46A]">
            Détails du rendez-vous
          </p>
        </div>
        <div className="px-5 py-1">
          <InfoRow label="Service"  value={service.name} />
          <InfoRow label="Experte"  value={staff.user.fullName} />
          <InfoRow label="Date"     value={formatDate(appointment.date)} />
          <InfoRow label="Heure"    value={appointmentTime} />
          <InfoRow label="Client"   value={customer.fullName} />
        </div>
      </div>

      {/* ── Payment summary ── */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#C8A46A]">
            Résumé du paiement
          </p>
        </div>
        <div className="px-5 py-1">
          <AmountRow
            label="Montant total"
            value={formatAmount(payment.totalAmount)}
          />
          <AmountRow
            label="Montant payé"
            value={formatAmount(payment.paidAmount)}
            highlight="green"
          />
          {payment.remainingAmount > 0 && (
            <AmountRow
              label="Reste à payer en salon"
              value={formatAmount(payment.remainingAmount)}
              highlight="amber"
            />
          )}
          {isFullPaid && (
            <AmountRow
              label="Statut"
              value="Payé intégralement"
              highlight="green"
            />
          )}
        </div>
      </div>

      {/* ── Transactions (Stripe references) ── */}
      {transactions.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#C8A46A]">
              Transactions
            </p>
          </div>
          <div className="px-5 py-3 space-y-3">
            {transactions.map((t) => (
              <div key={t.id} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">
                    {t.transactionType === "DEPOSIT"       ? "Acompte"          :
                     t.transactionType === "FINAL_PAYMENT" ? "Paiement complet"  :
                     "Remboursement"}
                  </span>
                  <span className="font-semibold text-[#2F3A2E]">
                    {formatAmount(t.amount)}
                  </span>
                </div>
                
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Remaining balance notice ── */}
      {payment.remainingAmount > 0 && (
        <div className="mb-6 rounded-xl bg-[#fdf8f0] border border-[#C8A46A]/30 px-5 py-4">
          <p className="text-sm font-semibold text-[#a07840] mb-1">
            Solde restant : {formatAmount(payment.remainingAmount)}
          </p>
          <p className="text-sm text-[#a07840] leading-relaxed">
            Le solde sera à régler directement au salon lors de votre visite.
          </p>
        </div>
      )}

      {/* ── Actions ── */}
      <div className="flex gap-3 flex-wrap">
        <Link
          href="/reservation"
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#3d4e3b] transition-colors"
        >
          Nouveau rendez-vous
        </Link>
        <Link
          href="/"
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-5 py-3 text-sm font-semibold text-[#2F3A2E] hover:bg-gray-50 transition-colors"
        >
          Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Client component for the /reservation/success page.
 *
 * Receives the initial payment status from the server component.
 * If payment is still PENDING (webhook hasn't fired yet), polls the server
 * action every 2.5 s for up to 30 s, then falls back to a polite timeout
 * message rather than showing an error.
 *
 * Never writes to the database — all mutations happen in the webhook.
 *
 * @param {{
 *   sessionId: string,
 *   initialData: import("@/lib/payment-status").PaymentStatusResult | null,
 * }} props
 */
export default function ReservationSuccessClient({ sessionId, initialData }) {
  const isPaidInitially =
    initialData?.payment?.status === "PAID" ||
    initialData?.payment?.status === "PARTIALLY_PAID";

  const [data,       setData]       = useState(initialData);
  const [polling,    setPolling]    = useState(!isPaidInitially && Boolean(initialData));
  const [timedOut,   setTimedOut]   = useState(false);

  const intervalRef  = useRef(null);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    // Nothing to poll — either already paid or not found at all
    if (!polling) return;

    intervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTimeRef.current;

      if (elapsed >= POLL_TIMEOUT_MS) {
        clearInterval(intervalRef.current);
        setPolling(false);
        setTimedOut(true);
        return;
      }

      const result = await getPaymentStatusBySession(sessionId);

      if (!result.found || !result.data) return; // keep polling

      const status = result.data.payment?.status;
      if (status === "PAID" || status === "PARTIALLY_PAID") {
        clearInterval(intervalRef.current);
        setData(result.data);
        setPolling(false);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalRef.current);
  }, [polling, sessionId]);

  // ── Render states ──────────────────────────────────────────────────────────

  // 1. No session ID or payment record not found at all
  if (!initialData && !polling) {
    return <NotFound />;
  }

  // 2. Waiting for webhook
  if (polling) {
    return <Polling />;
  }

  // 3. Webhook took too long
  if (timedOut) {
    return <PollingTimeout sessionId={sessionId} />;
  }

  // 4. We have confirmed data
  if (data) {
    return <SuccessCard data={data} />;
  }

  return <NotFound />;
}
