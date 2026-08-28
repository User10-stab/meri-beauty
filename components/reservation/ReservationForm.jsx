"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, Check } from "lucide-react";
import CategoryStep from "./steps/CategoryStep";
import ServiceStep from "./steps/ServiceStep";
import StaffStep from "./steps/StaffStep";
import AppointmentDraftsStep from "./steps/AppointmentDraftsStep";
import DateTimeStep from "./steps/DateTimeStep";
import CustomerInfoStep from "./steps/CustomerInfoStep";
import ReviewStep from "./steps/ReviewStep";
import PaymentStep from "./steps/PaymentStep";
import { computePaymentDecision } from "@/lib/reservation-payment";

/**
 * Returns true when the data collected for a given step is complete enough
 * to allow moving forward.  Steps that self-advance on click (Category,
 * Service, Staff) still benefit from this guard so the stepper breadcrumb
 * cannot be used to skip ahead.
 *
 * @param {number}  stepId          — ALL_STEPS id for the step to validate
 * @param {object}  reservationData — current shared state
 * @returns {boolean}
 */
function isStepValid(stepId, reservationData) {
  switch (stepId) {
    // ── Step 1 · Category ──────────────────────────────────────────────────
    case 1:
      return Boolean(reservationData.category);

    // ── Step 2 · Service ───────────────────────────────────────────────────
    case 2:
      return Boolean(reservationData.service);

    // ── Step 3 · Staff ─────────────────────────────────────────────────────
    case 3:
      return Boolean(reservationData.staff && reservationData.staffService);

    // ── Step 4 · Appointment drafts summary ────────────────────────────────
    // The user can only reach this step after committing a draft, so drafts
    // is always non-empty here; guard anyway for safety.
    case 4:
      return (reservationData.appointmentDrafts ?? []).length > 0;

    // ── Step 5 · Date & Time ───────────────────────────────────────────────
    // DateTimeStep manages its own confirm buttons and calls nextStep()
    // internally — the global Suivant button is hidden for this step.
    // We still need a validity signal for the stepper breadcrumb guard.
    case 5: {
      const drafts = reservationData.appointmentDrafts ?? [];
      const isMulti = drafts.length > 1;
      if (!isMulti) {
        // Single draft: need date + time committed to shared state
        return Boolean(reservationData.date && reservationData.time);
      }
      // Multi-draft: a confirmed schedule proposal must be stored
      return Boolean(reservationData.selectedScheduleProposal);
    }

    // ── Step 6 · Customer information (guest only) ─────────────────────────
    // CustomerInfoStep validates its own form before calling nextStep().
    // The global Suivant button is NOT used for this step (it has its own
    // submit button).  Validity here is used only for the breadcrumb guard.
    case 6: {
      const info = reservationData.customerInfo;
      if (!info) return false;
      return Boolean(
        info.fullName?.trim() &&
        info.email?.trim() &&
        info.email.includes("@") &&
        info.phone?.trim()
      );
    }

    // ── Step 7 · Review / Récapitulatif ────────────────────────────────────
    // ReviewStep has its own action buttons; the global Suivant is hidden.
    case 7:
      return true;

    // ── Step 8 · Payment ───────────────────────────────────────────────────
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

/**
 * @param {{ customerSession: { id: string, email: string, fullName?: string, phone?: string } | null }} props
 */
export default function ReservationForm({ customerSession = null }) {
  const t = useTranslations();
  const isAuthenticated = Boolean(customerSession);

  const [currentStep, setCurrentStep] = useState(1);
  const [reservationData, setReservationData] = useState({
    category:          null,
    service:           null,
    staff:             null,
    staffService:      null,
    // List of appointment drafts accumulated before Date & Time selection.
    // Each draft: { category, service, staff, staffService, duration, price }
    appointmentDrafts: [],
    date:              null,
    time:              null,
    // Multi-draft scheduling fields (populated in DateTimeStep)
    schedulingMode:    "same-day", // "same-day" | "multi-day"
    sameDayDate:       null,       // Date — used in same-day mode
    perDraftDates:     {},         // { [draftIndex]: Date } — used in multi-day mode
    perDraftTimes:     {},         // { [draftIndex]: string } — used in multi-day mode
    selectedScheduleProposal: null, // chosen auto-proposal from DateTimeStep
    // Pre-populate from session so create-reservation always has customerInfo
    customerInfo: isAuthenticated
      ? {
          fullName:             customerSession.fullName ?? "",
          email:                customerSession.email    ?? "",
          phone:                customerSession.phone    ?? "",
          newsletterSubscribed: false,
        }
      : null,
    paymentMethod: null,
    notes:         "",
  });

  // ── Step list — derived from auth state + live payment decision ───────────
  // Re-evaluated whenever drafts change so PaymentStep is included/excluded
  // automatically as soon as the customer's draft configuration is known.
  const STEPS = useMemo(() => {
    const { requiresPaymentStep } = computePaymentDecision({
      drafts: reservationData.appointmentDrafts,
    });

    return ALL_STEPS.filter((s) => {
      if (s.guestOnly && isAuthenticated) return false;
      if (s.paymentStep && !requiresPaymentStep) return false;
      return true;
    });
  }, [isAuthenticated, reservationData.appointmentDrafts]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const updateReservationData = (data) => {
    setReservationData((prev) => ({ ...prev, ...data }));
  };

  /** Index (1-based) of the AppointmentDraftsStep inside STEPS */
  const draftStepNumber = STEPS.findIndex((s) => s.draftStep) + 1;

  // ── Navigation ───────────────────────────────────────────────────────────

  const nextStep = () => {
    if (currentStep < STEPS.length) setCurrentStep((prev) => prev + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep((prev) => prev - 1);
  };

  /**
   * Allow clicking a breadcrumb step only when going backward (or to the
   * current step).  Forward jumps via the breadcrumb are blocked so the user
   * cannot skip a step whose validation has not been satisfied yet.
   */
  const goToStep = (step) => {
    if (step < currentStep) setCurrentStep(step);
    // Equal or forward: do nothing — the user must complete the current step first.
  };

  // ── Draft-step specific handlers ─────────────────────────────────────────

  /**
   * Called by StaffStep (via nextStep) just before advancing.
   * Receives the freshly-selected staffService directly to avoid reading
   * stale state — category and service are read inside the state updater
   * callback to guarantee they are also current.
   *
   * @param {object} selectedStaffService  — the staffService record chosen in StaffStep
   */
  const commitDraftAndGoToSummary = (selectedStaffService) => {
    setReservationData((prev) => {
      const newDraft = {
        category:     prev.category,
        service:      prev.service,
        staff:        selectedStaffService.staff,
        staffService: selectedStaffService,
        duration:     selectedStaffService?.duration ?? null,
        price:        selectedStaffService?.price    ?? null,
      };
      return {
        ...prev,
        appointmentDrafts: [...prev.appointmentDrafts, newDraft],
        // Reset current-selection fields so the next pick starts clean
        category:     null,
        service:      null,
        staff:        null,
        staffService: null,
      };
    });

    // Jump to the drafts step
    setCurrentStep(draftStepNumber);
  };

  /**
   * "Ajouter un autre rendez-vous": keep drafts, go back to Category (step 1).
   */
  const handleAddAnother = () => {
    // category/service/staff are already null (reset in commitDraftAndGoToSummary)
    setCurrentStep(1);
  };

  /**
   * "Continuer vers Date & Heure": advance past the drafts step.
   */
  const handleContinueToDates = () => {
    setCurrentStep(draftStepNumber + 1);
  };

  /**
   * Remove a draft by index. If no drafts remain, send the user back to
   * Category so they are never stuck with an empty list.
   */
  const handleRemoveDraft = (index) => {
    setReservationData((prev) => {
      const updated = prev.appointmentDrafts.filter((_, i) => i !== index);
      if (updated.length === 0) {
        // Schedule navigation outside the state updater
        setTimeout(() => setCurrentStep(1), 0);
      }
      return { ...prev, appointmentDrafts: updated };
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const currentStepDef  = STEPS[currentStep - 1];
  const CurrentStepComponent = currentStepDef.component;
  const isLastStep      = currentStep === STEPS.length;
  const isDraftStep     = currentStepDef.draftStep === true;
  const isDateTimeStep  = currentStepDef.id === 5;
  // Staff step is always step 3 (id 3) regardless of guest/auth filtering
  const isStaffStep     = currentStepDef.id === 3;

  /** Whether the current step's data is valid so Suivant can be clicked */
  const canProceed = isStepValid(currentStepDef.id, reservationData);

  return (
    <div className="mx-auto max-w-7xl px-3 py-8 sm:px-4 sm:py-12 lg:px-8">
      {/* ── Progress Indicator ─────────────────────────────────── */}
      <div className="mb-8 sm:mb-12 overflow-x-auto pb-2 sm:pb-3 -mx-3 sm:mx-0 px-3 sm:px-0">
        <div className="flex w-max min-w-full items-start justify-between gap-1.5 sm:gap-2 md:gap-3">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex min-w-12 sm:min-w-16 flex-1 items-start">
              <div className="flex min-w-10 sm:min-w-12 flex-col items-center">
                <button
                  onClick={() => goToStep(index + 1)}
                  disabled={index + 1 >= currentStep}
                  className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 text-xs sm:text-sm font-semibold transition-all ${
                    index + 1 < currentStep
                      ? "border-[#C8A46A] bg-[#C8A46A] text-white"
                      : index + 1 === currentStep
                      ? "border-[#C8A46A] bg-white text-[#C8A46A]"
                      : "border-gray-300 bg-white text-gray-400"
                  } ${index + 1 < currentStep ? "cursor-pointer hover:scale-110" : "cursor-not-allowed"}`}
                >
                  {index + 1 < currentStep ? (
                    <Check size={14} className="sm:w-[18px] sm:h-[18px]" />
                  ) : (
                    <span className="text-[10px] sm:text-sm">{index + 1}</span>
                  )}
                </button>
                <span
                  className={`mt-1 sm:mt-2 text-[7px] sm:text-xs font-medium line-clamp-2 text-center w-12 sm:w-auto ${
                    index + 1 <= currentStep ? "text-[#2F3A2E]" : "text-gray-400"
                  }`}
                >
                  {t(step.name)}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`mx-0.5 sm:mx-1 md:mx-2 mt-4 sm:mt-5 h-0.5 min-w-2 sm:min-w-4 flex-1 transition-all ${
                    index + 1 < currentStep ? "bg-[#C8A46A]" : "bg-gray-300"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step Content ───────────────────────────────────────── */}
      <div className="overflow-x-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="min-h-[400px] sm:min-h-[500px]"
          >
            {isDraftStep ? (
              // AppointmentDraftsStep uses custom action props instead of nextStep/prevStep
              <AppointmentDraftsStep
                data={reservationData}
                onAddAnother={handleAddAnother}
                onContinue={handleContinueToDates}
                onRemoveDraft={handleRemoveDraft}
              />
            ) : (
              <CurrentStepComponent
                data={reservationData}
                updateData={updateReservationData}
                // StaffStep gets a special nextStep that commits the draft first
                nextStep={isStaffStep ? commitDraftAndGoToSummary : nextStep}
                prevStep={prevStep}
                customerSession={customerSession}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Navigation Buttons ─────────────────────────────────── */}
      {/* Hidden on: last step (payment), draft step (has its own buttons) */}
      {!isLastStep && !isDraftStep && !isDateTimeStep && (
        <div className="mt-6 sm:mt-8 flex flex-col-reverse sm:flex-row items-center justify-between gap-3 sm:gap-4">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className={`w-full sm:w-auto inline-flex items-center justify-center sm:justify-start gap-2 rounded-lg px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold transition-all ${
              currentStep === 1
                ? "cursor-not-allowed bg-gray-200 text-gray-400"
                : "bg-gray-100 text-[#2F3A2E] hover:bg-gray-200"
            }`}
          >
            <ChevronLeft size={16} className="sm:w-[18px] sm:h-[18px]" />
            {t("reservationForm.buttons.previous")}
          </button>

          <div className="text-xs sm:text-sm text-gray-500 order-3 sm:order-2">
            {t("reservationForm.stepOf", { current: currentStep, total: STEPS.length })}
          </div>

          <button
            onClick={nextStep}
            disabled={isLastStep || !canProceed}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg px-4 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold transition-all order-2 sm:order-3 ${
              isLastStep || !canProceed
                ? "cursor-not-allowed bg-gray-200 text-gray-400"
                : "bg-[#C8A46A] text-white hover:bg-[#B8945A]"
            }`}
          >
            {t("reservationForm.buttons.next")}
            <ChevronRight size={16} className="sm:w-[18px] sm:h-[18px]" />
          </button>
        </div>
      )}
    </div>
  );
}
