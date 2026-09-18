"use client";

import { ArrowLeft } from "lucide-react";

/**
 * StepBackArrow — the single back-navigation control for the quick
 * reservation form. Same icon, style, position and behavior on every step:
 * a discreet label-less arrow above the step content that performs exactly
 * the previous "Précédent" action (prevStep).
 */
export default function StepBackArrow({ onBack, label }) {
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={label}
      className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-[#9a9590] transition-colors bg-[#f5ece0] hover:bg-primary hover:text-white"
    >
      <ArrowLeft size={16} />
    </button>
  );
}
