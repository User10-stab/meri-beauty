"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Clock, User, FileDown, Sparkles, History, Pencil, XCircle, Loader2, AlertTriangle, CreditCard } from "lucide-react";
import { formatDistanceToNowStrict, isFuture } from "date-fns";
import { fr } from "date-fns/locale";
import Link from "next/link";
import { cancelReservation } from "@/actions/reservation/cancel-reservation";
import { resumeReservationPayment } from "@/actions/payment/resume-reservation-payment";
import { submitCancellationExceptionRequest } from "@/actions/reservation/cancellation-exception-request";
import { isWithinCancellationWindow, CANCELLATION_WINDOW_HOURS } from "@/lib/reservationRules";
import { AppointmentRescheduleModal } from "@/components/website/AppointmentRescheduleModal";

const STATUS_LABELS = {
  PENDING: "En attente de confirmation",
  ACCEPTED: "Accepté — paiement à finaliser",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absence",
};

const STATUS_STYLE = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-100",
  ACCEPTED: "bg-blue-50 text-blue-700 border-blue-100",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  NO_SHOW: "bg-red-50 text-red-600 border-red-100",
};

const UPCOMING_STATUSES = new Set(["PENDING", "ACCEPTED", "CONFIRMED"]);

function formatWeekday(date) {
  return new Date(date).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Brussels" });
}

function formatDay(date) {
  return new Date(date).toLocaleDateString("fr-FR", { day: "2-digit", timeZone: "Europe/Brussels" });
}

function formatMonth(date) {
  return new Date(date).toLocaleDateString("fr-FR", { month: "short", timeZone: "Europe/Brussels" }).replace(".", "");
}

function formatFullDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function InvoiceLink({ invoice }) {
  if (!invoice) return null;
  return (
    <a
      href={`/api/invoices/${invoice.id}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/60 transition-colors hover:text-gold"
    >
      <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      Facture {invoice.number}
    </a>
  );
}

function DateBlock({ date, accent }) {
  return (
    <div
      className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-xl border py-2.5 ${
        accent ? "border-gold/25 bg-gold/10" : "border-ink/8 bg-cream"
      }`}
    >
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${accent ? "text-gold" : "text-ink/40"}`}>
        {formatMonth(date)}
      </span>
      <span className={`text-xl font-bold leading-tight ${accent ? "text-primary" : "text-ink"}`}>
        {formatDay(date)}
      </span>
    </div>
  );
}

/**
 * The outstanding-payment step for a booking.
 *
 * Deliberately separate from AppointmentActions and rendered outside its
 * cancellation-window branch: being inside the 48h lock stops you changing
 * or cancelling the appointment, but it must never stop you *paying* for
 * one. Before this existed the only route back to Stripe was the original
 * e-mail.
 */
function PaymentFollowUp({ appointment }) {
  const [redirecting, setRedirecting] = useState(false);

  if (!appointment.awaitingPayment && !appointment.awaitingPaymentChoice) return null;

  // Staff accepted the request but no Payment row exists yet — the customer
  // still has to choose how to pay, which is its own page.
  if (appointment.awaitingPaymentChoice) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5">
        <p className="text-[12px] text-blue-900">
          Votre rendez-vous est accepté. Choisissez votre mode de paiement pour le confirmer.
        </p>
        <Link
          href={`/appointment/${appointment.id}/payment`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
        >
          <CreditCard className="h-3.5 w-3.5" strokeWidth={1.75} />
          Choisir mon paiement
        </Link>
      </div>
    );
  }

  async function handleResume() {
    setRedirecting(true);
    const result = await resumeReservationPayment(appointment.payment.id);
    if (result.success && result.url) {
      window.location.href = result.url;
      return;
    }
    toast.error(result.message ?? "Paiement indisponible pour le moment.");
    setRedirecting(false);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <p className="text-[12px] text-amber-900">
        Le paiement de ce rendez-vous n&apos;a pas été finalisé.
      </p>
      <button
        type="button"
        onClick={handleResume}
        disabled={redirecting}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
      >
        {redirecting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CreditCard className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        Finaliser le paiement
      </button>
    </div>
  );
}

function AppointmentActions({ appointment }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const locked = isWithinCancellationWindow(appointment.startTime);
  const cancellationRequest = appointment.cancellationRequest ?? null;
  const hasPendingRequest = requestSent || cancellationRequest?.status === "PENDING";
  const hasRejectedRequest = cancellationRequest?.status === "REJECTED";

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelReservation(appointment.id);
    if (result.success) {
      toast.success(result.message ?? "Rendez-vous annulé.");
      router.refresh();
    } else {
      toast.error(result.message ?? "Impossible d'annuler ce rendez-vous.");
      setCancelling(false);
      setConfirming(false);
    }
  }

  async function handleExceptionRequest() {
    setSubmittingRequest(true);
    const result = await submitCancellationExceptionRequest({ appointmentId: appointment.id, reason: requestReason });
    if (result.success) {
      setRequestSent(true);
      setRequestOpen(false);
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message ?? "Impossible d'envoyer votre demande.");
    }
    setSubmittingRequest(false);
  }

  if (locked) {
    return (
      <div className="mt-3 border-t border-ink/8 pt-3 text-[12px] text-ink/45">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.75} />
          <p>Modification et annulation indisponibles à moins de {CANCELLATION_WINDOW_HOURS}h du rendez-vous. L&apos;acompte reste acquis sauf annulation exceptionnelle approuvée par l&apos;administration.</p>
        </div>
        {hasPendingRequest ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">Votre demande est en attente d&apos;une décision de l&apos;équipe. Aucun remboursement n&apos;est engagé avant son accord.</p>
        ) : hasRejectedRequest ? (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">
            Votre demande exceptionnelle a Ã©tÃ© refusÃ©e. Le rendez-vous et l&apos;acompte restent inchangÃ©s.
            {cancellationRequest.decisionNote ? ` Message de l'équipe : ${cancellationRequest.decisionNote}` : ""}
          </p>
        ) : requestOpen ? (
          <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <p className="text-amber-900">Après avoir contacté le salon, expliquez votre situation. Cette demande n&apos;annule pas le rendez-vous et ne garantit pas un remboursement.</p>
            <textarea value={requestReason} onChange={(event) => setRequestReason(event.target.value)} maxLength={1000} rows={3} placeholder="Ex. maladie soudaine, avec toute information utile pour l'équipe" className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-amber-500" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRequestOpen(false)} disabled={submittingRequest} className="text-xs font-semibold text-ink/55 hover:text-ink">Retour</button>
              <button type="button" onClick={handleExceptionRequest} disabled={submittingRequest || requestReason.trim().length < 10} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                {submittingRequest && <Loader2 className="h-3 w-3 animate-spin" />}
                Envoyer la demande
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setRequestOpen(true)} className="mt-2 text-xs font-semibold text-primary hover:underline">Demander un examen exceptionnel</button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-ink/8 pt-3">
        {confirming ? (
          <>
            <span className="mr-auto text-xs text-ink/50">Confirmer l&apos;annulation ?</span>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={cancelling}
              className="text-xs font-semibold text-ink/50 hover:text-ink"
            >
              Non
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {cancelling && <Loader2 className="h-3 w-3 animate-spin" />}
              Oui, annuler
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1.5 text-xs font-semibold text-ink/60 transition-colors hover:border-gold/40 hover:text-ink"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
              Modifier
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
            >
              <XCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
              Annuler
            </button>
          </>
        )}
      </div>

      {modalOpen && (
        <AppointmentRescheduleModal
          appointment={appointment}
          onClose={() => setModalOpen(false)}
          onRescheduled={() => {
            setModalOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function NextAppointmentCard({ appointment }) {
  const invoice = appointment.payment?.invoice;
  const relative = formatDistanceToNowStrict(new Date(appointment.startTime), { addSuffix: true, locale: fr });

  return (
    <div className="relative overflow-hidden rounded-2xl border border-gold/30 bg-white shadow-[0_8px_24px_-12px_rgba(184,150,100,0.35)]">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-gold" />
      <div className="p-5 pl-6 sm:p-6 sm:pl-7">
        <div className="mb-4 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          Prochain rendez-vous · {relative}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <DateBlock date={appointment.startTime} accent />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold text-ink capitalize">{formatWeekday(appointment.startTime)}</p>
                <p className="text-sm font-semibold text-primary">{appointment.serviceName}</p>
              </div>
              <StatusBadge status={appointment.status} />
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink/55">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
                {formatTime(appointment.startTime)} – {formatTime(appointment.endTime)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
                {appointment.staffName}
              </span>
            </div>

            {appointment.notes && (
              <p className="mt-3 rounded-lg bg-cream px-3 py-2 text-[13px] text-ink/60">{appointment.notes}</p>
            )}

            {invoice && (
              <div className="mt-3">
                <InvoiceLink invoice={invoice} />
              </div>
            )}
          </div>
        </div>

        <PaymentFollowUp appointment={appointment} />
        <AppointmentActions appointment={appointment} />
      </div>
    </div>
  );
}

function AppointmentCard({ appointment, showActions = false }) {
  const invoice = appointment.payment?.invoice;

  return (
    <div className="group flex gap-4 rounded-xl border border-ink/8 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <DateBlock date={appointment.startTime} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-ink">{appointment.serviceName}</p>
            <p className="mt-0.5 text-xs capitalize text-ink/45">{formatFullDate(appointment.startTime)}</p>
          </div>
          <StatusBadge status={appointment.status} />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/45">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            {formatTime(appointment.startTime)} – {formatTime(appointment.endTime)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" strokeWidth={1.75} />
            {appointment.staffName}
          </span>
        </div>

        {appointment.notes && (
          <p className="mt-3 border-t border-ink/8 pt-3 text-[13px] text-ink/60">{appointment.notes}</p>
        )}

        {appointment.review && (
          <div className="mt-3 border-t border-ink/8 pt-3 text-[13px] text-ink/60">
            <span className="tracking-tight text-gold">
              {"★".repeat(appointment.review.rating)}
              <span className="text-ink/20">{"★".repeat(5 - appointment.review.rating)}</span>
            </span>
            {appointment.review.comment && <span className="ml-2 text-ink/50">{appointment.review.comment}</span>}
          </div>
        )}

        {invoice && (
          <div className="mt-3 border-t border-ink/8 pt-3">
            <InvoiceLink invoice={invoice} />
          </div>
        )}

        {/* Not gated on showActions: an unpaid booking needs its payment
            link wherever it is listed, not only in the upcoming section. */}
        <PaymentFollowUp appointment={appointment} />
        {showActions && <AppointmentActions appointment={appointment} />}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink/15 bg-white/50 py-16 text-center">
      <Icon className="h-8 w-8 text-ink/25" strokeWidth={1.5} />
      <p className="text-sm text-ink/45">{text}</p>
    </div>
  );
}

const TABS = [
  { key: "upcoming", label: "À venir", icon: Sparkles },
  { key: "history", label: "Historique", icon: History },
];

export function MyAppointmentsPageClient({ appointments }) {
  const [activeTab, setActiveTab] = useState("upcoming");

  const { next, upcoming, history } = useMemo(() => {
    const sorted = [...appointments].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const isUpcoming = (a) => UPCOMING_STATUSES.has(a.status) && isFuture(new Date(a.startTime));

    const upcomingList = sorted.filter(isUpcoming);
    const historyList = appointments
      .filter((a) => !isUpcoming(a))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    return {
      next: upcomingList[0] ?? null,
      upcoming: upcomingList.slice(1),
      history: historyList,
    };
  }, [appointments]);

  const counts = { upcoming: upcoming.length + (next ? 1 : 0), history: history.length };

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[1000px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon compte</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Mes rendez-vous
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1000px] px-6 py-12 md:px-10">
          {appointments.length === 0 ? (
            <EmptyState icon={CalendarDays} text="Vous n'avez pas encore pris de rendez-vous." />
          ) : (
            <>
              <div className="mb-8 flex flex-wrap gap-2">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const selected = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                        selected
                          ? "border-gold bg-gold text-white shadow-sm"
                          : "border-ink/10 bg-white text-ink/60 hover:border-gold/40"
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                      {tab.label}
                      <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20" : "bg-ink/5"}`}>
                        {counts[tab.key]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeTab === "upcoming" && (
                upcoming.length === 0 && !next ? (
                  <EmptyState icon={Sparkles} text="Aucun rendez-vous à venir pour le moment." />
                ) : (
                  <div className="space-y-4">
                    {next && <NextAppointmentCard appointment={next} />}
                    {upcoming.map((a) => (
                      <AppointmentCard key={a.id} appointment={a} showActions />
                    ))}
                  </div>
                )
              )}

              {activeTab === "history" && (
                history.length === 0 ? (
                  <EmptyState icon={History} text="Aucun rendez-vous passé pour l'instant." />
                ) : (
                  <div className="space-y-4">
                    {history.map((a) => (
                      <AppointmentCard key={a.id} appointment={a} />
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
