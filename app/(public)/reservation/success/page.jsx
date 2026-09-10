"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

export default function ReservationSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("reservationSuccess");
  const origin = searchParams.get("origin") || "/reservation";

  useEffect(() => {
    toast.success(t("confirmedTitle") || "Votre réservation a été créée avec succès !");
  }, [t]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-[#ede5d8]/70 bg-white p-8 text-center shadow-[0_8px_28px_rgba(47,58,46,0.06)]">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
          <CheckCircle2 size={32} className="text-emerald-600" />
        </div>
        <h1 className="font-display text-xl font-semibold text-[#2F3A2E]">
          Paiement confirmé
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#6f6a64]">
          Votre paiement a été effectué avec succès et votre réservation est confirmée. Un e-mail de confirmation vous a été envoyé.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => router.push(origin)}
            className="w-full rounded-full bg-[#b89664] px-6 py-3 text-sm font-semibold text-white hover:bg-[#a38353]"
          >
            Continuer
          </button>
        </div>
      </div>
    </div>
  );
}
