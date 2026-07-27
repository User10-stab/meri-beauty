"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, Check } from "lucide-react";
import CategoryStep from "./steps/CategoryStep";
import ServiceStep from "./steps/ServiceStep";
import StaffStep from "./steps/StaffStep";
import DateTimeStep from "./steps/DateTimeStep";
import CustomerInfoStep from "./steps/CustomerInfoStep";
import ReviewStep from "./steps/ReviewStep";
import PaymentStep from "./steps/PaymentStep";

const ALL_STEPS = [
  { id: 1, name: "Catégorie",    component: CategoryStep },
  { id: 2, name: "Service",      component: ServiceStep },
  { id: 3, name: "Experte",      component: StaffStep },
  { id: 4, name: "Date & Heure", component: DateTimeStep },
  { id: 5, name: "Informations", component: CustomerInfoStep, guestOnly: true },
  { id: 6, name: "Récapitulatif",component: ReviewStep },
  { id: 7, name: "Paiement",     component: PaymentStep },
];

/**
 * @param {{ customerSession: { id: string, email: string, fullName?: string, phone?: string } | null }} props
 */
export default function ReservationForm({ customerSession = null }) {
  const isAuthenticated = Boolean(customerSession);

  // The steps actually shown — skip CustomerInfoStep when logged in
  const STEPS = useMemo(
    () => ALL_STEPS.filter((s) => !s.guestOnly || !isAuthenticated),
    [isAuthenticated]
  );

  const [currentStep, setCurrentStep] = useState(1);
  const [reservationData, setReservationData] = useState({
    category: null,
    service: null,
    staff: null,
    staffService: null,
    date: null,
    time: null,
    // Pre-populate from session so create-reservation always has customerInfo
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

  const updateReservationData = (data) => {
    setReservationData((prev) => ({ ...prev, ...data }));
  };

  const nextStep = () => {
    if (currentStep < STEPS.length) setCurrentStep((prev) => prev + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep((prev) => prev - 1);
  };

  const goToStep = (step) => {
    if (step <= currentStep || step === 1) setCurrentStep(step);
  };

  const CurrentStepComponent = STEPS[currentStep - 1].component;
  const isLastStep = currentStep === STEPS.length;

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
          <CurrentStepComponent
            data={reservationData}
            updateData={updateReservationData}
            nextStep={nextStep}
            prevStep={prevStep}
            customerSession={customerSession}
          />
        </motion.div>
      </AnimatePresence>

      {/* ── Navigation Buttons (hidden on payment step) ────────── */}
      {!isLastStep && (
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
