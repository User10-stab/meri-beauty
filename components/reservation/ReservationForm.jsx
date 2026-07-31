"use client";

import { useState, useMemo } from "react";
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

const ALL_STEPS = [
  { id: 1, name: "Catégorie",      component: CategoryStep },
  { id: 2, name: "Service",        component: ServiceStep },
  { id: 3, name: "Experte",        component: StaffStep },
  { id: 4, name: "Rendez-vous",    component: AppointmentDraftsStep, draftStep: true },
  { id: 5, name: "Date & Heure",   component: DateTimeStep },
  { id: 6, name: "Informations",   component: CustomerInfoStep, guestOnly: true },
  { id: 7, name: "Récapitulatif",  component: ReviewStep },
  { id: 8, name: "Paiement",       component: PaymentStep, paymentStep: true },
];

/**
 * @param {{ customerSession: { id: string, email: string, fullName?: string, phone?: string } | null }} props
 */
export default function ReservationForm({ customerSession = null }) {
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

  const goToStep = (step) => {
    if (step <= currentStep || step === 1) setCurrentStep(step);
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* ── Progress Indicator ─────────────────────────────────── */}
      <div className="mb-12">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <button
                  onClick={() => goToStep(index + 1)}
                  disabled={index + 1 > currentStep}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all ${
                    index + 1 < currentStep
                      ? "border-[#C8A46A] bg-[#C8A46A] text-white"
                      : index + 1 === currentStep
                      ? "border-[#C8A46A] bg-white text-[#C8A46A]"
                      : "border-gray-300 bg-white text-gray-400"
                  } ${index + 1 <= currentStep ? "cursor-pointer hover:scale-110" : "cursor-not-allowed"}`}
                >
                  {index + 1 < currentStep ? (
                    <Check size={18} />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </button>
                <span
                  className={`mt-2 text-xs font-medium ${
                    index + 1 <= currentStep ? "text-[#2F3A2E]" : "text-gray-400"
                  }`}
                >
                  {step.name}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 transition-all ${
                    index + 1 < currentStep ? "bg-[#C8A46A]" : "bg-gray-300"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step Content ───────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.3 }}
          className="min-h-[500px]"
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

      {/* ── Navigation Buttons ─────────────────────────────────── */}
      {/* Hidden on: last step (payment), draft step (has its own buttons) */}
      {!isLastStep && !isDraftStep && !isDateTimeStep && (
        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-all ${
              currentStep === 1
                ? "cursor-not-allowed bg-gray-200 text-gray-400"
                : "bg-gray-100 text-[#2F3A2E] hover:bg-gray-200"
            }`}
          >
            <ChevronLeft size={18} />
            Précédent
          </button>

          <div className="text-sm text-gray-500">
            Étape {currentStep} sur {STEPS.length}
          </div>

          <button
            onClick={nextStep}
            disabled={isLastStep}
            className={`inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold transition-all ${
              isLastStep
                ? "cursor-not-allowed bg-gray-200 text-gray-400"
                : "bg-[#C8A46A] text-white hover:bg-[#B8945A]"
            }`}
          >
            Suivant
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
