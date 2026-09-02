"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { FileDown } from "lucide-react";
import { resumeReservationPayment } from "@/actions/payment/resume-reservation-payment";
import { cancelReservation } from "@/actions/reservation/cancel-reservation";
import { submitCancellationExceptionRequest } from "@/actions/reservation/cancellation-exception-request";
import {
  isWithinCancellationWindow,
  requiresAdminApprovalToCancel,
  CANCELLATION_WINDOW_HOURS,
} from "@/lib/reservationRules";
import { toIntlLocale } from "@/lib/intl-locale";
import { AppointmentRescheduleModal } from "@/components/website/AppointmentRescheduleModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date, locale) {
  return new Date(date).toLocaleDateString(toIntlLocale(locale), {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatTime(date, locale) {
  return new Date(date).toLocaleTimeString(toIntlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function formatAmount(amount, locale) {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

// ─── Invoice link ──────────────────────────────────────────────────────────────

function InvoiceLink({ invoice }) {
  if (!invoice) return null;
  return (
    <a
      href={`/api/invoices/${invoice.id}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-[#C8A46A] transition-colors"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      Facture {invoice.number}
    </a>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const APPOINTMENT_STATUS_CONFIG = {
  PENDING: { labelKey: "pending", className: "bg-amber-100 text-amber-800" },
  ACCEPTED: { labelKey: "accepted", className: "bg-blue-100 text-blue-800" },
  CONFIRMED: { labelKey: "confirmed", className: "bg-emerald-100 text-emerald-800" },
  COMPLETED: { labelKey: "completed", className: "bg-gray-100 text-gray-600" },
  CANCELLED: { labelKey: "cancelled", className: "bg-red-100 text-red-700" },
  REJECTED: { labelKey: "rejected", className: "bg-red-100 text-red-700" },
  NO_SHOW: { labelKey: "noShow", className: "bg-orange-100 text-orange-700" },
};

const PAYMENT_STATUS_CONFIG = {
  PENDING: { labelKey: "paymentStatusPending", className: "bg-amber-100 text-amber-800" },
  PARTIALLY_PAID: { labelKey: "paymentStatusPartiallyPaid", className: "bg-blue-100 text-blue-800" },
  PAID: { labelKey: "paymentStatusPaid", className: "bg-emerald-100 text-emerald-800" },
  REFUNDED: { labelKey: "paymentStatusRefunded", className: "bg-purple-100 text-purple-800" },
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

// ─── Check-in ticket ──────────────────────────────────────────────────────────

/**
 * The customer's entry ticket, same visual pattern as the atelier/formation
 * one on /mon-compte (MonComptePageClient.jsx). getMyReservations already
 * nulls checkInCode/checkInQr for every status but CONFIRMED, so nothing
 * needs to be checked here beyond "is there one to show".
 *
 * An appointment is always one person — there is no seats/checkedInSeats
 * split to show, just checkedInAt as a single already-used flag.
 */
function CheckInTicket({ reservation }) {
  if (!reservation.checkInQr || !reservation.checkInCode) return null;

  const alreadyUsed = Boolean(reservation.checkedInAt);
  const remainingDue = Number(reservation.payment?.remainingAmount ?? 0);

  return (
    <div className="mt-3 flex flex-col items-center gap-3 rounded-2xl border border-[#C8A46A]/20 bg-[#C8A46A]/5 px-4 py-5 text-center sm:flex-row sm:text-left">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={reservation.checkInQr}
        alt="QR code d'entrée du rendez-vous"
        width={160}
        height={160}
        className={`h-40 w-40 shrink-0 rounded-lg bg-white p-1 ${alreadyUsed ? "opacity-40" : ""}`}
      />
      <div>
        <p className="text-sm font-bold text-[#2F3A2E]">
          {alreadyUsed ? "Billet déjà utilisé" : "Votre QR code d'entrée"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          {alreadyUsed
            ? "Ce rendez-vous a déjà été pointé à l'accueil."
            : "Présentez ce QR code à l'accueil. Il est vérifié auprès du salon, une capture d'écran ne le remplace pas."}
        </p>
        {!alreadyUsed && remainingDue > 0 && (
          <p className="mt-1 text-xs font-semibold text-amber-700">
            Solde de {remainingDue.toFixed(2)} € à régler sur place.
          </p>
        )}
        <p className="mt-2 font-mono text-lg font-bold tracking-widest text-[#2F3A2E]">
          {reservation.checkInCode}
        </p>
      </div>
    </div>
  );
}

// ─── Single reservation card ──────────────────────────────────────────────────

function ReservationCard({ reservation, onCancelled }) {
  const t = useTranslations("myReservations");
  const tApptStatus = useTranslations("appointmentStatus");
  const locale = useLocale();
  const router = useRouter();
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [loadingCancel, setLoadingCancel] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const [requestSent, setRequestSent] = useState(false);
  // Track local cancelled state so the card updates instantly without a full reload
  const [isCancelled, setIsCancelled] = useState(
    reservation.status === "CANCELLED",
  );
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);


  const invoice = reservation.payment?.invoice ?? null;

  async function handleExceptionRequest() {
    setSubmittingRequest(true);
    const result = await submitCancellationExceptionRequest({
      appointmentId: reservation.id,
      reason: requestReason,
    });
    if (result.success) {
      setRequestSent(true);
      setRequestOpen(false);
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message ?? t("exceptionRequestFailed"));
    }
    setSubmittingRequest(false);
  }

  const effectiveStatus = isCancelled ? "CANCELLED" : reservation.status;
  const apptStatusConfig =
    APPOINTMENT_STATUS_CONFIG[effectiveStatus] ?? {
      labelKey: "",
      className: "bg-gray-100 text-gray-600",
    };
  const apptStatusLabel = apptStatusConfig.labelKey
    ? tApptStatus(apptStatusConfig.labelKey)
    : effectiveStatus;
  const paymentStatusConfig = reservation.payment
    ? (PAYMENT_STATUS_CONFIG[reservation.payment.status] ?? {
        labelKey: "",
        className: "bg-gray-100 text-gray-600",
      })
    : null;
  const paymentStatusLabel = paymentStatusConfig?.labelKey
    ? t(paymentStatusConfig.labelKey)
    : reservation.payment?.status;

  // ── 48-hour window check ─────────────────────────────────────────────────
  const blocked = isWithinCancellationWindow(reservation.startTime);
  const cancellationRequest = reservation.cancellationRequest ?? null;
  const hasPendingRequest = requestSent || cancellationRequest?.status === "PENDING";
  const hasRejectedRequest = cancellationRequest?.status === "REJECTED";

  // Actions are available for every active appointment state.
  const isActionable =
    !isCancelled &&
    effectiveStatus !== "COMPLETED" &&
    effectiveStatus !== "REJECTED" &&
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
            t("sessionFailedToast"),
        );
        return;
      }
      window.location.href = result.url;
    } catch {
      toast.error(t("genericErrorToast"));
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
        toast.success(result.message ?? t("cancelledToast"));
        onCancelled?.();
      } else {
        toast.error(result.message ?? t("cancelFailedToast"));
      }
    } catch {
      toast.error(t("genericErrorToast"));
    } finally {
      setLoadingCancel(false);
    }
  }

  // ── Exception request ───────────────────────────────────────────────────────
  async function handleExceptionRequest() {
    setSubmittingRequest(true);
    try {
      const result = await submitCancellationExceptionRequest({
        appointmentId: reservation.id,
        reason: requestReason,
      });
      if (result.success) {
        setRequestSent(true);
        setRequestOpen(false);
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message ?? t("genericErrorToast"));
      }
    } catch {
      toast.error(t("genericErrorToast"));
    } finally {
      setSubmittingRequest(false);
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl sm:rounded-3xl border border-gray-200 bg-white shadow-sm transition-all hover:shadow-xl hover:border-[#2f3a2e]/30 hover:-translate-y-1">
      {/* Gradient accent line at top */}
      <div className="h-1 sm:h-1.5 w-full bg-gradient-to-r from-[#2f3a2e] via-[#4a5a48] to-[#C8A46A]" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="relative p-4 sm:p-6 pb-2 sm:pb-4">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base sm:text-lg font-bold text-[#2F3A2E] leading-tight">
              {reservation.service.name}
            </h3>
            <div className="mt-1.5 sm:mt-2 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600">
              <div className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#2f3a2e] to-[#4a5a48] shrink-0">
                <svg className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <span className="font-medium line-clamp-1">{t("withExpert", { name: reservation.staff.fullName })}</span>
            </div>
          </div>
          <StatusBadge label={apptStatusLabel} className={apptStatusConfig.className} />
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
                <span>{t("date")}</span>
              </div>
              <p className="text-sm font-bold text-gray-800 capitalize leading-tight">
                {formatDate(reservation.date, locale)}
              </p>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#C8A46A]/10 to-[#C8A46A]/5 p-4 border border-[#C8A46A]/20">
            <div className="relative z-10">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <svg className="h-3.5 w-3.5 text-[#C8A46A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{t("time")}</span>
              </div>
              <p className="text-sm font-bold text-gray-800 leading-tight">
                {formatTime(reservation.startTime, locale)}
              </p>
              <p className="text-xs text-gray-600 mt-0.5">{t("durationMinutes", { duration: reservation.duration })}</p>
            </div>
          </div>
        </div>

        {/* Payment summary with modern design */}
        {reservation.payment && (
          <div className="relative overflow-hidden rounded-lg sm:rounded-2xl bg-gradient-to-br from-gray-50 to-white p-3 sm:p-5 border border-gray-200">
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="text-[9px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider">{t("payment")}</span>
              <StatusBadge label={paymentStatusLabel} className={paymentStatusConfig.className} />
            </div>
            <div className="space-y-1 sm:space-y-2">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-600">{t("total")}</span>
                <span className="font-bold text-[#2F3A2E]">
                  {formatAmount(reservation.payment.totalAmount, locale)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-gray-600">{t("paid")}</span>
                <span className="font-bold text-emerald-600">
                  {formatAmount(reservation.payment.paidAmount, locale)}
                </span>
              </div>
              {reservation.payment.remainingAmount > 0 && (
                <div className="flex items-center justify-between text-xs sm:text-sm pt-1.5 sm:pt-2 border-t-2 border-gray-200">
                  <span className="text-gray-700 font-semibold">{t("remainingToPay")}</span>
                  <span className="font-bold text-amber-600 text-sm sm:text-base">
                    {formatAmount(reservation.payment.remainingAmount, locale)}
                  </span>
                </div>
              )}
            </div>
            {reservation.payment.invoice && (
              <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-200">
                <InvoiceLink invoice={reservation.payment.invoice} />
              </div>
            )}
          </div>
        )}

        <CheckInTicket reservation={reservation} />

        {/* Review display */}
        {reservation.review && (
          <div className="rounded-2xl bg-gradient-to-br from-[#C8A46A]/10 to-[#C8A46A]/5 p-4 border border-[#C8A46A]/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t("yourReview")}</span>
              <div className="flex text-[#C8A46A]">
                {"★".repeat(reservation.review.rating)}
                <span className="text-gray-300">{"★".repeat(5 - reservation.review.rating)}</span>
              </div>
            </div>
            {reservation.review.comment && (
              <p className="text-sm text-gray-700 italic">"{reservation.review.comment}"</p>
            )}
          </div>
        )}
      </div>

      {/* ── Footer actions ──────────────────────────────────────────────── */}
      <div className="space-y-2 sm:space-y-3 border-t border-gray-100 bg-gradient-to-b from-gray-50/50 to-white px-4 sm:px-6 py-3 sm:py-5">
        {/* A manually-confirmed request sits at PENDING until staff decide
            and no payment was taken up front — genuine "nothing to act on
            yet" case. Never suppress the "Finaliser le paiement" button by
            firing whenever an unsettled payment (awaitingPayment) still
            needs it. */}
        {effectiveStatus === "PENDING" && !reservation.awaitingPayment && !isCancelled && (
          <div className="flex items-start gap-2 rounded-lg sm:rounded-xl border border-gray-200 bg-gray-50 px-3 sm:px-4 py-2 sm:py-3 text-[11px] sm:text-xs text-gray-600">
            <svg className="mt-0.5 h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 text-[#C8A46A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="leading-relaxed">
              {reservation.payment ? t("pendingApprovalNoticeWithPayment") : t("pendingApprovalNoticeNoPayment")}
            </p>
          </div>
        )}

        {reservation.awaitingPaymentChoice && !isCancelled && (
          <Link
            href={`/appointment/${reservation.id}/payment`}
            className="flex w-full items-center justify-center rounded-lg sm:rounded-xl bg-[#2f3a2e] px-3 sm:px-4 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold text-white shadow-lg transition-all hover:bg-[#3d4e3b] hover:shadow-xl"
          >
            {t("choosePayment")}
          </Link>
        )}

        {/* Finalise payment */}
        {reservation.awaitingPayment && !isCancelled && (
          <button
            onClick={handleResumePayment}
            disabled={loadingPayment}
            className="group/btn relative w-full overflow-hidden rounded-lg sm:rounded-xl bg-[#2f3a2e] px-3 sm:px-4 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold text-white shadow-lg transition-all hover:bg-[#3d4e3b] hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
                  {loadingPayment ? (
                    <>
                      <svg className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {t("redirecting")}
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                      </svg>
                      {t("finalizePayment")}
                    </>
                  )}
                </span>
          </button>
        )}

        {/* Modify / Cancel — only for actionable reservations */}
        {isActionable && (
          <>
            {blocked ? (
              /* 48-hour lock notice with exception request */
              <div className="space-y-2 sm:space-y-3">
                <div className="flex items-start gap-2 sm:gap-3 rounded-lg sm:rounded-xl border-2 border-amber-200 bg-amber-50 px-3 sm:px-4 py-2 sm:py-3">
                  <svg className="mt-0.5 h-4 w-4 sm:h-5 sm:w-5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-[11px] sm:text-xs text-amber-800 leading-relaxed font-medium">
                    {t("cancellationLocked", { hours: CANCELLATION_WINDOW_HOURS })}
                  </p>
                </div>
                {hasPendingRequest ? (
                  <div className="rounded-lg sm:rounded-xl bg-amber-50 border border-amber-200 px-3 sm:px-4 py-2 sm:py-3">
                    <p className="text-[11px] sm:text-xs text-amber-800 font-medium">
                      Votre demande est en attente d'une décision de l'équipe. Aucun remboursement n'est engagé avant son accord.
                    </p>
                  </div>
                ) : hasRejectedRequest && !requestOpen ? (
                  <div className="rounded-lg sm:rounded-xl bg-red-50 border border-red-200 px-3 sm:px-4 py-2 sm:py-3">
                    <p className="text-[11px] sm:text-xs text-red-700 font-medium">
                      Votre demande exceptionnelle a été refusée. Le rendez-vous et l'acompte restent inchangés.
                      {cancellationRequest.decisionNote ? ` Message de l'équipe : ${cancellationRequest.decisionNote}` : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setRequestReason("");
                        setRequestOpen(true);
                      }}
                      className="mt-2 text-[11px] sm:text-xs font-semibold text-[#2f3a2e] hover:underline"
                    >
                      Envoyer une nouvelle demande
                    </button>
                  </div>
                ) : requestOpen ? (
                  <div className="space-y-1.5 sm:space-y-2 rounded-lg sm:rounded-xl border border-amber-200 bg-amber-50/70 p-2.5 sm:p-3">
                    <p className="text-[11px] sm:text-xs text-amber-900">
                      Après avoir contacté le salon, expliquez votre situation. Cette demande n'annule pas le rendez-vous et ne garantit pas un remboursement.
                    </p>
                    <textarea
                      value={requestReason}
                      onChange={(event) => setRequestReason(event.target.value)}
                      rows={2}
                      placeholder="Ex. maladie soudaine, avec toute information utile pour l'équipe"
                      className="w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none focus:border-amber-500"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRequestOpen(false)}
                        disabled={submittingRequest}
                        className="text-[11px] sm:text-xs font-semibold text-gray-600 hover:text-gray-800"
                      >
                        Retour
                      </button>
                      <button
                        type="button"
                        onClick={handleExceptionRequest}
                        disabled={submittingRequest || requestReason.trim().length < 10}
                        className="inline-flex items-center gap-1 rounded-full bg-[#2f3a2e] px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs font-semibold text-white disabled:opacity-60 hover:bg-[#3d4e3b]"
                      >
                        {submittingRequest && (
                          <svg className="h-2.5 w-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                        )}
                        Envoyer la demande
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRequestOpen(true)}
                    className="w-full text-center text-xs sm:text-sm font-semibold text-[#2f3a2e] hover:underline"
                  >
                    Demander un examen exceptionnel
                  </button>
                )}
              </div>
            ) : (
              /* Modify + Cancel row */
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {/* Modify — opens reschedule modal */}
                <button
                  onClick={() => setModalOpen(true)}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl border-2 border-gray-200 bg-white px-2.5 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-bold text-gray-700 transition-all hover:border-[#2f3a2e] hover:text-[#2f3a2e] hover:shadow-md"
                >
                  <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  {t("modify")}
                </button>

                {/* Cancel */}
                <button
                  onClick={handleCancel}
                  disabled={loadingCancel}
                  className="flex items-center justify-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-xl border-2 border-red-200 bg-red-50 px-2.5 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-bold text-red-600 transition-all hover:bg-red-100 hover:border-red-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingCancel ? (
                    <>
                      <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {t("cancelling")}
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      {t("cancel")}
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
              {t("cancelledNotice")}
            </p>
          </div>
        )}

        {/* Request refused notice */}
        {effectiveStatus === "REJECTED" && !isCancelled && (
          <div className="rounded-xl border-2 border-red-100 bg-red-50 px-4 py-3 text-center">
            <p className="text-xs font-bold text-red-600 uppercase tracking-wide">
              {t("rejectedNotice")}
            </p>
          </div>
        )}

        {/* The customer's own review of this appointment, once left */}
        {reservation.review && (
          <div className="border-t border-gray-100 pt-3 text-sm text-gray-600">
            <span className="tracking-tight text-[#b89664]">
              {"★".repeat(reservation.review.rating)}
              <span className="text-gray-200">{"★".repeat(5 - reservation.review.rating)}</span>
            </span>
            {reservation.review.comment && (
              <span className="ml-2 text-gray-500">{reservation.review.comment}</span>
            )}
          </div>
        )}

        {/* Invoice PDF, once one has been issued */}
        {invoice && (
          <div className="border-t border-gray-100 pt-3">
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-[#b89664]"
            >
              <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              {t("invoice", { number: invoice.number })}
            </a>
          </div>
        )}
      </div>

      {rescheduleOpen && (
        <AppointmentRescheduleModal
          // The modal was written against the /appointments shape, which
          // flattens these two; map rather than reshape the loader, so the
          // rest of this page keeps its nested service/staff objects.
          appointment={{
            ...reservation,
            serviceName: reservation.service?.name,
            staffName: reservation.staff?.fullName,
          }}
          onClose={() => setRescheduleOpen(false)}
          onRescheduled={() => {
            setRescheduleOpen(false);
            toast.success(t("rescheduledToast"));
            router.refresh();
          }}
        />
      )}

      {/* Stripe notice only when payment button is shown */}
      {reservation.awaitingPayment && !isCancelled && (
        <div className="px-6 pb-4 pt-2">
          <p className="text-center text-xs text-gray-400 flex items-center justify-center gap-1.5 font-medium">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {t("secureStripe")}
          </p>
        </div>
      )}

      {/* Reschedule modal */}
      {modalOpen && (
        <AppointmentRescheduleModal
          appointment={reservation}
          onClose={() => setModalOpen(false)}
          onRescheduled={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  const t = useTranslations("myReservations");
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
      <h3 className="text-lg font-semibold text-[#2F3A2E]">{t("emptyTitle")}</h3>
      <p className="mt-2 max-w-xs text-sm text-gray-500">
        {t("emptyDescription")}
      </p>
      <Link
        href="/reservation"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2F3A2E] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b]"
      >
        {t("bookNow")}
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
  const t = useTranslations("myReservations");
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
              {t("pendingPayment")}
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
            {t("myAppointments")}
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
