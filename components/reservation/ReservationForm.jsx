"use client";

import { useState, useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Clock, Euro, Calendar, User, Sparkles, X } from "lucide-react";
import { toIntlLocale } from "@/lib/intl-locale";
import CategoryStep from "./steps/CategoryStep";
import ServiceStep from "./steps/ServiceStep";
import StaffStep from "./steps/StaffStep";
import AppointmentDraftsStep from "./steps/AppointmentDraftsStep";
import DateTimeStep from "./steps/DateTimeStep";
import CustomerInfoStep from "./steps/CustomerInfoStep";
import ReviewStep from "./steps/ReviewStep";
import PaymentStep from "./steps/PaymentStep";
import { computePaymentDecision } from "@/lib/reservation-payment";

function isStepValid(stepId, reservationData) {
  switch (stepId) {
    case 1:
      return Boolean(reservationData.category);
    case 2:
      return Boolean(reservationData.service);
    case 3:
      return Boolean(reservationData.staff && reservationData.staffService);
    case 4:
      return (reservationData.appointmentDrafts ?? []).length > 0;
    case 5: {
      const drafts = reservationData.appointmentDrafts ?? [];
      const isMulti = drafts.length > 1;
      if (!isMulti) return Boolean(reservationData.date && reservationData.time);
      return Boolean(reservationData.selectedScheduleProposal);
    }
    case 6: {
      const info = reservationData.customerInfo;
      if (!info) return false;
      return Boolean(info.fullName?.trim() && info.email?.trim() && info.email.includes("@") && info.phone?.trim());
    }
    case 7:
      return true;
    case 8:
      return true;
    default:
      return true;
  }
}

const ALL_STEPS = [
  { id: 1, name: "reservationForm.step1", component: CategoryStep },
  { id: 2, name: "reservationForm.step2", component: ServiceStep },
  { id: 3, name: "reservationForm.step3", component: StaffStep },
  { id: 4, name: "reservationForm.step4", component: AppointmentDraftsStep, draftStep: true },
  { id: 5, name: "reservationForm.step5", component: DateTimeStep },
  { id: 6, name: "reservationForm.step6", component: CustomerInfoStep, guestOnly: true },
  { id: 7, name: "reservationForm.step7", component: ReviewStep },
  { id: 8, name: "reservationForm.step8", component: PaymentStep, paymentStep: true },
];

