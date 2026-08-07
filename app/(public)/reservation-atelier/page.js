"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Calendar, Clock, Users, Euro, CheckCircle, Bell, AlertTriangle, BadgeCheck, BadgeX, ShieldQuestion } from "lucide-react";
import { useSession } from "next-auth/react";
import { checkWorkshopSessionAvailability, createWorkshopReservation } from "@/actions/workshops/create-workshop-reservation";
import { getPublicActivityById } from "@/actions/workshops/get-public-activities";
import { joinWaitingList, validateWaitingListPriority, convertWaitingListEntry } from "@/actions/workshops/waiting-list";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { PromoCodeField } from "@/components/shared/PromoCodeField";

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

export default function ReservationAtelierPage() {
  return (
    <Suspense fallback={null}>
      <ReservationAtelierContent />
    </Suspense>
  );
}

function ReservationAtelierContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;
  const callbackUrl = `${pathname}?${searchParams.toString()}`;

  const activityId = searchParams.get("activity");
  const sessionId = searchParams.get("session");
  const isPriority = searchParams.get("priority") === "true";
  const waitingListId = searchParams.get("wl");
  const wantsWaitingList = searchParams.get("waitingList") === "true";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activity, setActivity] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [available, setAvailable] = useState(0);
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("DEPOSIT");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", vatNumber: "" });
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [vatCheck, setVatCheck] = useState(null); // { loading } | { valid, message } | { error, message }
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // null = not checked yet | "exists" = verified account found | "dismissed" = user chose to continue as guest
  const [emailStatus, setEmailStatus] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);

  async function handleEmailBlur() {
    const email = form.email.trim();
    if (!email || !email.includes("@")) return;

    setCheckingEmail(true);
    try {
      const result = await checkEmailExists(email);
      if (result.exists) setEmailStatus("exists");
    } catch {
      // Non-critical — silently ignore, the person can still proceed
    } finally {
      setCheckingEmail(false);
    }
  }

  async function handleVerifyVat() {
    if (!form.vatNumber.trim()) {
      setFieldErrors((p) => ({ ...p, vatNumber: "Renseignez d'abord un numéro de TVA." }));
      return;
    }
    setVatCheck({ loading: true });
    const result = await verifyVatNumber(form.vatNumber);
    if (!result.success) {
      setVatCheck({ error: true, message: result.message });
      return;
    }
    setVatCheck({
      valid: result.valid,
      message: result.valid
        ? result.name
          ? `Actif — enregistré au nom de « ${result.name} ».`
          : "Actif dans le registre VIES."
        : "Ce numéro n'est pas reconnu par le registre européen VIES.",
    });
  }

  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);

  // Waiting list state
  const [wlSuccess, setWlSuccess] = useState(null); // { position }
  const [priorityValid, setPriorityValid] = useState(false);
  const [priorityMessage, setPriorityMessage] = useState("");

  useEffect(() => {
    if (!activityId || !sessionId) {
      setLoading(false);
      return;
    }

    async function load() {
      const [actResult, availResult] = await Promise.all([
        getPublicActivityById(activityId),
        checkWorkshopSessionAvailability(sessionId),
      ]);

      if (!actResult.success || !actResult.data) {
        setError("Activité introuvable.");
        setLoading(false);
        return;
      }

      const sess = actResult.data.sessions?.find((s) => s.id === sessionId);
      if (!sess) {
        setError("Session introuvable.");
        setLoading(false);
        return;
      }

      setActivity(actResult.data);
      setSessionData(sess);

      if (availResult.success) {
        setAvailable(availResult.data.available);
      }

      // Check priority token if present
      if (isPriority && waitingListId) {
        const priorityRes = await validateWaitingListPriority(waitingListId);
        if (priorityRes.valid) {
          setPriorityValid(true);
        } else {
          setPriorityMessage(priorityRes.message || "Lien d'accès prioritaire expiré ou invalide.");
        }
      }

      setLoading(false);
    }

    load();
  }, [activityId, sessionId, isPriority, waitingListId]);

  useEffect(() => {
    if (session?.user) {
      setForm((prev) => ({
        ...prev,
        fullName: session.user.name || prev.fullName,
        email: session.user.email || prev.email,
        phone: "",
      }));
    }
  }, [session]);

  const isFull = available <= 0 && !priorityValid;
  const showWaitingListForm = (isFull || wantsWaitingList) && !priorityValid;

  const depositPct = activity?.depositPercentage ?? 50;
  const unitPrice = Number(activity?.price || 0);
  const totalPrice = unitPrice * seats;
  const discountAmount = appliedPromo?.discountAmount ?? 0;
  const discountedTotal = Math.max(0, totalPrice - discountAmount);
  const depositAmount = (discountedTotal * depositPct) / 100;
  const balanceDue = discountedTotal - depositAmount;
  const isFullPayment = paymentMethod === "FULL";
  const chargeAmount = isFullPayment ? discountedTotal : depositAmount;
  const displayBalanceDue = isFullPayment ? 0 : balanceDue;

  const priceFormatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
  const maxSeats = Math.min(Math.max(1, available), 10);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (!isAuthed && emailStatus === "exists") {
      setError("Cette adresse email est déjà associée à un compte. Connectez-vous ou cliquez sur « Continuer quand même ».");
      return;
    }

    if (!acceptedTerms) {
      setError("Veuillez accepter les CGV et la politique de confidentialité.");
      return;
    }

    setSubmitting(true);

    if (showWaitingListForm) {
      // Submit to Waiting List
      const result = await joinWaitingList({
        sessionId,
        customerInfo: { ...form, seatsRequested: seats },
      });

      if (result.success) {
        if (result.isNewUser) {
          sessionStorage.setItem("workshop_signin", JSON.stringify({
            email: result.email,
            password: result.temporaryPassword,
          }));
        }
        setWlSuccess({ position: result.position });
      } else {
        if (result.field) {
          setFieldErrors({ [result.field]: result.message });
        } else {
          setError(result.message || "Erreur lors de l'inscription à la liste d'attente.");
        }
      }
      setSubmitting(false);
      return;
    }

    // Standard reservation submission
    const result = await createWorkshopReservation({
      sessionId,
      activityId,
      seatsCount: seats,
      customerInfo: form,
      isPriority: priorityValid,
      waitingListEntryId: waitingListId,
      paymentMethod,
      promoCode: appliedPromo?.code ?? null,
    });

    if (result.success && result.url) {
      if (waitingListId) {
        await convertWaitingListEntry(waitingListId, result.reservationId);
      }

      window.location.href = result.url;
    } else if (result.success && result.requiresEmailVerification) {
      setPendingVerificationEmail(result.email);
      setSubmitting(false);
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

  if (!activity || !sessionData) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-cream gap-4">
        <p className="text-ink/50">{error || "Session non disponible."}</p>
        <Link href="/evenements" className="text-sm text-gold hover:underline">
          Retour aux activités
        </Link>
      </div>
    );
  }

  if (pendingVerificationEmail) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-cream gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold/10 text-gold">
          <CheckCircle size={28} />
        </div>
        <h1 className="text-xl font-bold text-ink">Confirmez votre email</h1>
        <p className="max-w-md text-sm text-ink/60">
          Nous avons envoyé un email de confirmation à <strong>{pendingVerificationEmail}</strong>. Une fois confirmée,
          vous recevrez vos identifiants de connexion par email et pourrez finaliser votre paiement.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[800px] px-6 py-12 md:px-10 lg:py-16">
        {/* Back link */}
        <Link
          href={`/evenements/${activityId}`}
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-ink/50 transition-colors hover:text-gold"
        >
          <ArrowLeft size={16} />
          Retour à l&apos;activité
        </Link>

        {/* Header */}
        <div className="mb-8">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold">
            {activity.type === "WORKSHOP" ? "Atelier" : "Événement"}
          </span>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{activity.title}</h1>

          {/* Priority Access Badge */}
          {priorityValid && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <span>Une place s&apos;est libérée ! Finalisez votre réservation rapidement : elle sera attribuée à la première personne qui réserve.</span>
            </div>
          )}

          {priorityMessage && !priorityValid && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 border border-amber-200">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span>{priorityMessage}</span>
            </div>
          )}
        </div>

        {/* Waiting list success state */}
        {wlSuccess ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Bell size={28} />
            </div>
            <h2 className="text-xl font-bold text-ink">Vous êtes inscrit(e) sur la liste d&apos;attente !</h2>
            <p className="text-sm text-ink/70 max-w-md mx-auto">
              Vous êtes en <strong className="text-gold font-bold">position #{wlSuccess.position}</strong> sur la liste d&apos;attente.
              Dès qu&apos;une place se libère, un email sera envoyé à toutes les personnes inscrites. La place sera attribuée à la première personne qui finalise sa réservation — soyez rapide !
            </p>
            <div className="pt-4 flex justify-center gap-4">
              <Link
                href="/evenements"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white shadow hover:bg-gold/90"
              >
                Découvrir d&apos;autres activités
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
            {/* Form */}
            <form onSubmit={handleSubmit} className="lg:col-span-3 space-y-6">
              {/* Seats selection */}
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
                    disabled={seats >= maxSeats || isFull}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:bg-gold/10 hover:border-gold/30 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                  <span className="text-xs text-ink/40">
                    {showWaitingListForm
                      ? "Places demandées"
                      : available > 0
                      ? `max. ${maxSeats} place${maxSeats > 1 ? "s" : ""} disponible${maxSeats > 1 ? "s" : ""}`
                      : "Complet"}
                  </span>
                </div>
              </div>

              {/* Payment method */}
              {!showWaitingListForm && (
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
                        <span className="block text-xs text-ink/50">Payez l&apos;acompte maintenant et le reste plus tard.</span>
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
              )}

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
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Numéro de TVA (optionnel)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={form.vatNumber}
                          onChange={(e) => {
                            setForm((p) => ({ ...p, vatNumber: e.target.value }));
                            setFieldErrors((p) => ({ ...p, vatNumber: undefined }));
                            setVatCheck(null);
                          }}
                          className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.vatNumber ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                          placeholder="BE0123456789"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyVat}
                          disabled={vatCheck?.loading}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/15 px-3 text-xs font-semibold text-ink/60 transition-colors hover:border-gold hover:text-ink disabled:opacity-50"
                        >
                          {vatCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
                          Vérifier
                        </button>
                      </div>
                      {fieldErrors.vatNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.vatNumber}</p>}
                      {vatCheck && !vatCheck.loading && (
                        <p
                          className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${
                            vatCheck.error ? "text-amber-600" : vatCheck.valid ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {vatCheck.error ? (
                            <ShieldQuestion className="h-3.5 w-3.5 shrink-0" />
                          ) : vatCheck.valid ? (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <BadgeX className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {vatCheck.message}
                        </p>
                      )}
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
                      <div className="relative">
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) => { setForm((p) => ({ ...p, email: e.target.value })); setFieldErrors((p) => ({ ...p, email: undefined })); setEmailStatus(null); }}
                          onBlur={handleEmailBlur}
                          className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.email || emailStatus === "exists" ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                          placeholder="votre@email.com"
                        />
                        {checkingEmail && (
                          <div className="absolute inset-y-0 right-3 flex items-center">
                            <Loader2 className="h-4 w-4 animate-spin text-ink/30" />
                          </div>
                        )}
                      </div>
                      {fieldErrors.email && <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>}
                      {emailStatus === "exists" && (
                        <div className="mt-3">
                          <ExistingAccountBanner
                            email={form.email}
                            callbackUrl={callbackUrl}
                            onDismiss={() => setEmailStatus("dismissed")}
                          />
                        </div>
                      )}
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
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">Numéro de TVA (optionnel)</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={form.vatNumber}
                          onChange={(e) => {
                            setForm((p) => ({ ...p, vatNumber: e.target.value }));
                            setFieldErrors((p) => ({ ...p, vatNumber: undefined }));
                            setVatCheck(null);
                          }}
                          className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.vatNumber ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                          placeholder="BE0123456789"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyVat}
                          disabled={vatCheck?.loading}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink/15 px-3 text-xs font-semibold text-ink/60 transition-colors hover:border-gold hover:text-ink disabled:opacity-50"
                        >
                          {vatCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
                          Vérifier
                        </button>
                      </div>
                      {fieldErrors.vatNumber && <p className="mt-1 text-xs text-red-600">{fieldErrors.vatNumber}</p>}
                      {vatCheck && !vatCheck.loading && (
                        <p
                          className={`mt-1 flex items-center gap-1.5 text-xs font-medium ${
                            vatCheck.error ? "text-amber-600" : vatCheck.valid ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {vatCheck.error ? (
                            <ShieldQuestion className="h-3.5 w-3.5 shrink-0" />
                          ) : vatCheck.valid ? (
                            <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <BadgeX className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {vatCheck.message}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-ink/40">Un compte sera créé automatiquement avec votre email.</p>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* Terms acceptance */}
              <label className="flex items-start gap-2.5 text-xs text-ink/60">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  J&apos;ai lu et j&apos;accepte les{" "}
                  <a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-gold">
                    Conditions générales de vente
                  </a>{" "}
                  et la{" "}
                  <a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-gold">
                    Politique de confidentialité
                  </a>
                  .
                </span>
              </label>

              {/* Submit Button */}
              {showWaitingListForm ? (
                <button
                  type="submit"
                  disabled={submitting || !acceptedTerms}
                  className="w-full rounded-full bg-amber-600 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-amber-600/20 transition-all duration-200 hover:bg-amber-700 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      Inscription en cours…
                    </span>
                  ) : (
                    "S'inscrire à la liste d'attente"
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !acceptedTerms || (available <= 0 && !priorityValid)}
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
              )}

              {!showWaitingListForm && (
                <p className="text-center text-xs text-ink/40">
                  Paiement sécurisé par Stripe. {isFullPayment
                    ? "Vous réglez la totalité aujourd'hui."
                    : "Vous ne serez débité que du montant de l'acompte."}
                </p>
              )}
            </form>

            {/* Sidebar - Summary */}
            <div className="lg:col-span-2">
              <div className="sticky top-24 rounded-xl border border-ink/8 bg-white p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-ink">Récapitulatif</h2>

                {/* Date/Time */}
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

                {/* Pricing */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{unitPrice > 0 ? `${priceFormatted.format(unitPrice)} × ${seats} place${seats > 1 ? "s" : ""}` : "Gratuit"}</span>
                    <span className="font-medium text-ink">{priceFormatted.format(totalPrice)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex items-center justify-between text-sm text-emerald-600">
                      <span>Réduction ({appliedPromo.code})</span>
                      <span>-{priceFormatted.format(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{isFullPayment ? "Montant total" : `Acompte (${depositPct}%)`}</span>
                    <span className="font-semibold text-gold">{priceFormatted.format(chargeAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">Solde à payer sur place</span>
                    <span className="text-ink">{priceFormatted.format(displayBalanceDue)}</span>
                  </div>
                </div>

                {unitPrice > 0 && (
                  <>
                    <hr className="border-ink/8" />
                    <PromoCodeField subtotal={totalPrice} onApplied={setAppliedPromo} />
                  </>
                )}

                <hr className="border-ink/8" />

                <div className="rounded-lg bg-gold/5 px-3 py-2.5 text-xs leading-relaxed text-ink/60">
                  {isFullPayment ? (
                    <>Vous réglez aujourd&apos;hui la totalité, soit <strong className="text-gold">{priceFormatted.format(discountedTotal)}</strong>. Aucun solde ne restera à payer.</>
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
