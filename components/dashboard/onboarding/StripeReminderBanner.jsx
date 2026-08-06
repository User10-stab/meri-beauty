"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { checkOnboardingStatus } from "@/actions/staff/check-onboarding-status";

export function StripeReminderBanner() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const loadStatus = async () => {
      const status = await checkOnboardingStatus();
      if (status.isStaff && status.setupCompleted && status.stripeRequired) {
        setShow(true);
      }
    };
    loadStatus();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    setShow(false);
  };

  if (!show || dismissed) return null;

  return (
    <div className="border-b border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex-shrink-0">
          <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            Configuration Stripe requise
          </p>
          <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">
            Vous devez connecter votre compte Stripe pour recevoir des paiements et des commissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/dashboard/payments")}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            Configurer maintenant
          </button>
          <button
            onClick={handleDismiss}
            className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:text-red-400 dark:hover:bg-red-800"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
