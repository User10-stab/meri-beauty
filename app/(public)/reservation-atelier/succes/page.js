"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function ReservationAtelierSuccesPage() {
  const searchParams = useSearchParams();
  const reservationId = searchParams.get("reservation_id");
  const [status, setStatus] = useState("loading");
  const [reservation, setReservation] = useState(null);

  useEffect(() => {
    if (!reservationId) {
      setStatus("error");
      return;
    }

    // Auto-login if credentials stored before Stripe redirect
    const stored = sessionStorage.getItem("workshop_signin");
    if (stored) {
      sessionStorage.removeItem("workshop_signin");
      const { email, password } = JSON.parse(stored);
      signIn("credentials", { email, password, redirect: false }).catch(() => {});
    }

    // Fetch reservation details
    async function fetchReservation() {
      try {
        const res = await fetch(`/api/workshop-reservations/${reservationId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setReservation(data);
        setStatus("success");
      } catch {
        setStatus("success");
      }
    }

    fetchReservation();
  }, [reservationId]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  const r = reservation;
  const depositFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.depositAmount));
  const totalFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.totalPrice));
  const balanceFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.balanceDue));

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[600px] px-6 py-20 text-center md:px-10 lg:py-28">
        <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8 text-emerald-600">
            <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-ink sm:text-3xl">
          Réservation confirmée !
        </h1>
        <p className="mt-3 text-ink/60">
          Votre réservation a bien été prise en compte.
          {r && <span className="font-medium"> Un email de confirmation vous a été envoyé.</span>}
        </p>

        {r && (
          <div className="mx-auto mt-8 max-w-sm rounded-xl border border-ink/8 bg-white p-6 text-left shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-ink">Récapitulatif</h2>
            <div className="space-y-2 text-sm">
              <p className="text-ink/80 font-medium">{r.session?.workshop?.title || "Atelier"}</p>
              <p className="text-xs text-ink/50">
                {new Date(r.session?.startDate).toLocaleDateString("fr-FR", {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </p>
              <hr className="border-ink/8" />
              <div className="flex justify-between">
                <span className="text-ink/60">Places</span>
                <span className="font-medium">{r.seatsCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Total</span>
                <span className="font-medium">{totalFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Payé aujourd&apos;hui</span>
                <span className="font-semibold text-gold">{depositFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/60">Solde restant</span>
                <span>{balanceFormatted}</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href="/evenements"
            className="inline-flex items-center gap-2 rounded-full bg-gold px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-gold/20 transition-all hover:bg-gold/90"
          >
            Voir d&apos;autres activités
          </Link>
          <Link
            href="/"
            className="text-sm text-ink/50 transition-colors hover:text-gold"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
