"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

export default function ReservationSuccessPage() {
  const router = useRouter();
  const t = useTranslations("reservationSuccess");

  useEffect(() => {
    // Show success toast
    toast.success(t("confirmedTitle") || "Votre réservation a été créée avec succès !");
    
    // Redirect to home after a short delay
    const timer = setTimeout(() => {
      router.replace("/");
    }, 1000);

    return () => clearTimeout(timer);
  }, [router, t]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8 text-emerald-600">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t("confirmedTitle") || "Votre réservation a été créée avec succès !"}
        </h1>
        <p className="mt-2 text-gray-500">
          Redirection en cours...
        </p>
      </div>
    </div>
  );
}
  