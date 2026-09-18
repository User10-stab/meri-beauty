"use client";

import { useState } from "react";
import { User, Mail, Phone, Lock, Eye, EyeOff, Loader2, MailCheck, LogIn } from "lucide-react";
import { toast } from "sonner";
import { signIn, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { initCustomerVerification } from "@/actions/reservation/init-customer-verification";
import { resendVerificationEmail } from "@/actions/auth/verify-email";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { isDisposableEmail } from "@/lib/validations/customer-identity";
import { getVatCountryCode, isValidVatFormat, viesPrefixForCountry } from "@/lib/vat-validation";
import countriesData from "@/data/countries.json";
import { useTranslations } from "next-intl";
import CardBotanicalSprigs from "@/components/reservation/CardBotanicalSprigs";
import StepBackArrow from "@/components/reservation/StepBackArrow";
import { CountrySelect } from "@/components/shared/CountrySelect";
import { savePendingReservation } from "@/lib/reservation-pending";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?\d[\d\s().-]*$/;

const INPUT_BASE =
  "w-full rounded-full border bg-white py-2.5 pl-10 pr-4 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:outline-none focus:ring-2";
const INPUT_OK = "border-[#ede5d8] focus:border-[#2F3A2E] focus:ring-[#2F3A2E]/10";
const INPUT_ERROR = "border-red-400 focus:border-red-400 focus:ring-red-100";

function inputClass(hasError) {
  return `${INPUT_BASE} ${hasError ? INPUT_ERROR : INPUT_OK}`;
}

const ADDRESS_INPUT_BASE =
  "w-full rounded-full border bg-white px-4 py-2.5 text-sm text-[#2F3A2E] placeholder:text-[#9a9590] transition-all focus:outline-none focus:ring-2";

function addressInputClass(hasError) {
  return `${ADDRESS_INPUT_BASE} ${hasError ? INPUT_ERROR : INPUT_OK}`;
}

function Field({ label, htmlFor, required, error, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wide text-[#2F3A2E]">
        {label} {required && <span className="text-[#b89664]">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs leading-relaxed text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function InputIcon({ children }) {
  return <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#9a9590]">{children}</div>;
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
      {message}
    </div>
  );
}

const FOCUS_ORDER = ["fullName", "email", "phone", "password", "companyLegalName", "vatNumber", "addressLine1", "addressPostalCode", "addressCity"];

function focusFirstError(errs) {
  for (const id of FOCUS_ORDER) {
    if (!errs[id]) continue;
    const el = document.getElementById(id);
    if (el && el.type !== "hidden") {
      el.focus();
      return;
    }
  }
}

function clearKey(setter, key) {
  setter((prev) => {
    if (!prev[key]) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

// Country codes drive VAT validation while the form stores localized names
// ("Belgique") — resolve either shape to a 2-letter code.
function resolveCountryCode(value) {
  const raw = String(value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const match = countriesData.find((c) => c.name?.toLowerCase() === raw.toLowerCase());
  return match?.code ?? null;
}

export default function CustomerInfoStep({ data, updateData, nextStep, prevStep, returnTo = "/reservation" }) {
  const t = useTranslations("reservationSteps");
  const router = useRouter();
  const [mode, setMode] = useState("register");
  const [formData, setFormData] = useState(
    data.customerInfo ?? {
      fullName: "",
      email: "",
      phone: "",
      password: "",
      newsletterSubscribed: false,
      isCompany: false,
      companyLegalName: "",
      vatNumber: "",
      addressLine1: "",
      addressLine2: "",
      addressCity: "",
      addressPostalCode: "",
      addressCountry: "Belgique",
    }
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  // Set once the verification email is on its way: the form swaps to a
  // waiting card explaining the one-click return (no second button).
  const [verificationSent, setVerificationSent] = useState(null);
  const [resending, setResending] = useState(false);

  // Login mode (existing account): email + password only.
  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [loginErrors, setLoginErrors] = useState({});
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginHelpVisible, setLoginHelpVisible] = useState(false);
  const [loginResending, setLoginResending] = useState(false);
  const [loginResent, setLoginResent] = useState(false);
  // Unknown email at login: point at registration instead of the
  // forgot-password detour.
  const [loginNoAccount, setLoginNoAccount] = useState(false);
  // Live VIES check state for the entreprise VAT field.
  const [vatCheck, setVatCheck] = useState(null);

  const isCompany = Boolean(formData.isCompany);

  const goToLogin = () => {
    setMode("login");
    setErrors({});
    setFormError(null);
    setLoginErrors({});
    setLoginHelpVisible(false);
    setLoginNoAccount(false);
    setLoginResent(false);
    setLoginData((prev) => ({
      ...prev,
      email: prev.email || formData.email || "",
    }));
  };

  const goToRegister = () => {
    setMode("register");
    setLoginErrors({});
    setFormError(null);
    setLoginHelpVisible(false);
    setLoginNoAccount(false);
    // Carry the typed email over so nothing has to be re-entered.
    const typedEmail = loginData.email.trim();
    if (typedEmail) {
      setFormData((prev) => (prev.email ? prev : { ...prev, email: typedEmail }));
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    clearKey(setErrors, name);
    if (name === "vatNumber" || name === "addressCountry") setVatCheck(null);
    if (formError) setFormError(null);
    if (name === "email") setEmailStatus(null);
  };

  const handleLoginChange = (e) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value }));
    clearKey(setLoginErrors, name);
    if (loginNoAccount) setLoginNoAccount(false);
    if (formError) setFormError(null);
  };

  const handleEmailBlur = async () => {
    const email = formData.email.trim();
    if (!email || !EMAIL_RE.test(email)) return;
    setCheckingEmail(true);
    try {
      const result = await checkEmailExists(email);
      if (result.exists) setEmailStatus("exists");
    } catch {}
    finally { setCheckingEmail(false); }
  };

  const validateRegister = () => {
    const errs = {};
    const fullName = formData.fullName.trim();
    const email = formData.email.trim();
    const phone = formData.phone.trim();
    if (!fullName) errs.fullName = t("customer.errorFullNameRequired");
    if (!email) errs.email = t("customer.errorEmailRequired");
    else if (!EMAIL_RE.test(email)) errs.email = t("customer.errorEmailInvalid");
    else if (isDisposableEmail(email)) errs.email = t("customer.disposableEmail");
    if (!phone) errs.phone = t("customer.errorPhoneRequired");
    else if (phone.length < 8 || !PHONE_RE.test(phone)) errs.phone = t("customer.errorPhoneInvalid");
    if (!formData.password) errs.password = t("customer.errorPasswordRequired");
    else if (formData.password.length < 8) errs.password = t("customer.errorPasswordShort");
    if (isCompany) {
      if (!formData.companyLegalName?.trim()) errs.companyLegalName = t("customer.errorLegalNameRequired");
      const vat = formData.vatNumber?.trim() ?? "";
      if (!vat) errs.vatNumber = t("customer.errorVatRequired");
      else {
        // Same offline rules as signup (refineCompanyVat): EU prefix, valid
        // format, matching billing country. Live VIES proof is refreshable
        // later from the profile/checkout — format errors stop here.
        const countryCode = resolveCountryCode(formData.addressCountry);
        const expectedPrefix = countryCode ? viesPrefixForCountry(countryCode) : null;
        if (!expectedPrefix) errs.vatNumber = t("customer.errorVatNotEu");
        else if (!isValidVatFormat(vat)) errs.vatNumber = t("customer.errorVatInvalid");
        else if (getVatCountryCode(vat) !== expectedPrefix) {
          errs.vatNumber = t("customer.errorVatCountryMismatch", { code: expectedPrefix });
        }
      }
      if (!formData.addressLine1?.trim()) errs.addressLine1 = t("customer.errorAddressRequired");
      if (!formData.addressPostalCode?.trim()) errs.addressPostalCode = t("customer.errorPostalRequired");
      if (!formData.addressCity?.trim()) errs.addressCity = t("customer.errorCityRequired");
      if (!formData.addressCountry?.trim()) errs.addressCountry = t("customer.errorCountryRequired");
    }
    return errs;
  };

  const handleVatVerify = async () => {
    const vat = formData.vatNumber?.trim() ?? "";
    if (!vat) {
      setErrors((prev) => ({ ...prev, vatNumber: t("customer.errorVatRequired") }));
      return;
    }
    setVatCheck({ loading: true });
    try {
      const result = await verifyVatNumber(vat);
      if (!result.success) {
        setVatCheck({ error: true, message: result.message });
        return;
      }
      setVatCheck({
        valid: result.valid,
        message: result.valid
          ? result.name
            ? `${t("customer.vatValid")} ${result.name}`
            : t("customer.vatValid")
          : t("customer.vatInvalid"),
      });
    } catch {
      setVatCheck({ error: true, message: t("customer.genericError") });
    }
  };

  const mapServerFieldError = (field) => {
    switch (field) {
      case "fullName":
        return { field, message: t("customer.errorFullNameRequired") };
      case "email":
        return { field, message: t("customer.errorEmailInvalid") };
      case "phone":
        return { field, message: t("customer.errorPhoneInvalid") };
      case "password":
        return { field, message: t("customer.errorPasswordShort") };
      case "companyLegalName":
        return { field, message: t("customer.errorLegalNameRequired") };
      case "vatNumber":
        return { field, message: t("customer.errorVatInvalid") };
      case "addressPostalCode":
        return { field, message: t("customer.errorPostalRequired") };
      default:
        return null;
    }
  };

  // Snapshot of everything entered so far (never the password). Shared by
  // the email-verification handoff and the password-reset handoff: after
  // either one, the form restores this and opens the next step.
  const buildReservationSnapshot = (email) => ({
    email: email.trim().toLowerCase(),
    data: {
      category: data.category ?? null,
      service: data.service ?? null,
      staff: data.staff ?? null,
      staffService: data.staffService ?? null,
      appointmentDrafts: data.appointmentDrafts ?? [],
      date: data.date ?? null,
      time: data.time ?? null,
      schedulingMode: data.schedulingMode ?? "same-day",
      sameDayDate: data.sameDayDate ?? null,
      perDraftDates: data.perDraftDates ?? {},
      perDraftTimes: data.perDraftTimes ?? {},
      selectedScheduleProposal: data.selectedScheduleProposal ?? null,
      customerInfo: (() => {
        const safeCustomerInfo = { ...formData };
        delete safeCustomerInfo.password;
        return safeCustomerInfo;
      })(),
      notes: data.notes ?? "",
      paymentMethod: data.paymentMethod ?? null,
    },
  });

  // "Mot de passe oublié ?" from the login mode: preserve the in-progress
  // reservation first (navigation would wipe it), then continue on the
  // forgot-password page with the email prefilled and the return path
  // attached, so the reset email links straight back to this booking.
  const handleForgotPassword = () => {
    const email = loginData.email.trim();
    if (email) savePendingReservation(buildReservationSnapshot(email));
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (returnTo) params.set("returnTo", returnTo);
    const query = params.toString();
    router.push(`/forgot-password${query ? `?${query}` : ""}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    const errs = validateRegister();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusFirstError(errs);
      return;
    }

    setSendingVerification(true);
    try {
      const result = await initCustomerVerification({
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        password: formData.password,
        newsletterSubscribed: formData.newsletterSubscribed,
        isCompany: formData.isCompany,
        companyLegalName: formData.companyLegalName?.trim() || null,
        vatNumber: formData.vatNumber?.trim() || null,
        addressLine1: formData.addressLine1?.trim() || null,
        addressLine2: formData.addressLine2?.trim() || null,
        addressCity: formData.addressCity?.trim() || null,
        addressPostalCode: formData.addressPostalCode?.trim() || null,
        addressCountry: formData.addressCountry || "Belgique",
        returnTo,
      });
      if (result?.verified) {
        // Preserve any notes already collected — this step no longer edits them.
        const safeCustomerInfo = { ...formData };
        delete safeCustomerInfo.password;
        updateData({ customerInfo: safeCustomerInfo, notes: data.notes ?? "" });
        nextStep();
        return;
      }
      if (result?.emailSent) {
        savePendingReservation(buildReservationSnapshot(formData.email));
        setVerificationSent({ email: formData.email.trim() });
        return;
      }
      if (result?.field) {
        const mapped = mapServerFieldError(result.field);
        if (mapped) {
          setErrors({ [mapped.field]: mapped.message });
          focusFirstError({ [mapped.field]: true });
          return;
        }
      }
      setFormError(result?.message || t("customer.genericError"));
    } catch (err) {
      console.error("[CustomerInfoStep] initCustomerVerification failed:", err);
      setFormError(t("customer.genericError"));
    } finally { setSendingVerification(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setFormError(null);
    setLoginNoAccount(false);
    const email = loginData.email.trim();
    const errs = {};
    if (!email) errs.email = t("customer.errorEmailRequired");
    else if (!EMAIL_RE.test(email)) errs.email = t("customer.errorEmailInvalid");
    if (!loginData.password) errs.password = t("customer.errorPasswordRequired");
    setLoginErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = errs.email ? "login-email" : "login-password";
      document.getElementById(first)?.focus();
      return;
    }

    setLoggingIn(true);
    try {
      const res = await signIn("credentials", {
        email: email.toLowerCase(),
        password: loginData.password,
        redirect: false,
      });
      if (res?.error) {
        // Tell an unknown email apart from a wrong password right here, so
        // the client is pointed at registration instead of discovering it
        // only via "Mot de passe oublié ?". checkEmailExists only reports
        // verified, active accounts; anything else lands on the no-account
        // path — including not-yet-verified accounts, for which switching to
        // registration (which refreshes their verification email) is also
        // the correct next step.
        let exists = false;
        try {
          exists = Boolean((await checkEmailExists(email))?.exists);
        } catch {
          exists = false;
        }
        if (!exists) {
          setLoginNoAccount(true);
          setLoginHelpVisible(false);
          document.getElementById("login-email")?.focus();
          return;
        }
        setLoginErrors({ password: t("customer.errorInvalidCredentials") });
        setLoginHelpVisible(true);
        document.getElementById("login-password")?.focus();
        return;
      }
      // Authenticated: the session cookie is set, so the review/payment
      // actions recognise the customer server-side. Continue with the
      // in-progress reservation — service/date/time untouched.
      const session = await getSession().catch(() => null);
      const user = session?.user;
      updateData({
        customerInfo: {
          fullName: user?.fullName ?? "",
          email: user?.email ?? email,
          phone: user?.phone ?? "",
          newsletterSubscribed: false,
        },
        notes: data.notes ?? "",
      });
      nextStep();
    } catch (err) {
      console.error("[CustomerInfoStep] sign-in failed:", err);
      setFormError(t("customer.genericError"));
    } finally { setLoggingIn(false); }
  };

  const handleLoginResend = async () => {
    const email = loginData.email.trim();
    if (!email) return;
    setLoginResending(true);
    try {
      await resendVerificationEmail({ email });
      // Enumeration-safe by design: the action answers the same way whether
      // or not an unverified account exists for this address.
      setLoginResent(true);
    } catch (err) {
      console.error("[CustomerInfoStep] resendVerificationEmail failed:", err);
      setFormError(t("customer.genericError"));
    } finally { setLoginResending(false); }
  };

  const handleResend = async () => {
    if (!verificationSent?.email) return;
    setResending(true);
    try {
      const result = await resendVerificationEmail({ email: verificationSent.email });
      if (result.success) toast.success(t("customer.resendSent"));
      else setFormError(result.message || t("customer.genericError"));
    } catch (err) {
      console.error("[CustomerInfoStep] resendVerificationEmail failed:", err);
      setFormError(t("customer.genericError"));
    } finally { setResending(false); }
  };

  // Waiting for the one-click verification: explain the handoff instead of
  // leaving a bare toast behind.
  if (verificationSent) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="mb-5">
          <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("customer.title")}</h2>
          <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
        </div>

        <div className="relative space-y-4 overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 p-6 text-center shadow-[0_2px_16px_rgba(47,58,46,0.04)]">
          <CardBotanicalSprigs />
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
            <MailCheck size={20} />
          </div>
          <h3 className="text-base font-semibold text-[#2F3A2E]">{t("customer.verifyEmailTitle")}</h3>
          <p className="text-sm leading-relaxed text-[#6f6a64]">
            {t("customer.verifyEmailSentTo")} <strong className="text-[#2F3A2E]">{verificationSent.email}</strong>.
          </p>
          <p className="text-sm leading-relaxed text-[#6f6a64]">
            {t("customer.verifyEmailInstructions")}
          </p>
          <FormError message={formError} />
          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className={`w-full rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${resending ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md"}`}
            >
              {resending ? (
                <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("customer.resendSending")}</span>
              ) : (
                t("customer.resendEmail")
              )}
            </button>
            <button
              type="button"
              onClick={() => { setVerificationSent(null); setFormError(null); }}
              className="w-full rounded-full border border-[#b89664] bg-white px-5 py-2.5 text-[13px] font-medium text-[#b89664] transition-colors hover:bg-[#f5ece0]"
            >
              {t("customer.editInfo")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Existing account: email + password only, then straight to the next step.
  if (mode === "login") {
    return (
      <div className="mx-auto max-w-xl">
        <div className="flex gap-4">
            <StepBackArrow onBack={prevStep} label={t("customer.back")} />
          <div className="mb-5">
            <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("customer.title")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#6f6a64]">{t("customer.loginSubtitle")}</p>
            <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
          </div>
      </div>

        <p className="mb-4 text-[14px] text-[#6f6a64]">
          {t("customer.noAccount")}{" "}
          <button type="button" onClick={goToRegister} className="font-semibold text-[#2F3A2E] underline decoration-[#b89664] underline-offset-2 transition-colors hover:text-[#b89664]">
            {t("customer.createAccountLink")}
          </button>
        </p>

        <form onSubmit={handleLogin} noValidate>
          <div className="relative space-y-4 overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 p-4 shadow-[0_2px_16px_rgba(47,58,46,0.04)] sm:p-5">
            <CardBotanicalSprigs />
            <FormError message={formError} />

            <Field label={t("customer.email")} htmlFor="login-email" required error={loginErrors.email}>
              <div className="relative">
                <InputIcon><Mail size={16} /></InputIcon>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  value={loginData.email}
                  onChange={handleLoginChange}
                  placeholder={t("customer.emailPlaceholder")}
                  autoComplete="email"
                  aria-invalid={Boolean(loginErrors.email)}
                  aria-describedby={loginErrors.email ? "login-email-error" : undefined}
                  className={inputClass(Boolean(loginErrors.email))}
                />
              </div>
            </Field>

            {loginNoAccount && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-[13px] leading-relaxed text-amber-800">{t("customer.errorNoAccount")}</p>
                {/* <button
                  type="button"
                  onClick={goToRegister}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#2F3A2E] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#212a20]"
                >
                  {t("customer.createAccountLink")}
                </button> */}
              </div>
            )}

            <Field label={t("customer.password")} htmlFor="login-password" required error={loginErrors.password}>
              <div className="relative">
                <InputIcon><Lock size={16} /></InputIcon>
                <input
                  type={showLoginPassword ? "text" : "password"}
                  id="login-password"
                  name="password"
                  value={loginData.password}
                  onChange={handleLoginChange}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={Boolean(loginErrors.password)}
                  aria-describedby={loginErrors.password ? "login-password-error" : undefined}
                  className={`${inputClass(Boolean(loginErrors.password))} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((v) => !v)}
                  aria-label={showLoginPassword ? t("customer.hidePassword") : t("customer.showPassword")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#9a9590] transition-colors hover:text-[#2F3A2E]"
                >
                  {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            {loginHelpVisible && (
              <div className="space-y-2 rounded-xl border border-[#ede5d8]/60 bg-white/60 px-3.5 py-3">
                <p className="text-xs leading-relaxed text-[#6f6a64]">{t("customer.errorUnverifiedHint")}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs font-semibold text-[#2F3A2E] underline decoration-[#b89664] underline-offset-2 transition-colors hover:text-[#b89664]"
                  >
                    {t("customer.forgotPassword")}
                  </button>
                  <button
                    type="button"
                    onClick={handleLoginResend}
                    disabled={loginResending}
                    className="text-xs font-semibold text-[#2F3A2E] underline decoration-[#b89664] underline-offset-2 transition-colors hover:text-[#b89664] disabled:opacity-60"
                  >
                    {loginResending ? t("customer.resendSending") : t("customer.resendLink")}
                  </button>
                </div>
                {loginResent && (
                  <p role="status" className="text-xs leading-relaxed text-emerald-700">{t("customer.resendSent")}</p>
                )}
              </div>
            )}
          </div>

          <button type="submit" disabled={loggingIn} className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${loggingIn ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md hover:-translate-y-px"}`}>
            {loggingIn ? (
              <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("customer.loginSubmitting")}</span>
            ) : (
              <><LogIn size={15} />{t("customer.loginSubmit")}</>
            )}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex gap-4">
          <StepBackArrow onBack={prevStep} label={t("customer.back")} />
      <div className="mb-5">
        <h2 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-[#2F3A2E]">{t("customer.title")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#6f6a64]">{t("customer.subtitle")}</p>
        <p className="mt-1 text-xs text-[#9a9590]">{t("customer.accountCreated")}</p>
        <div className="mt-3 h-px w-10 bg-[#b89664]/20" />
      </div>
      </div>
     

      <p className="mb-4 text-[14px] text-[#6f6a64]">
        {t("customer.haveAccount")}{" "}
        <button type="button" onClick={goToLogin} className="font-semibold text-[#2F3A2E] underline decoration-[#b89664] underline-offset-2 transition-colors hover:text-[#b89664]">
          {t("customer.signInLink")}
        </button>
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="relative space-y-4 overflow-hidden rounded-xl border-2 border-[#ede5d8]/70 bg-[#fdf8f0]/80 p-4 shadow-[0_2px_16px_rgba(47,58,46,0.04)] sm:p-5">
          <CardBotanicalSprigs />
          <FormError message={formError} />

          {/* Account type — first, segmented and compact */}
          <div role="radiogroup" aria-label={t("customer.accountType")} className="flex rounded-full border border-[#ede5d8] bg-white p-1">
            <label className={`flex flex-1 cursor-pointer items-center justify-center rounded-full px-3 py-1.5 text-[13px] font-medium transition-all focus-within:ring-2 focus-within:ring-[#2F3A2E]/20 ${!isCompany ? "bg-[#2F3A2E] text-white shadow-sm" : "text-[#9a9590] hover:text-[#2F3A2E]"}`}>
              <input
                type="radio"
                name="isCompany"
                value="false"
                checked={!isCompany}
                onChange={() => setFormData((prev) => ({ ...prev, isCompany: false }))}
                className="sr-only"
              />
              {t("customer.individual")}
            </label>
            <label className={`flex flex-1 cursor-pointer items-center justify-center rounded-full px-3 py-1.5 text-[13px] font-medium transition-all focus-within:ring-2 focus-within:ring-[#2F3A2E]/20 ${isCompany ? "bg-[#2F3A2E] text-white shadow-sm" : "text-[#9a9590] hover:text-[#2F3A2E]"}`}>
              <input
                type="radio"
                name="isCompany"
                value="true"
                checked={isCompany}
                onChange={() => setFormData((prev) => ({ ...prev, isCompany: true }))}
                className="sr-only"
              />
              {t("customer.company")}
            </label>
          </div>

          <Field label={t("customer.fullName")} htmlFor="fullName" required error={errors.fullName}>
            <div className="relative">
              <InputIcon><User size={16} /></InputIcon>
              <input
                type="text"
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder={t("customer.fullNamePlaceholder")}
                autoComplete="name"
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? "fullName-error" : undefined}
                className={inputClass(Boolean(errors.fullName))}
              />
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("customer.email")} htmlFor="email" required error={errors.email}>
              <div className="relative">
                <InputIcon><Mail size={16} /></InputIcon>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  onBlur={handleEmailBlur}
                  placeholder={t("customer.emailPlaceholder")}
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className={`${inputClass(Boolean(errors.email))} pr-10`}
                />
                {checkingEmail && (<div className="absolute inset-y-0 right-3 flex items-center"><div className="h-4 w-4 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" /></div>)}
              </div>
            </Field>

            <Field label={t("customer.phone")} htmlFor="phone" required error={errors.phone}>
              <div className="relative">
                <InputIcon><Phone size={16} /></InputIcon>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder={t("customer.phonePlaceholder")}
                  autoComplete="tel"
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={errors.phone ? "phone-error" : undefined}
                  className={inputClass(Boolean(errors.phone))}
                />
              </div>
            </Field>
          </div>

          {emailStatus === "exists" && !errors.email && (
            <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs leading-relaxed text-amber-800">{t("customer.errorEmailExists")}</p>
              <button
                type="button"
                onClick={goToLogin}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#2F3A2E] px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#212a20]"
              >
                <LogIn size={13} />
                {t("customer.signInLink")}
              </button>
            </div>
          )}

          <Field label={t("customer.password")} htmlFor="password" required error={errors.password}>
            <div className="relative">
              <InputIcon><Lock size={16} /></InputIcon>
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                name="password"
                value={formData.password ?? ""}
                onChange={handleChange}
                placeholder={t("customer.passwordPlaceholder")}
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? "password-error" : undefined}
                className={`${inputClass(Boolean(errors.password))} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t("customer.hidePassword") : t("customer.showPassword")}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[#9a9590] transition-colors hover:text-[#2F3A2E]"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          {/* Entreprise — company identity + billing address required for a
              correct B2B invoice (VIES-validated VAT, legal name, full
              address). Same set as the sign-up form. */}
          {isCompany && (
            <div className="space-y-4 border-t border-[#ede5d8]/60 pt-4">
              <Field label={t("customer.companyLegalName")} htmlFor="companyLegalName" required error={errors.companyLegalName}>
                <input
                  type="text"
                  id="companyLegalName"
                  name="companyLegalName"
                  value={formData.companyLegalName ?? ""}
                  onChange={handleChange}
                  placeholder={t("customer.companyLegalNamePlaceholder")}
                  autoComplete="organization"
                  aria-invalid={Boolean(errors.companyLegalName)}
                  aria-describedby={errors.companyLegalName ? "companyLegalName-error" : undefined}
                  className={addressInputClass(Boolean(errors.companyLegalName))}
                />
              </Field>

              <Field label={t("customer.vatNumber")} htmlFor="vatNumber" required error={errors.vatNumber}>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="vatNumber"
                    name="vatNumber"
                    value={formData.vatNumber ?? ""}
                    onChange={handleChange}
                    placeholder={t("customer.vatNumberPlaceholder")}
                    autoComplete="off"
                    aria-invalid={Boolean(errors.vatNumber)}
                    aria-describedby={errors.vatNumber ? "vatNumber-error" : undefined}
                    className={addressInputClass(Boolean(errors.vatNumber))}
                  />
                  <button
                    type="button"
                    onClick={handleVatVerify}
                    disabled={vatCheck?.loading}
                    className="inline-flex shrink-0 items-center rounded-full border border-[#ede5d8] bg-white px-3.5 text-xs font-semibold text-[#6f6a64] transition-colors hover:border-[#2F3A2E] hover:text-[#2F3A2E] disabled:opacity-60"
                  >
                    {vatCheck?.loading ? <Loader2 size={14} className="animate-spin" /> : t("customer.verify")}
                  </button>
                </div>
                {vatCheck && !vatCheck.loading && (
                  <p
                    role="status"
                    className={`mt-1.5 text-xs leading-relaxed font-medium ${
                      vatCheck.error ? "text-amber-700" : vatCheck.valid ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {vatCheck.message}
                  </p>
                )}
              </Field>

              <Field label={t("customer.address")} htmlFor="addressLine1" required error={errors.addressLine1}>
                <input
                  type="text"
                  id="addressLine1"
                  name="addressLine1"
                  value={formData.addressLine1}
                  onChange={handleChange}
                  placeholder="Rue de la Paix 123"
                  autoComplete="street-address"
                  aria-invalid={Boolean(errors.addressLine1)}
                  aria-describedby={errors.addressLine1 ? "addressLine1-error" : undefined}
                  className={addressInputClass(Boolean(errors.addressLine1))}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("customer.postalCode")} htmlFor="addressPostalCode" required error={errors.addressPostalCode}>
                  <input
                    type="text"
                    id="addressPostalCode"
                    name="addressPostalCode"
                    value={formData.addressPostalCode ?? ""}
                    onChange={handleChange}
                    placeholder={t("customer.postalCodePlaceholder")}
                    autoComplete="postal-code"
                    aria-invalid={Boolean(errors.addressPostalCode)}
                    aria-describedby={errors.addressPostalCode ? "addressPostalCode-error" : undefined}
                    className={addressInputClass(Boolean(errors.addressPostalCode))}
                  />
                </Field>

                <Field label={t("customer.city")} htmlFor="addressCity" required error={errors.addressCity}>
                  <input
                    type="text"
                    id="addressCity"
                    name="addressCity"
                    value={formData.addressCity}
                    onChange={handleChange}
                    placeholder="Bruxelles"
                    autoComplete="address-level2"
                    aria-invalid={Boolean(errors.addressCity)}
                    aria-describedby={errors.addressCity ? "addressCity-error" : undefined}
                    className={addressInputClass(Boolean(errors.addressCity))}
                  />
                </Field>
              </div>

              <Field label={t("customer.country")} htmlFor="addressCountry" required error={errors.addressCountry}>
                <CountrySelect
                  id="addressCountry"
                  name="addressCountry"
                  value={formData.addressCountry}
                  onChange={(val) => {
                    setFormData((prev) => ({ ...prev, addressCountry: val }));
                    clearKey(setErrors, "addressCountry");
                    setVatCheck(null);
                    if (formError) setFormError(null);
                  }}
                  variant="rounded"
                  error={Boolean(errors.addressCountry)}
                />
              </Field>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#ede5d8]/50 bg-white/60 px-3.5 py-2.5">
            <input type="checkbox" name="newsletterSubscribed" checked={formData.newsletterSubscribed} onChange={handleChange} className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#ede5d8] text-[#2F3A2E] focus:ring-[#2F3A2E]/20" />
            <span className="text-xs leading-relaxed text-[#6f6a64]">{t("customer.newsletter")}</span>
          </label>
        </div>

        <button type="submit" disabled={sendingVerification} className={`mt-5 w-full rounded-full px-5 py-2.5 text-[13px] font-medium text-white transition-all ${sendingVerification ? "cursor-not-allowed bg-[#ede5d8] text-white/70" : "bg-[#b89664] hover:bg-[#a38353] hover:shadow-md hover:-translate-y-px"}`}>
          {sendingVerification ? (<span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" />{t("customer.sendingVerification")}</span>) : (t("customer.continueToReview"))}
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-[#9a9590]">En continuant, vous acceptez nos conditions générales et notre politique de confidentialité.</p>
      </form>
    </div>
  );
}
