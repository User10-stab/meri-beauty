"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

export default function ReservationAtelierSuccesPage() {
  return (
    <Suspense fallback={null}>
      <ReservationAtelierSuccesContent />
    </Suspense>
  );
}

function ReservationAtelierSuccesContent() {
  const searchParams = useSearchParams();
  const reservationId = searchParams.get("reservation_id");
  const [status, setStatus] = useState("loading");
  const [reservation, setReservation] = useState(null);

  useEffect(() => {
    if (!reservationId) {
      setStatus("error");
      return;
    }

    // Fetch reservation details. The webhook that confirms payment runs
    // asynchronously and can lag a few seconds behind the Stripe redirect,
    // so poll briefly for PENDING_DEPOSIT -> CONFIRMED before giving up —
    // otherwise a real, successful payment could flash a false "pending"
    // state, and (worse) an abandoned/unpaid checkout would need to be
    // distinguishable from a confirmed one at all.
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    async function fetchReservation() {
      try {
        const res = await fetch(`/api/workshop-reservations/${reservationId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (cancelled) return;
        setReservation(data);

        if (data.status === "PENDING_DEPOSIT" && attempts < MAX_ATTEMPTS) {
          attempts += 1;
          setTimeout(fetchReservation, 2000);
          return;
        }
        setStatus("done");
      } catch {
        if (!cancelled) setStatus("done");
      }
    }

    fetchReservation();
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  const r = reservation;
  const isConfirmed = r?.status === "CONFIRMED" || r?.status === "COMPLETED";
  const isStillPending = r?.status === "PENDING_DEPOSIT";
  const depositFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.depositAmount));
  const totalFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.totalPrice));
  const balanceFormatted = r && new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(r.balanceDue));

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[600px] px-6 py-20 text-center md:px-10 lg:py-28">
        <div
          className={`mb-6 inline-flex h-16 w-16 items-center justify-center rounded-full ${
            isStillPending ? "bg-amber-100" : "bg-emerald-100"
          }`}
        >
          {isStillPending ? (
            <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8 text-emerald-600">
              <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        <h1 className="text-2xl font-bold text-ink sm:text-3xl">
          {isStillPending ? "Confirmation en cours..." : isConfirmed ? "Réservation confirmée !" : "Réservation introuvable"}
        </h1>
        <p className="mt-3 text-ink/60">
          {isStillPending && "Nous attendons la confirmation de votre paiement. Cela peut prendre quelques instants — vous recevrez un email dès que ce sera confirmé."}
          {isConfirmed && (
            <>
              Votre réservation a bien été prise en compte.
              <span className="font-medium"> Un email de confirmation vous a été envoyé.</span>
            </>
          )}
          {!r && "Nous n'avons pas pu retrouver votre réservation. Si le paiement a été débité, contactez-nous."}
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
