"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowLeft, Calendar, CheckCircle, Bell, AlertTriangle, BadgeCheck, BadgeX, ShieldQuestion } from "lucide-react";
import { useSession } from "next-auth/react";
import { checkFormationSessionAvailability, createFormationReservation } from "@/actions/formations/create-formation-reservation";
import { getPublicFormationById } from "@/actions/formations/get-public-formations";
import {
  joinFormationWaitingList,
  validateFormationWaitingListPriority,
  convertFormationWaitingListEntry,
} from "@/actions/formations/waiting-list";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { PromoCodeField } from "@/components/shared/PromoCodeField";
import { isDisposableEmail } from "@/lib/validations/customer-identity";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/lib/intl-locale";

function formatDate(dateStr, locale) {
  return new Date(dateStr).toLocaleDateString(toIntlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(dateStr, locale) {
  return new Date(dateStr).toLocaleTimeString(toIntlLocale(locale), {
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
  const t = useTranslations("activityReservation");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAuthed = !!session?.user;
  const callbackUrl = `${pathname}?${searchParams.toString()}`;

  const formationId = searchParams.get("formation");
  const sessionId = searchParams.get("session");
  const isPriority = searchParams.get("priority") === "true";
  const waitingListId = searchParams.get("wl");
  const wantsWaitingList = searchParams.get("waitingList") === "true";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formation, setFormation] = useState(null);
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
      setFieldErrors((p) => ({ ...p, vatNumber: t("vatRequired") }));
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
          ? t("vatActiveName", { name: result.name })
          : t("vatActive")
        : t("vatInvalid"),
    });
  }

  const [pendingVerificationEmail, setPendingVerificationEmail] = useState(null);

  // Waiting list state
  const [wlSuccess, setWlSuccess] = useState(null); // { position }
  const [priorityValid, setPriorityValid] = useState(false);
  const [priorityMessage, setPriorityMessage] = useState("");

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
        setError(t("notFoundFormation"));
        setLoading(false);
        return;
      }

      const sess = formResult.data.sessions?.find((s) => s.id === sessionId);
      if (!sess) {
        setError(t("sessionNotFound"));
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

      if (isPriority && waitingListId) {
        const priorityRes = await validateFormationWaitingListPriority(waitingListId);
        if (priorityRes.valid) {
          setPriorityValid(true);
        } else {
          setPriorityMessage(priorityRes.message || t("priorityLinkExpired"));
        }
      }

      setLoading(false);
    }

    load();
  }, [formationId, sessionId, isPriority, waitingListId]);

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

  const depositPct = formation?.depositPercentage ?? 50;
  const unitPrice = Number(formation?.price || 0);
  const totalPrice = unitPrice * seats;
  const discountAmount = appliedPromo?.discountAmount ?? 0;
  const discountedTotal = Math.max(0, totalPrice - discountAmount);
  const depositAmount = (discountedTotal * depositPct) / 100;
  const balanceDue = discountedTotal - depositAmount;
  const isFullPayment = paymentMethod === "FULL";
  const chargeAmount = isFullPayment ? discountedTotal : depositAmount;
  const displayBalanceDue = isFullPayment ? 0 : balanceDue;

  const priceFormatted = new Intl.NumberFormat(toIntlLocale(locale), { style: "currency", currency: "EUR" });
  const maxSeats = Math.min(Math.max(1, available), 10);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    if (!isAuthed && emailStatus === "exists") {
      setError(t("emailAlreadyExists"));
      return;
    }

    if (!isAuthed && isDisposableEmail(form.email)) {
      setFieldErrors({ email: t("disposableEmail") });
      return;
    }

    if (!acceptedTerms) {
      setError(t("acceptTermsRequired"));
      return;
    }

    setSubmitting(true);

    if (showWaitingListForm) {
      const result = await joinFormationWaitingList({
        sessionId,
        customerInfo: { ...form, seatsRequested: isPrivate ? 1 : seats },
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
          setError(result.message || t("wlSubmitError"));
        }
      }
      setSubmitting(false);
      return;
    }

    const result = await createFormationReservation({
      sessionId,
      formationId,
      seatsCount: isPrivate ? 1 : seats,
      customerInfo: form,
      paymentMethod,
      isPriority: priorityValid,
      waitingListEntryId: waitingListId,
      promoCode: appliedPromo?.code ?? null,
    });

    if (result.success && result.url) {
      if (waitingListId) {
        await convertFormationWaitingListEntry(waitingListId, result.reservationId);
      }

      window.location.href = result.url;
    } else if (result.success && result.requiresEmailVerification) {
      setPendingVerificationEmail(result.email);
      setSubmitting(false);
    } else {
      if (result.field) {
        setFieldErrors({ [result.field]: result.message });
      } else {
        setError(result.message || t("reservationError"));
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
        <p className="text-ink/50">{error || t("sessionUnavailable")}</p>
        <Link href="/formations" className="text-sm text-gold hover:underline">
          {t("backToFormation")}
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
        <h1 className="text-xl font-bold text-ink">{t("confirmEmailTitle")}</h1>
        <p className="max-w-md text-sm text-ink/60">
          {t("confirmEmailDesc", { email: pendingVerificationEmail })}
        </p>
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
          {t("backToFormation")}
        </Link>

        <div className="mb-8">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gold">
            {isPrivate ? t("typePrivate") : t("typeGroup")}
          </span>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{formation.title}</h1>

          {priorityValid && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              <span>{t("priorityPlace")}</span>
            </div>
          )}

          {priorityMessage && !priorityValid && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 border border-amber-200">
              <AlertTriangle size={16} className="text-amber-600 shrink-0" />
              <span>{priorityMessage}</span>
            </div>
          )}
        </div>

        {wlSuccess ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <Bell size={28} />
            </div>
            <h2 className="text-xl font-bold text-ink">{t("wlSuccessTitle")}</h2>
            <p className="text-sm text-ink/70 max-w-md mx-auto">
              {t("wlSuccessDesc", { position: wlSuccess.position })}
            </p>
            <div className="pt-4 flex justify-center gap-4">
              <Link
                href="/formations"
                className="rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-white shadow hover:bg-gold/90"
              >
                {t("seeOtherFormations")}
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
                  <h2 className="mb-4 text-sm font-semibold text-ink">{t("seatsTitle")}</h2>
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
                        ? t("seatsRequested")
                        : t("maxSeats", { count: maxSeats })}
                    </span>
                  </div>
                </div>
              )}

              {/* Payment method */}
              {!showWaitingListForm && (
                <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
                  <h2 className="mb-4 text-sm font-semibold text-ink">{t("paymentMethodTitle")}</h2>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("DEPOSIT")}
                      className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                        paymentMethod === "DEPOSIT" ? "border-gold bg-gold/5" : "border-ink/10 hover:border-ink/20"
                      }`}
                    >
                      <span>
                        <span className="block text-sm font-medium text-ink">{t("payDeposit")}</span>
                        <span className="block text-xs text-ink/50">{t("payDepositDescFormation")}</span>
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
                      <span className="block text-sm font-medium text-ink">{t("payFull")}</span>
                      <span className="text-sm font-semibold text-ink">{priceFormatted.format(totalPrice)}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Non-refundable notice */}
              {!showWaitingListForm && (
                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-800">
                  {t("nonRefundableNotice")}
                </div>
              )}

              {/* Customer info */}
              <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-ink">{t("customerTitle")}</h2>
                {isAuthed ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 rounded-lg bg-gold/5 px-3 py-2.5">
                      <CheckCircle size={16} className="shrink-0 text-emerald-500" />
                      <span className="text-sm text-ink/70">
                        {t("connectedAs")} <strong>{form.email}</strong>
                      </span>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("name")}</label>
                      <input
                        type="text"
                        value={form.fullName}
                        onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("phone")}</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setFieldErrors((p) => ({ ...p, phone: undefined })); }}
                        className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.phone ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                        placeholder={t("phonePlaceholder")}
                      />
                      {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("vatLabel")}</label>
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
                          {t("verify")}
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
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("fullName")}</label>
                      <input
                        type="text"
                        required
                        value={form.fullName}
                        onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="h-10 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-gold/50 focus:ring-2 focus:ring-gold/10"
                        placeholder={t("fullNamePlaceholder")}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("email")}</label>
                      <div className="relative">
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) => { setForm((p) => ({ ...p, email: e.target.value })); setFieldErrors((p) => ({ ...p, email: undefined })); setEmailStatus(null); }}
                          onBlur={handleEmailBlur}
                          className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.email || emailStatus === "exists" ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                          placeholder={t("emailPlaceholder")}
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
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("phone")}</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => { setForm((p) => ({ ...p, phone: e.target.value })); setFieldErrors((p) => ({ ...p, phone: undefined })); }}
                        className={`h-10 w-full rounded-lg border px-3 text-sm text-ink outline-none focus:ring-2 ${fieldErrors.phone ? "border-red-400 focus:border-red-400 focus:ring-red-100" : "border-ink/15 focus:border-gold/50 focus:ring-gold/10"}`}
                        placeholder={t("phonePlaceholder")}
                      />
                      {fieldErrors.phone && <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink/60">{t("vatLabel")}</label>
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
                          {t("verify")}
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
                    <p className="text-xs text-ink/40">{t("autoAccount")}</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
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
                  {t("acceptTerms", {
                    cgv: (
                      <a href="/cgv" target="_blank" rel="noopener noreferrer" className="underline hover:text-gold">
                        {t("cgv")}
                      </a>
                    ),
                    privacy: (
                      <a href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className="underline hover:text-gold">
                        {t("privacy")}
                      </a>
                    ),
                  })}
                </span>
              </label>

              {showWaitingListForm ? (
                <button
                  type="submit"
                  disabled={submitting || !acceptedTerms}
                  className="w-full rounded-full bg-amber-600 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-amber-600/20 transition-all duration-200 hover:bg-amber-700 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      {t("wlSubmitting")}
                    </span>
                  ) : (
                    t("wlSubmit")
                  )}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !acceptedTerms}
                  className="w-full rounded-full bg-gold py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-gold/20 transition-all duration-200 hover:bg-gold/90 hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={18} className="animate-spin" />
                      {t("reserving")}
                    </span>
                  ) : isFullPayment ? (
                    t("payFullAmount", { amount: priceFormatted.format(totalPrice) })
                  ) : (
                    t("payDepositAmount", { amount: priceFormatted.format(depositAmount) })
                  )}
                </button>
              )}

              {!showWaitingListForm && (
                <p className="text-center text-xs text-ink/40">
                  {t("secureFooterPrefix")} {isFullPayment
                    ? t("secureFull")
                    : t("secureDeposit")}
                </p>
              )}
            </form>

            {/* Sidebar - Summary */}
            <div className="lg:col-span-2">
              <div className="sticky top-24 rounded-xl border border-ink/8 bg-white p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold text-ink">{t("summary")}</h2>

                <div className="flex items-start gap-3 text-sm">
                  <Calendar size={16} className="mt-0.5 shrink-0 text-gold" />
                  <div>
                    <p className="text-ink/80">{formatDate(sessionData.startDate, locale)}</p>
                    <p className="text-xs text-ink/50">
                      {formatTime(sessionData.startDate, locale)}
                      {sessionData.endDate && ` – ${formatTime(sessionData.endDate, locale)}`}
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
                          : t("perPlace", { price: priceFormatted.format(unitPrice), count: seats })
                        : t("free")}
                    </span>
                    <span className="font-medium text-ink">{priceFormatted.format(totalPrice)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex items-center justify-between text-sm text-emerald-600">
                      <span>{t("discount", { code: appliedPromo.code })}</span>
                      <span>-{priceFormatted.format(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{isFullPayment ? t("totalAmount") : t("depositPct", { pct: depositPct })}</span>
                    <span className="font-semibold text-gold">{priceFormatted.format(chargeAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink/60">{t("balanceOnSite")}</span>
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
                    <>{t("payTodayFull", { amount: priceFormatted.format(discountedTotal) })}</>
                  ) : (
                    <>{t("payTodayDeposit", { deposit: priceFormatted.format(depositAmount), balance: priceFormatted.format(balanceDue) })}</>
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
