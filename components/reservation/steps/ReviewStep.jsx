"use client";

import { Calendar, Clock, User, Mail, Phone, Tag, Euro, FileText, Check, Pencil, Sparkles } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { createReservation } from "@/actions/reservation/create-reservation";
import { computePaymentDecision } from "@/lib/reservation-payment";
import { formatLocalDateKey } from "@/lib/slot-availability";
import { toast } from "sonner";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/lib/intl-locale";

function SectionCard({ title, onEdit, children }) {
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#ede5d8]/70 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-[#2F3A2E] px-5 py-3.5">
        <h3 className="text-sm font-semibold tracking-wide text-white">{title}</h3>
        {onEdit && (
          <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white hover:bg-white/25 transition-colors">
            <Pencil size={12} /> Modifier
          </button>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InfoRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#fdf8f0] ring-1 ring-[#ede5d8] text-[#b89664]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9a9590]">{label}</p>
        <div className="mt-1 text-sm font-medium leading-tight text-[#2F3A2E]">{children}</div>
      </div>
    </div>
  );
}

function formatDate(date, locale) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(toIntlLocale(locale), { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Brussels" });
}

function SingleServiceCard({ data, onEdit }) {
  const t = useTranslations("reservationSteps");
  const locale = useLocale();
  const draft = data.appointmentDrafts[0];
  const categoryName = draft?.category?.name ?? data.category?.name ?? "—";
  const serviceName = draft?.service?.name ?? data.service?.name ?? "—";
  const staffName = draft?.staff?.user?.fullName ?? data.staff?.user?.fullName ?? "—";
  const staffPhoto = draft?.staff?.photo ?? data.staff?.photo ?? null;
  const duration = draft?.duration ?? data.staffService?.duration ?? "—";
  return (
    <SectionCard title={t("review.serviceDetails")} onEdit={onEdit ? () => onEdit(1) : null}>
      <div className="space-y-4">
        <InfoRow icon={<Tag size={13} />} label={t("review.category")}>{categoryName}</InfoRow>
        <InfoRow icon={<Tag size={13} />} label={t("review.service")}>{serviceName}</InfoRow>
        <InfoRow icon={<User size={13} />} label={t("review.expert")}>
          <div className="flex items-center gap-2">
            <span className="relative h-8 w-8 overflow-hidden rounded-full ring-1 ring-[#ede5d8] flex-shrink-0">
              {staffPhoto ? (<Image src={staffPhoto} alt={staffName} fill className="object-cover" />) : (<span className="flex h-full w-full items-center justify-center bg-[#2F3A2E] text-xs font-bold text-white">{staffName.charAt(0)}</span>)}
            </span>
            <span>{staffName}</span>
          </div>
        </InfoRow>
        <InfoRow icon={<Calendar size={13} />} label={t("review.date")}>{formatDate(data.date, locale)}</InfoRow>
        <InfoRow icon={<Clock size={13} />} label={t("review.time")}>{data.time} ({t("review.minutes", { count: duration })})</InfoRow>
      </div>
    </SectionCard>
  );
}

function MultiServiceCard({ drafts, onEdit }) {
  const t = useTranslations("reservationSteps");
  return (
    <SectionCard title={t("review.appointmentsCount", { count: drafts.length })} onEdit={onEdit ? () => onEdit(1) : null}>
      <div className="space-y-4">
        {drafts.map((draft, i) => (
          <div key={i} className="rounded-xl border border-[#ede5d8]/50 bg-[#fdf8f0]/40 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#b89664]">{t("review.appointment", { index: i + 1 })}</p>
            <div className="mt-3 space-y-3">
              <InfoRow icon={<Tag size={13} />} label={t("review.service")}>{draft.service?.name ?? "—"}</InfoRow>
              <InfoRow icon={<User size={13} />} label={t("review.expert")}>
                <div className="flex items-center gap-2">
                  <span className="relative h-7 w-7 overflow-hidden rounded-full ring-1 ring-[#ede5d8]"><Image src={draft.staff?.photo ?? ""} alt={draft.staff?.user?.fullName ?? ""} fill className="object-cover" />{!draft.staff?.photo && <span className="flex h-full w-full items-center justify-center bg-[#2F3A2E] text-[10px] font-bold text-white">{(draft.staff?.user?.fullName ?? "?").charAt(0)}</span>}</span>
                  <span className="text-sm">{draft.staff?.user?.fullName ?? "—"}</span>
                </div>
              </InfoRow>
              <div className="flex items-center gap-4 pt-1 text-xs text-[#6f6a64]">
                <span className="inline-flex items-center gap-1"><Clock size={12} className="text-[#b89664]" />{draft.duration ?? "—"} min</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#2F3A2E]"><Euro size={12} />{Number(draft.price ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function CustomerCard({ data, customerSession, onEdit }) {
  const t = useTranslations("reservationSteps");
  const info = customerSession ? { fullName: customerSession.fullName, email: customerSession.email, phone: customerSession.phone } : data.customerInfo;
  return (
    <SectionCard title={t("review.yourInfo")} onEdit={onEdit}>
      <div className="space-y-4">
        <InfoRow icon={<User size={13} />} label={t("review.name")}>{info?.fullName ?? "—"}</InfoRow>
        <InfoRow icon={<Mail size={13} />} label={t("review.email")}>{info?.email ?? "—"}</InfoRow>
        <InfoRow icon={<Phone size={13} />} label={t("review.phone")}>{info?.phone ?? "—"}</InfoRow>
        {data.notes && (<InfoRow icon={<FileText size={13} />} label={t("review.notes")}><span className="font-normal leading-relaxed">{data.notes}</span></InfoRow>)}
      </div>
    </SectionCard>
  );
}

function AutomaticPaymentPreview({ paymentDecision, isManualMode = false }) {
  const t = useTranslations("reservationSteps");
  const { totalAmount, depositRequired, depositAmount, depositPercentage } = paymentDecision;
  const remainingAmount = totalAmount - depositAmount;
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#2F3A2E]/10 bg-white shadow-sm">
      <div className="bg-[#2F3A2E] px-5 py-3.5"><h3 className="text-sm font-semibold text-white">{t("review.paymentSummary")}</h3></div>
      <div className="p-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm"><span className="text-[#6f6a64]">{t("review.servicePrice")}</span><span className="font-semibold text-[#2F3A2E]">€{Number(totalAmount).toFixed(2)}</span></div>
          <div className="border-t border-[#ede5d8]/50" />
          {depositRequired ? (
            <>
              <div className="flex items-center justify-between text-sm"><span className="font-medium text-[#6f6a64]">{t("review.depositOnline", { percentage: depositPercentage })}</span><span className="font-bold text-[#2F3A2E]">€{Number(depositAmount).toFixed(2)}</span></div>
              <div className="flex items-center justify-between text-sm"><span className="font-medium text-[#6f6a64]">{t("review.remainingInSalon")}</span><span className="font-semibold text-[#2F3A2E]">€{Number(remainingAmount).toFixed(2)}</span></div>
              <div className="rounded-xl bg-[#fdf8f0] px-4 py-3 text-xs leading-relaxed text-[#6f6a64] border border-[#ede5d8]/50"><p className="font-semibold text-[#2F3A2E]">{t("review.depositRequired")}</p><p className="mt-1">{t("review.depositRequiredDesc", { percentage: depositPercentage })}</p></div>
            </>
          ) : (
            <div className="rounded-xl bg-[#f0fdf4] border border-emerald-100 px-4 py-3 text-xs text-emerald-800"><p className="flex items-center gap-1.5 font-semibold"><Check size={14} /> {t("review.noDepositRequired")}</p><p className="mt-1 leading-relaxed">{t("review.noDepositRequiredDesc")}</p></div>
          )}
          <div className="border-t border-[#ede5d8]" />
          <div className="flex items-center justify-between text-base"><span className="font-bold text-[#2F3A2E]">{t("review.total")}</span><span className="font-bold text-[#2F3A2E]">€{Number(totalAmount).toFixed(2)}</span></div>
        </div>
        {isManualMode && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800"><p className="font-semibold">{t("review.pendingConfirmation")}</p><p className="mt-1 leading-relaxed">{t("review.manualPayFirstDesc")}</p></div>
        )}
      </div>
    </div>
  );
}

function ManualModeNotice() {
  const t = useTranslations("reservationSteps");
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-amber-200 bg-white shadow-sm">
      <div className="bg-[#2F3A2E] px-5 py-3.5"><h3 className="text-sm font-semibold text-white">{t("review.manualRequest")}</h3></div>
      <div className="p-5"><div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800 leading-relaxed"><p className="font-semibold">{t("review.pendingConfirmation")}</p><p className="mt-2">{t("review.manualDesc")}</p></div></div>
    </div>
  );
}

function MultiAppointmentNotice({ totalAmount }) {
  const t = useTranslations("reservationSteps");
  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#ede5d8]/70 bg-white shadow-sm">
      <div className="bg-[#2F3A2E] px-5 py-3.5"><h3 className="text-sm font-semibold text-white">{t("review.paymentInfo")}</h3></div>
      <div className="p-5"><div className="rounded-xl bg-[#fdf8f0] border border-[#ede5d8]/50 px-4 py-3 text-xs leading-relaxed text-[#6f6a64]"><p className="font-semibold text-[#2F3A2E]">{t("review.salonPayment")}</p><p className="mt-1">{t("review.salonPaymentDesc")}</p></div><div className="mt-4 flex items-center justify-between text-sm font-semibold text-[#2F3A2E]"><span>{t("review.totalEstimated")}</span><span>€{Number(totalAmount).toFixed(2)}</span></div></div>
    </div>
  );
}

export default function ReviewStep({ data, nextStep, customerSession, goToStep }) {
  const t = useTranslations("reservationSteps");
  const [processing, setProcessing] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const router = useRouter();

  const drafts = data.appointmentDrafts ?? [];
  const isMultiDraft = drafts.length > 1;
  const paymentDecision = computePaymentDecision({ drafts });
  const { requiresPaymentStep, isManualMode, totalAmount } = paymentDecision;

  const buildCustomerInfo = () =>
    customerSession ? { userId: customerSession.id, fullName: customerSession.fullName ?? "", email: customerSession.email ?? "", phone: customerSession.phone ?? "" } : data.customerInfo;

  const handleContinue = async () => {
    if (requiresPaymentStep) { nextStep(); return; }
    await handleDirectBooking();
  };

  const handleDirectBooking = async () => {
    if (!acceptedTerms) { toast.error(t("review.acceptTermsRequired")); return; }
    setProcessing(true);
    const loadingToastId = toast.loading(t("review.processing"));
    try {
      const customerInfo = buildCustomerInfo();
      if (isMultiDraft) {
        const { createMultipleReservations } = await import("@/actions/reservation/create-reservation");
        const apptInputs = buildMultiDraftInputs(data);
        const result = await createMultipleReservations({ appointments: apptInputs, customerInfo, paymentMethod: null, notes: data.notes, isManualMode: false, termsAccepted: acceptedTerms });
        toast.dismiss(loadingToastId);
        if (!result.success) { toast.error(result.message || t("review.reservationFailed")); setProcessing(false); return; }
        if (customerSession) toast.success(t("review.reservationsSaved"));
        else await handleAutoSignIn(result.data?.isNewUser, result.data?.autologinToken, result.data?.user?.email, false);
      } else {
        const draft = drafts[0];
        const staffServiceId = draft?.staffService?.id ?? data.staffService?.id;
        const { createReservation } = await import("@/actions/reservation/create-reservation");
        const result = await createReservation({ staffServiceId, date: formatLocalDateKey(data.date), time: data.time, customerInfo, paymentMethod: null, notes: data.notes, isManualMode: isManualMode, termsAccepted: acceptedTerms });
        toast.dismiss(loadingToastId);
        if (!result.success) { toast.error(result.message || t("review.reservationFailed")); setProcessing(false); return; }
        if (customerSession) toast.success(isManualMode ? t("review.requestSent") : t("review.reservationConfirmed"));
        else await handleAutoSignIn(result.data?.isNewUser, result.data?.autologinToken, result.data?.user?.email, isManualMode);
      }
      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      console.error("[ReviewStep] handleDirectBooking:", err);
      toast.dismiss(loadingToastId);
      toast.error(t("customer.genericError"));
      setProcessing(false);
    }
  };

  const handleAutoSignIn = async (isNewUser, autologinToken, email, isManual = false) => {
    if (customerSession) return;
    if (autologinToken && email) {
      try {
        const signInResult = await signIn("credentials", { email, autologinToken, redirect: false });
        if (signInResult?.error) { console.warn("[ReviewStep] auto-signin error:", signInResult.error); toast.error(t("review.autoSigninFailed"), { duration: 6000 }); }
        else {
          if (isNewUser) toast.success(isManual ? t("review.autoSigninManualNew") : t("review.autoSigninNew"), { duration: 8000 });
          else toast.success(isManual ? t("review.autoSigninManual") : t("review.autoSignin"), { duration: 6000 });
        }
      } catch (err) { console.warn("[ReviewStep] auto-signin failed:", err); toast.error(t("review.autoSigninFailed"), { duration: 6000 }); }
    }
  };

  const ctaLabel = (() => {
    if (processing) return (<span className="flex items-center justify-center gap-2"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />{t("review.processing")}</span>);
    if (requiresPaymentStep) return t("review.ctaPay");
    if (isManualMode) return t("review.ctaManual");
    return t("review.ctaConfirm");
  })();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("review.title")}</h2>
        <p className="mt-2 text-sm text-[#6f6a64]">{t("review.subtitle")}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>

      <div className="space-y-5">
        {isMultiDraft ? (<MultiServiceCard drafts={drafts} onEdit={goToStep} />) : (<SingleServiceCard data={data} onEdit={goToStep} />)}
        <CustomerCard data={data} customerSession={customerSession} onEdit={goToStep ? () => goToStep(6) : null} />
        {isMultiDraft && (<MultiAppointmentNotice totalAmount={totalAmount} />)}
        {!isMultiDraft && isManualMode && !requiresPaymentStep && <ManualModeNotice />}
        {!isMultiDraft && !(isManualMode && !requiresPaymentStep) && (<AutomaticPaymentPreview paymentDecision={paymentDecision} isManualMode={isManualMode} />)}

        {!requiresPaymentStep && (
          <label className="flex items-start gap-2.5 rounded-xl border border-[#ede5d8]/50 bg-white px-4 py-3 text-xs leading-relaxed text-[#6f6a64]">
            <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20" />
            <span>{t.rich("review.acceptTerms", { cgv: (chunks) => (<a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#2F3A2E]">{chunks}</a>), privacy: (chunks) => (<a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-[#2F3A2E]">{chunks}</a>)})}</span>
          </label>
        )}

        <button onClick={handleContinue} disabled={processing || (!requiresPaymentStep && !acceptedTerms)} className={`w-full rounded-full px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-all ${processing || (!requiresPaymentStep && !acceptedTerms) ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#2F3A2E] hover:bg-[#212a20] hover:shadow-md hover:-translate-y-px"}`}>{ctaLabel}</button>
        <p className="text-center text-[11px] text-[#9a9590]">Paiement sécurisé • Confirmation instantanée</p>
      </div>
    </div>
  );
}

function buildMultiDraftInputs(data) {
  const drafts = data.appointmentDrafts ?? [];
  const proposal = data.selectedScheduleProposal;
  return drafts.map((draft, i) => {
    if (proposal?.appointments) {
      const appt = proposal.appointments.find((a) => a.draftIndex === i);
      const dateToUse = appt?.date ?? proposal.date;
      return { staffServiceId: draft.staffService.id, date: formatLocalDateKey(dateToUse), time: appt?.time ?? data.time };
    }
    return { staffServiceId: draft.staffService.id, date: formatLocalDateKey(data.perDraftDates?.[i] ?? data.date), time: data.perDraftTimes?.[i] ?? data.time };
  });
}