// ─── Persistent Summary ───────────────────────────────────────────────
function SummarySidebar({ data, onEdit }) {
  const drafts = data.appointmentDrafts ?? [];
  const hasDrafts = drafts.length > 0;
  const hasCategory = Boolean(data.category);
  const hasService = Boolean(data.service);
  const hasStaff = Boolean(data.staff);
  const hasDateTime = Boolean(data.date && data.time) || Boolean(data.selectedScheduleProposal);
  const hasAny = hasDrafts || hasCategory || hasService || hasStaff || hasDateTime;
  if (!hasAny) return null;

  const totalPrice = drafts.length ? drafts.reduce((s, d) => s + Number(d.price ?? 0), 0) : data.staffService ? Number(data.staffService.price ?? 0) : data.service ? 0 : 0;
  const totalDuration = drafts.length ? drafts.reduce((s, d) => s + (d.duration ?? 0), 0) : data.staffService?.duration ?? 0;

  return (
    <div className="rounded-2xl border border-[#ede5d8]/70 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
          <Sparkles size={14} />
        </div>
        <h3 className="text-sm font-semibold tracking-wide text-[#2F3A2E]">Votre sélection</h3>
      </div>

      <div className="space-y-4">
        {/* Drafts or current picks */}
        {hasDrafts ? (
          drafts.map((d, i) => (
            <div key={i} className="rounded-xl border border-[#f0e8d8] bg-[#fdf8f0]/60 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b89664]">Rendez-vous {i + 1}</p>
              <p className="mt-1 text-sm font-semibold text-[#2F3A2E] leading-tight">{d.service?.name ?? "—"}</p>
              <p className="text-xs text-[#6f6a64]">{d.category?.name ?? ""}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-[#6f6a64]">
                <span className="inline-flex items-center gap-1"><User size={11} className="text-[#b89664]" />{d.staff?.user?.fullName ?? "—"}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1 text-[#6f6a64]"><Clock size={11} />{d.duration ?? "—"} min</span>
                <span className="font-semibold text-[#2F3A2E]">€{Number(d.price ?? 0).toFixed(2)}</span>
              </div>
            </div>
          ))
        ) : (
          <>
            {hasCategory && (
              <div className="flex items-center justify-between rounded-xl bg-[#fdf8f0] px-3 py-2.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9590]">Catégorie</p>
                  <p className="text-sm font-medium text-[#2F3A2E]">{data.category.name}</p>
                </div>
                <button onClick={() => onEdit(1)} className="text-[11px] font-medium text-[#b89664] hover:text-[#2F3A2E]">Modifier</button>
              </div>
            )}
            {hasService && (
              <div className="flex items-center justify-between rounded-xl bg-[#fdf8f0] px-3 py-2.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9590]">Prestation</p>
                  <p className="text-sm font-medium text-[#2F3A2E] leading-tight">{data.service.name}</p>
                </div>
                <button onClick={() => onEdit(2)} className="text-[11px] font-medium text-[#b89664] hover:text-[#2F3A2E]">Modifier</button>
              </div>
            )}
            {hasStaff && (
              <div className="flex items-center justify-between rounded-xl bg-[#fdf8f0] px-3 py-2.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9590]">Experte</p>
                  <p className="text-sm font-medium text-[#2F3A2E]">{data.staff?.user?.fullName ?? "—"}</p>
                </div>
                <button onClick={() => onEdit(3)} className="text-[11px] font-medium text-[#b89664] hover:text-[#2F3A2E]">Modifier</button>
              </div>
            )}
          </>
        )}

        {hasDateTime && (
          <div className="rounded-xl border border-[#ede5d8] bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9590]">Date & Heure</p>
            {data.selectedScheduleProposal ? (
              <p className="mt-1 text-sm font-medium text-[#2F3A2E]">Créneau confirmé</p>
            ) : (
              <p className="mt-1 text-sm font-medium text-[#2F3A2E]">{data.date ? new Date(data.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" }) : "—"} • {data.time ?? "—"}</p>
            )}
            <button onClick={() => onEdit(5)} className="mt-1 text-[11px] font-medium text-[#b89664] hover:text-[#2F3A2E]">Modifier</button>
          </div>
        )}

        {(totalPrice > 0 || totalDuration > 0) && (
          <div className="flex items-center justify-between border-t border-[#ede5d8] pt-4">
            <span className="text-xs font-medium text-[#6f6a64]">Total estimé</span>
            <span className="text-sm font-bold tracking-tight text-[#2F3A2E]">{totalDuration ? `${totalDuration} min • ` : ""}€{Number(totalPrice).toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MobileSummary({ data, onEdit }) {
  const [open, setOpen] = useState(false);
  const drafts = data.appointmentDrafts ?? [];
  const count = drafts.length || (data.category ? 1 : 0);
  if (count === 0) return null;
  const totalPrice = drafts.length ? drafts.reduce((s, d) => s + Number(d.price ?? 0), 0) : data.staffService ? Number(data.staffService.price ?? 0) : 0;
  const totalDuration = drafts.length ? drafts.reduce((s, d) => s + (d.duration ?? 0), 0) : data.staffService?.duration ?? 0;
  const label = drafts.length ? `${drafts.length} rendez-vous • €${totalPrice.toFixed(2)}` : data.service ? `${data.service.name} • €${totalPrice.toFixed(2)}` : data.category ? data.category.name : "Votre sélection";
  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-2xl border border-[#ede5d8] bg-white px-4 py-3"
      >
        <div className="flex items-center gap-3 text-left">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F3A2E] text-white"><Sparkles size={13} /></div>
          <div>
            <p className="text-xs font-semibold text-[#2F3A2E] leading-tight line-clamp-1">{label}</p>
            <p className="text-[11px] text-[#6f6a64]">{totalDuration ? `${totalDuration} min` : "Détails"}</p>
          </div>
        </div>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full border border-[#ede5d8] bg-[#fdf8f0] text-[#2F3A2E] transition-transform ${open ? "rotate-180" : ""}`}><ChevronRight size={14} className="rotate-90" /></span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3"><SummarySidebar data={data} onEdit={onEdit} /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ReservationForm({ customerSession = null }) {
  const t = useTranslations();
  const isAuthenticated = Boolean(customerSession);

  const [currentStep, setCurrentStep] = useState(1);
  const [reservationData, setReservationData] = useState({
    category: null,
    service: null,
    staff: null,
    staffService: null,
    appointmentDrafts: [],
    date: null,
    time: null,
    schedulingMode: "same-day",
    sameDayDate: null,
    perDraftDates: {},
    perDraftTimes: {},
    selectedScheduleProposal: null,
    customerInfo: isAuthenticated
      ? {
          fullName: customerSession.fullName ?? "",
          email: customerSession.email ?? "",
          phone: customerSession.phone ?? "",
          newsletterSubscribed: false,
        }
      : null,
    paymentMethod: null,
    notes: "",
  });

  const STEPS = useMemo(() => {
    const { requiresPaymentStep } = computePaymentDecision({ drafts: reservationData.appointmentDrafts });
    return ALL_STEPS.filter((s) => {
      if (s.guestOnly && isAuthenticated) return false;
      if (s.paymentStep && !requiresPaymentStep) return false;
      return true;
    });
  }, [isAuthenticated, reservationData.appointmentDrafts]);

  const updateReservationData = (data) => setReservationData((prev) => ({ ...prev, ...data }));
  const draftStepNumber = STEPS.findIndex((s) => s.draftStep) + 1;

  const nextStep = () => { if (currentStep < STEPS.length) setCurrentStep((prev) => prev + 1); };
  const prevStep = () => { if (currentStep > 1) setCurrentStep((prev) => prev - 1); };
  const goToStep = (step) => { if (step < currentStep) setCurrentStep(step); };
  const goToStepById = (id) => {
    const idx = STEPS.findIndex((s) => s.id === id);
    if (idx !== -1) setCurrentStep(idx + 1);
  };

  const commitDraftAndGoToSummary = (selectedStaffService) => {
    setReservationData((prev) => {
      const newDraft = {
        category: prev.category,
        service: prev.service,
        staff: selectedStaffService.staff,
        staffService: selectedStaffService,
        duration: selectedStaffService?.duration ?? null,
        price: selectedStaffService?.price ?? null,
      };
      return { ...prev, appointmentDrafts: [...prev.appointmentDrafts, newDraft], category: null, service: null, staff: null, staffService: null };
    });
    setCurrentStep(draftStepNumber);
  };

  const handleAddAnother = () => setCurrentStep(1);
  const handleContinueToDates = () => setCurrentStep(draftStepNumber + 1);
  const handleRemoveDraft = (index) => {
    setReservationData((prev) => {
      const updated = prev.appointmentDrafts.filter((_, i) => i !== index);
      if (updated.length === 0) setTimeout(() => setCurrentStep(1), 0);
      return { ...prev, appointmentDrafts: updated };
    });
  };

  const currentStepDef = STEPS[currentStep - 1];
  const CurrentStepComponent = currentStepDef.component;
  const isLastStep = currentStep === STEPS.length;
  const isDraftStep = currentStepDef.draftStep === true;
  const isDateTimeStep = currentStepDef.id === 5;
  const isStaffStep = currentStepDef.id === 3;
  const isCategoryStep = currentStepDef.id === 1;
  const isPaymentStep = currentStepDef.paymentStep === true;
  const isReviewStep = currentStepDef.id === 7;
  const isCustomerStep = currentStepDef.id === 6;
  const canProceed = isStepValid(currentStepDef.id, reservationData);

  const hasSummary = reservationData.appointmentDrafts.length > 0 || Boolean(reservationData.category || reservationData.service || reservationData.staff);
  const showSidebar = hasSummary && !isCategoryStep;
  const hideGlobalNav = isLastStep || isDraftStep || isDateTimeStep || isCategoryStep || isPaymentStep || isReviewStep || isCustomerStep;

  // Back is available on every step except the very first one
  const showBack = currentStep > 1;

  return (
    <div className="relative bg-[#fdf8f0]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-2 sm:py-4">
        <div className={`flex flex-col gap-6 lg:flex-row lg:items-start ${showSidebar ? "lg:gap-8" : ""}`}>
          <div className="min-w-0 flex-1">
            {showSidebar && (
              <div className="mb-4">
                <MobileSummary data={reservationData} onEdit={goToStepById} />
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                className="bg-transparent p-0"
              >
                {isDraftStep ? (
                  <AppointmentDraftsStep data={reservationData} onAddAnother={handleAddAnother} onContinue={handleContinueToDates} onRemoveDraft={handleRemoveDraft} prevStep={prevStep} />
                ) : (
                  <CurrentStepComponent
                    data={reservationData}
                    updateData={updateReservationData}
                    nextStep={isStaffStep ? commitDraftAndGoToSummary : nextStep}
                    prevStep={prevStep}
                    customerSession={customerSession}
                    goToStep={goToStepById}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Bottom navigation — Précédent at bottom on every step except first */}
            {(showBack || !hideGlobalNav) && (
              <div className="mt-8 flex items-center justify-between gap-3">
                <div>
                  {showBack && (
                    <button
                      onClick={prevStep}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#ede5d8] bg-white px-5 py-2.5 text-sm font-medium text-[#2F3A2E] hover:border-[#2F3A2E]/20 hover:bg-white transition-colors"
                    >
                      <ChevronLeft size={16} className="opacity-60" />
                      {t("reservationForm.buttons.previous")}
                    </button>
                  )}
                </div>
                <div>
                  {!hideGlobalNav && (
                    <button
                      onClick={nextStep}
                      disabled={isLastStep || !canProceed}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-7 py-3 text-sm font-semibold tracking-wide transition-all ${
                        isLastStep || !canProceed
                          ? "cursor-not-allowed bg-[#e8ddd0] text-white"
                          : "bg-[#2F3A2E] text-white hover:bg-[#212a20]"
                      }`}
                    >
                      {t("reservationForm.buttons.next")}
                      <ChevronRight size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {showSidebar && (
            <div className="hidden w-full lg:block lg:w-[340px] lg:flex-shrink-0">
              <div className="sticky top-6">
                <SummarySidebar data={reservationData} onEdit={goToStepById} />
                <div className="mt-4 rounded-2xl border border-[#ede5d8]/50 bg-white px-4 py-4 text-center">
                  <p className="text-xs font-semibold text-[#2F3A2E]">Besoin d&apos;aide ?</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#6f6a64]">Notre équipe vous aide à choisir la prestation idéale.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
