"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { CheckCircle2, Circle, AlertCircle, CreditCard } from "lucide-react";

/** Default fallback for the account step. The caller normally passes the
 *  real per-step state from checkOnboardingStatus; this keeps the modal
 *  rendering something sensible if it ever mounts without it. */
const ACCOUNT_STEPS_FALLBACK = [
  { key: "languages", label: "Profil — au moins une langue parlée", done: false },
  { key: "contract", label: "Contrat", done: false },
  { key: "workingHours", label: "Horaires de travail", done: false },
];

/** Checklist row that actually reflects whether the step is done — the list
 *  used to render every item with the same grey tick, so a staff member had
 *  no way to see which one was still blocking them. */
function StepRow({ label, done }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
        done
          ? "border-[#2f3a2e]/20 bg-[#2f3a2e]/5 dark:border-[#2f3a2e]/40 dark:bg-[#2f3a2e]/10"
          : "border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
      }`}
    >
      <Icon size={18} className={done ? "text-[#2f3a2e] dark:text-green-400" : "text-gray-400"} />
      <span
        className={`text-sm font-medium ${
          done
            ? "text-gray-500 line-through dark:text-gray-400"
            : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {label}
      </span>
      {done && <span className="ml-auto text-xs text-gray-400">Fait</span>}
    </div>
  );
}

export function OnboardingModal({ step, steps, onDismiss }) {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        // A dismissible step (Stripe) can be closed with Escape; a blocking
        // one swallows the key so the overlay can't be escaped past.
        if (onDismiss) {
          onDismiss();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onDismiss]);

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
            {(steps?.length ? steps : ACCOUNT_STEPS_FALLBACK).map((s) => (
              <StepRow key={s.key ?? s.label} label={s.label} done={s.done} />
            ))}
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
              Connectez votre compte Stripe pour recevoir vos paiements en ligne et vos commissions.
              Tant que ce n'est pas fait, seuls les paiements sur place vous sont attribués.
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
          <div className="mt-6 flex flex-col items-center gap-2">
            <button
              className="w-[230px] flex justify-center bg-primary text-white py-3 rounded-lg hover:bg-primary/90 focus:outline-none"
              onClick={() => router.push("/dashboard/payments/")}
            >
              Configurer Stripe
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded px-3 py-1.5 text-sm text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline focus:outline-none dark:text-gray-400 dark:hover:text-gray-200"
              >
                Plus tard
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
