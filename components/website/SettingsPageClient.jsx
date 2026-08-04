"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail, Loader2 } from "lucide-react";
import { updateNewsletterPreference } from "@/actions/customer/settings";

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-60 ${
        checked ? "bg-gold" : "bg-ink/15"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export function SettingsPageClient({ initialNewsletterSubscribed }) {
  const [subscribed, setSubscribed] = useState(initialNewsletterSubscribed);
  const [isPending, startTransition] = useTransition();

  function handleToggle(next) {
    setSubscribed(next);
    startTransition(async () => {
      const result = await updateNewsletterPreference(next);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
        setSubscribed(!next);
      }
    });
  }

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[1000px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon compte</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Paramètres
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[640px] px-6 py-12 md:px-10">
          <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-bold text-ink">Newsletter</p>
                  <p className="mt-0.5 text-xs text-ink/50">
                    Recevez nos actualités, offres et nouveautés par email.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isPending && <Loader2 className="h-4 w-4 animate-spin text-ink/30" />}
                <Toggle checked={subscribed} onChange={handleToggle} disabled={isPending} />
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-ink/40">
            Pour modifier votre nom, email, téléphone ou mot de passe, rendez-vous sur{" "}
            <a href="/profile" className="font-semibold text-gold hover:underline">
              votre profil
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}
