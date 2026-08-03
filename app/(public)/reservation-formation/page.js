"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Calendar, CheckCircle } from "lucide-react";
import { useSession } from "next-auth/react";
import { checkFormationSessionAvailability, createFormationReservation } from "@/actions/formations/create-formation-reservation";
import { getPublicFormationById } from "@/actions/formations/get-public-formations";

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReservationFormationPage() {
  return (
    <Suspense fallback={null}>
      <ReservationFormationContent />
    </Suspense>
  );
}

function ReservationFormationContent() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  const formationId = searchParams.get("formation");
  const sessionId = searchParams.get("session");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formation, setFormation] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [available, setAvailable] = useState(0);
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("DEPOSIT");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const isPrivate = formation?.type === "PRIVATE";

  useEffect(() => {
    if (!formationId || !sessionId) {
      setLoading(false);
      return;
    }

    async function load() {
      const [formResult, availResult] = await Promise.all([
        getPublicFormationById(formationId),
        checkFormationSessionAvailability(sessionId),
      ]);

      if (!formResult.success || !formResult.data) {
        setError("Formation introuvable.");
        setLoading(false);
        return;
      }

      const sess = formResult.data.sessions?.find((s) => s.id === sessionId);
      if (!sess) {
        setError("Session introuvable.");
        setLoading(false);
        return;
      }

      setFormation(formResult.data);
      setSessionData(sess);

      if (availResult.success) {
        setAvailable(availResult.data.available);
      }

      if (formResult.data.type === "PRIVATE") {
        setSeats(1);
      }

      setLoading(false);
    }

    load();
  }, [formationId, sessionId]);

  useEffect(() => {
    if (session?.user) {
      setForm((prev) => ({
        fullName: session.user.name || prev.fullName,
        email: session.user.email || prev.email,
        phone: "",
      }));
    }
  }, [session]);

  const isFull = available <= 0;

  const depositPct = formation?.depositPercentage ?? 30;
  const unitPrice = Number(formation?.price || 0);
  const totalPrice = unitPrice * seats;
  const depositAmount = (totalPrice * depositPct) / 100;
  const balanceDue = totalPrice - depositAmount;
  const isFullPayment = paymentMethod === "FULL";
  const chargeAmount = isFullPayment ? totalPrice : depositAmount;
  const displayBalanceDue = isFullPayment ? 0 : balanceDue;

  const priceFormatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const maxSeats = Math.min(Math.max(1, available), 10);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    const result = await createFormationReservation({
      sessionId,
      formationId,
      seatsCount: isPrivate ? 1 : seats,
      customerInfo: form,
      paymentMethod,
    });

    if (result.success && result.url) {
      if (result.isNewUser) {
        sessionStorage.setItem("workshop_signin", JSON.stringify({
          email: result.email,
          password: result.temporaryPassword,
        }));
      }
      window.location.href = result.url;
    } else {
      if (result.field) {
        setFieldErrors({ [result.field]: result.message });
      } else {
        setError(result.message || "Erreur lors de la réservation.");
      }
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    );
  }

  if (!formation || !sessionData) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-cream gap-4">
        <p className="text-ink/50">{error || "Session non disponible."}</p>
        <Link href="/formations" className="text-sm text-gold hover:underline">
          Retour aux formations
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[800px] px-6 py-12 md:px-10 lg:py-16">
        <Link
          href={`/formations/${formationId}`}
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
        >
          <ArrowLeft size={16} />
          Retour à la formation
        </Link>

        <div className="mb-8">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold">
            {isPrivate ? "Formation privée" : "Formation groupe"}
          </span>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{formation.title}</h1>
        </div>

        {isFull ? (
          <div className="rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-ink">Cette session est complète</h2>
            <p className="text-sm text-ink/70 max-w-md mx-auto">
              Il n&apos;y a plus de place disponible pour cette session. Contactez le salon pour connaître les prochaines dates.
            </p>
            <div className="pt-4 flex justify-center gap-4">
              <Link
                href="/formations"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white shadow hover:bg-gold/90"
              >
                Voir d&apos;autres formations
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            {/* Form */}
            <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-6">
              {/* Seats selection — only for group formations */}
              {!isPrivate && (
                <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-sm font-semibold text-ink">Nombre de places</h2>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setSeats(Math.max(1, seats - 1))}
                      disabled={seats <= 1}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:bg-gold/10 hover:border-gold/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      −
                    </button>
                    <span className="min-w-[3ch] text-center text-xl font-bold text-ink">{seats}</span>
                    <button
                      type="button"
                      onClick={() => setSeats(Math.min(maxSeats, seats + 1))}
                      disabled={seats >= maxSeats}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:bg-gold/10 hover:border-gold/30 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                    <span className="text-xs text-ink/40">
                      max. {maxSeats} place{maxSeats > 1 ? "s" : ""} disponible{maxSeats > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* Payment method */}
              <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold text-ink">Mode de paiement</h2>
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("DEPOSIT")}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                      paymentMethod === "DEPOSIT" ? "border-gold bg-gold/5" : "border-ink/10 hover:border-ink/20"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-medium text-ink">Payer un acompte</span>
                      <span className="block text-xs text-ink/50">Payez l&apos;acompte maintenant et le reste sur place.</span>
                    </span>
                    <span className="text-sm font-semibold text-ink">{priceFormatted.format(depositAmount)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("FULL")}
                    className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                      paymentMethod === "FULL" ? "border-gold bg-gold/5" : "border-ink/10 hover:border-ink/20"
                    }`}
                  >
                    <span className="block text-sm font-medium text-ink">Payer le montant total</span>
                    <span className="text-sm font-semibold text-ink">{priceFormatted.format(totalPrice)}</span>
                  </button>
                </div>
              </div>

              {/* Non-refundable notice */}
              <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-800">
                ⚠️ L&apos;acompte et le solde ne sont remboursables en aucun cas, que vous participiez ou non à la formation.
              </div>

              {/* Customer info */}
              <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-ink">Vos coordonnées</h2>
                {isAuthed ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-gold/5 px-3 py-2.5">
                      <CheckCircle size={16} className="shrink-0 text-emerald-500" />
                      <span className="text-sm text-ink/70">
                        Connecté en tant que <strong>{form.email}</strong>
                      </span>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Nom</label>
                      <input
                        type="text"
                        value={form.fullName}
                        onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Téléphone</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setFieldErrors((p) => ({ ...p, phone: undefined })); }}
                        className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.phone ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                        placeholder="+32 4XX XX XX XX"
                      />
                      {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Nom complet *</label>
                      <input
                        type="text"
                        required
                        value={form.fullName}
                        onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/10"
                        placeholder="Votre nom"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Email *</label>
                      <input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => { setForm((p) => ({ ...p, email: e.target.value })); setFieldErrors((p) => ({ ...p, email: undefined })); }}
                        className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.email ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                        placeholder="votre@email.com"
                      />
                      {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Téléphone</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setFieldErrors((p) => ({ ...p, phone: undefined })); }}
                        className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.phone ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                        placeholder="+32 4XX XX XX XX"
                      />
                      {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
                    </div>
                    <p className="text-xs text-ink/40">Un compte sera créé automatiquement avec votre email.</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-gold py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gold/20 transition-all duration-200 hover:bg-gold/90 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    Réservation en cours…
                  </span>
                ) : isFullPayment ? (
                  `Payer le montant total de ${priceFormatted.format(totalPrice)}`
                ) : (
                  `Payer l'acompte de ${priceFormatted.format(depositAmount)}`
                )}
              </button>

              <p className="text-center text-xs text-ink/40">
                Paiement sécurisé par Stripe. {isFullPayment
                  ? "Vous réglez la totalité aujourd'hui."
                  : "Vous ne serez débité que du montant de l'acompte."}
              </p>
            </form>

            {/* Sidebar - Summary */}
            <div className="lg:col-span-2">
              <div className="sticky top-24 rounded-xl border border-ink/8 bg-white p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-ink">Récapitulatif</h2>

                <div className="flex items-start gap-3 text-sm">
                  <Calendar size={16} className="mt-0.5 shrink-0 text-gold" />
                  <div>
                    <p className="text-ink/80">{formatDate(sessionData.startDate)}</p>
                    <p className="text-xs text-ink/50">
                      {formatTime(sessionData.startDate)}
                      {sessionData.endDate && ` – ${formatTime(sessionData.endDate)}`}
                    </p>
                  </div>
                </div>

                <hr className="border-ink/8" />

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">
                      {unitPrice > 0
                        ? isPrivate
                          ? priceFormatted.format(unitPrice)
                          : `${priceFormatted.format(unitPrice)} × ${seats} place${seats > 1 ? "s" : ""}`
                        : "Gratuit"}
                    </span>
                    <span className="font-medium text-ink">{priceFormatted.format(totalPrice)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{isFullPayment ? "Montant total" : `Acompte (${depositPct}%)`}</span>
                    <span className="font-semibold text-gold">{priceFormatted.format(chargeAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">Solde à payer sur place</span>
                    <span className="text-ink">{priceFormatted.format(displayBalanceDue)}</span>
                  </div>
                </div>

                <hr className="border-ink/8" />

                <div className="rounded-lg bg-gold/5 px-3 py-2.5 text-xs leading-relaxed text-ink/60">
                  {isFullPayment ? (
                    <>Vous réglez aujourd&apos;hui la totalité, soit <strong className="text-gold">{priceFormatted.format(totalPrice)}</strong>. Aucun solde ne restera à payer.</>
                  ) : (
                    <>Vous ne réglez aujourd&apos;hui que <strong className="text-gold">{priceFormatted.format(depositAmount)}</strong>.
                    Le solde de <strong className="text-ink/80">{priceFormatted.format(balanceDue)}</strong> sera à payer sur place.</>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
