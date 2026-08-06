"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CheckCircle2, AlertCircle, CreditCard } from "lucide-react";
import Button from "@/components/ui/Button";

export function OnboardingModal({ step }) {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const overlayProps = {
    className: "fixed inset-0 z-[9999] flex items-center justify-center bg-black/60",
    onClick: (e) => e.stopPropagation(),
  };

  const dialogProps = {
    className:
      "relative mx-4 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-gray-700 dark:bg-gray-900",
    onClick: (e) => e.stopPropagation(),
  };

  if (step === "account") {
    return (
      <div {...overlayProps}>
        <div {...dialogProps}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#2f3a2e]/10">
              <CheckCircle2 size={28} className="text-[#2f3a2e]" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bienvenue !</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Avant de commencer à utiliser votre espace, vous devez compléter les paramètres de votre
              compte.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {["Profil", "Contrat", "Paramètres de réservation", "Horaires de travail"].map(
              (label) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <CheckCircle2 size={18} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                </div>
              )
            )}
          </div>
          <div className="mt-6 flex justify-center">
            <button
              className="w-[230px] flex justify-center bg-primary text-white py-3 rounded-lg hover:bg-primary/90 focus:outline-none"
              onClick={() => router.push("/dashboard/account-settings")}
            >
              Compléter mon compte
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "services") {
    return (
      <div {...overlayProps}>
        <div {...dialogProps}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
              <AlertCircle size={28} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Ajoutez vos services</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Votre compte est maintenant configuré. Pour que les clients puissent réserver avec vous, vous
              devez disposer d'au moins un service.
            </p>
          </div>

          <div className="mt-6 flex justify-center">
            <button
              className="w-[230px] flex justify-center bg-primary text-white py-3 rounded-lg hover:bg-primary/90 focus:outline-none"
              onClick={() => router.push("/dashboard/services")}
            >
              Voir mes services
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "stripe") {
    return (
      <div {...overlayProps}>
        <div {...dialogProps}>
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
              <CreditCard size={28} className="text-purple-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Configurez Stripe Connect</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Pour recevoir des paiements en ligne et des commissions, vous devez connecter votre compte Stripe.
              Cette étape est obligatoire pour tous les membres du staff.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {["Recevoir des paiements en ligne", "Gérer vos commissions", "Sécurité des transactions"].map(
              (label) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <CheckCircle2 size={18} className="text-gray-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                </div>
              )
            )}
          </div>
          <div className="mt-6 flex justify-center">
            <button
              className="w-[230px] flex justify-center bg-primary text-white py-3 rounded-lg hover:bg-primary/90 focus:outline-none"
              onClick={() => router.push("/dashboard/payments/")}
            >
              Configurer Stripe
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
