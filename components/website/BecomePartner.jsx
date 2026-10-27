"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { toast } from "sonner";
import Image from "next/image";
import { isValidVatFormat } from "@/lib/vat-validation";
import { CONTACT_EMAIL_PATTERN, isPlausibleContactPhone } from "@/lib/validations/rental-request";
import { useTranslations } from "next-intl";


function useInView(threshold = 0.1) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
}

function CheckIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className={className}
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon({ className = "w-4 h-4" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const EMPTY_FORM = {
  lastName: "",
  firstName: "",
  email: "",
  phone: "",
  startDate: "",
  desiredPace: "",
  specialty: "",
  vatNumber: "",
  message: "",
};

// Corps envoyé à POST /api/rental-requests — commun à l'envoi direct et à
// l'envoi automatique après connexion.
function buildRequestData(data) {
  const requestData = {
    rentalType: "Cabine",
    commissionType: "FIXED",
    startDate: data.startDate,
    specialty: data.specialty || undefined,
    vatNumber: data.vatNumber?.trim() || undefined,
    message: data.message || undefined,
    lastName: data.lastName?.trim(),
    firstName: data.firstName?.trim(),
    email: data.email?.trim(),
    phone: data.phone?.trim(),
  };
  // Only include desiredPace if the user provided one
  if (data.desiredPace) {
    requestData.desiredPace = data.desiredPace;
  }
  return requestData;
}

export default function BecomePartner() {
  const t = useTranslations("becomePartner");
  const [sectionRef, sectionInView] = useInView();
  const todayDate = formatDateInputValue(new Date());

  const [formData, setFormData] = useState(EMPTY_FORM);

  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState({ type: null, message: "" });
  // Confirmation affichée à la place du formulaire après l'envoi (MB-004) :
  // avant, un toast puis une redirection vers l'accueil — la page où l'on
  // était déjà — et rien ne disait comment on serait recontactée.
  const [submitted, setSubmitted] = useState(false);
  const { data: session, status: sessionStatus } = useSession();

  // Pré-remplit nom, prénom, e-mail, téléphone et TVA depuis le profil, sans
  // écraser ce que la candidate a déjà tapé.
  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user?.id) {
      fetchUserProfile(session.user.id);
    }
  }, [sessionStatus, session?.user?.id]);

  async function fetchUserProfile(userId) {
    try {
      const response = await fetch(`/api/users/${userId}`);
      if (response.ok) {
        const userData = await response.json();
        const [first = "", ...rest] = (userData.fullName || "").trim().split(/\s+/);
        setFormData((prev) => ({
          ...prev,
          firstName: prev.firstName || first,
          lastName: prev.lastName || rest.join(" "),
          email: prev.email || userData.email || "",
          phone: prev.phone || userData.phone || "",
          vatNumber: prev.vatNumber || userData.vatNumber || "",
        }));
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  }

  // Mêmes règles que lib/validations/rental-request.js (le serveur revérifie).
  // Renvoie le message d'erreur à afficher, ou null.
  function validateForm(data) {
    if (!data.lastName?.trim()) return t("lastNameRequired");
    if (!data.firstName?.trim()) return t("firstNameRequired");
    if (!CONTACT_EMAIL_PATTERN.test(data.email?.trim() || "")) return t("emailInvalid");
    if (!isPlausibleContactPhone(data.phone || "")) return t("phoneInvalid");
    if (!data.startDate) return t("startDateRequired");
    if (data.startDate < todayDate) return t("startDateInPast");
    // TVA facultative : le format n'est vérifié que si un numéro est saisi.
    if (data.vatNumber?.trim() && !isValidVatFormat(data.vatNumber)) return t("vatInvalid");
    return null;
  }

  async function sendRequest(data) {
    setLoading(true);
    setSubmitStatus({ type: null, message: "" });

    try {
      const response = await fetch("/api/rental-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildRequestData(data)),
      });

      const text = await response.text();
      let result = null;
      try {
        result = text ? JSON.parse(text) : null;
      } catch (err) {
        console.error("Invalid JSON response from /api/rental-requests:", text);
        throw new Error(t("invalidServerResponse"));
      }

      if (!response.ok) {
        if (result?.errors) {
          const errorMessages = result.errors
            .map((err) => err.message)
            .join("\n");
          throw new Error(errorMessages);
        }
        throw new Error(result?.message || t("serverError", { status: response.status }));
      }

      if (result?.success) {
        toast.success(t("requestSent"));
        setFormData(EMPTY_FORM);
        setSubmitted(true);
      } else {
        throw new Error(result?.message || t("sendError"));
      }
    } catch (error) {
      console.error("Error submitting rental request:", error);
      setSubmitStatus({
        type: "error",
        message: error.message || t("genericError"),
      });
    } finally {
      setLoading(false);
    }
  }

  // ── Auto-submit pending rental request after authentication ──────────────
  useEffect(() => {
    if (sessionStatus !== "authenticated") return;

    // Prefer sessionStorage (same-tab), fall back to localStorage (cross-tab,
    // e.g. verification email opened in a new tab then user signs in there).
    const pending =
      sessionStorage.getItem("pendingRentalRequest") ||
      localStorage.getItem("pendingRentalRequest");
    if (!pending) return;

    // Clear immediately from both stores to prevent re-submission on re-renders
    sessionStorage.removeItem("pendingRentalRequest");
    localStorage.removeItem("pendingRentalRequest");
    localStorage.removeItem("pendingRentalReturnUrl");

    let pendingData;
    try {
      pendingData = JSON.parse(pending);
    } catch {
      return;
    }

    // Une demande mise de côté avant cette version n'a pas de coordonnées :
    // on la remet dans le formulaire au lieu de l'envoyer incomplète.
    const pendingForm = { ...EMPTY_FORM, ...pendingData };
    const error = validateForm(pendingForm);
    if (error) {
      setFormData(pendingForm);
      setSubmitStatus({ type: "error", message: error });
      return;
    }

    sendRequest(pendingForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Vérifié avant la redirection vers la connexion : la candidate corrige
    // tout de suite, au lieu de découvrir l'erreur au retour.
    const error = validateForm(formData);
    if (error) {
      setSubmitStatus({ type: "error", message: error });
      return;
    }

    // If the user is not authenticated, save form data and redirect to auth
    if (sessionStatus !== "authenticated") {
      // Save to both sessionStorage (same-tab fast path) and localStorage
      // (cross-tab fallback for when the email verification link is opened
      // in a different tab/window and the user is then redirected to login).
      const serialized = JSON.stringify(formData);
      sessionStorage.setItem("pendingRentalRequest", serialized);
      localStorage.setItem("pendingRentalRequest", serialized);
      // Store the return URL separately so verify-email-form can build the
      // correct "Sign In" link even without knowing the full form payload.
      localStorage.setItem("pendingRentalReturnUrl", window.location.href);
      signIn(undefined, { callbackUrl: window.location.href });
      return;
    }

    await sendRequest(formData);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <section
      ref={sectionRef}
      id="rejoindre"
      className="relative w-full overflow-hidden"
      style={{ minHeight: "90vh" }}
    >
      {/* ── Full-bleed salon background image ── */}
      <div className="absolute inset-0">
        <Image
          src="/Images/DemandLocation.webp"
          alt={t("imageAlt")}
          fill
          className="object-cover object-center"
          priority={false}
        />
      </div>

      {/* ══════════════════════════════════════════
          THREE-COLUMN LAYOUT (left | image | right)
          Left  = dark green panel (≈40%)
          Mid   = salon photo shows through (≈20%)
          Right = white form card (≈40%)
      ══════════════════════════════════════════ */}
      <div className="relative flex w-full flex-col items-stretch lg:min-h-[90vh] lg:flex-row">

        {/* ── LEFT: Dark green content panel ── */}
        <div
          className={`relative z-10 flex w-full flex-col items-center justify-center bg-primary px-6 py-12 text-center sm:px-10 sm:py-16
            transition-all duration-700 ease-out
            lg:w-[40%] 2xl:w-[30%] lg:items-start lg:px-14 lg:py-20 lg:text-left
            ${sectionInView ? "opacity-80 translate-x-0" : "opacity-0 -translate-x-8"}`}
        >
          {/* Eyebrow */}
          <div className="mb-6 inline-flex items-center gap-3">
            <span className="h-px w-7 bg-gold/70" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              {t("eyebrow")}
            </span>
          </div>

          {/* Heading */}
          <h2 className="mb-5 text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.3rem] lg:text-[3rem]">
            {t("heading")}
          </h2>

          {/* Body */}
          <p className="mb-8 max-w-[380px] text-[15px] leading-[1.8] text-white/60">
            {t("body1")} <br />
            {t("body2")} <br /><br />
            {t("body3")} <br />
            {t("body4")}
          </p>

          {/* Benefits */}
          <ul className="mb-10 flex flex-col items-center gap-3 lg:items-start">
            {[
              t("benefit1"),
              t("benefit2"),
              t("benefit3"),
              t("benefit4"),
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15">
                  <CheckIcon className="h-3 w-3 text-gold" />
                </span>
                <span className="text-[15px] font-medium text-white/75">
                  {benefit}
                </span>
              </li>
            ))}
          </ul>

          {/* CTA link button */}
          {/* <div>
            <a
              href="#contact"
              className="group inline-flex items-center gap-2.5 rounded-full border border-gold/40 px-7 py-3 text-[13px] font-semibold text-gold transition-all duration-300 hover:bg-gold hover:text-white hover:shadow-lg hover:shadow-gold/20"
            >
              Faire une demande
              <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
          </div> */}
        </div>

        {/* ── RIGHT: White form card ── */}
        <div
          className={`relative z-10 flex w-full items-center justify-center
            transition-all duration-700 ease-out delay-200
            lg:ml-auto lg:w-[44%]
            ${sectionInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"}`}
        >
          {/* Semi-transparent backdrop so form is readable over the photo */}
          <div className="absolute inset-0 bg-cream/20 backdrop-blur-[2px] lg:hidden" />

          <div className="relative z-10 mx-4 my-8 w-full max-w-[450px] bg-white/97 px-6 py-8 shadow-2xl shadow-black/20 sm:mx-6 sm:px-8 sm:py-10 lg:mx-0 lg:mr-0 lg:rounded lg:px-10 lg:py-8">
            {/* Form heading */}
            <h3 className="mb-1 text-center text-[1.35rem] font-bold leading-tight text-ink lg:text-left">
              {t("formTitle")}
            </h3>
            <p className="mb-7 text-center text-[12.5px] leading-relaxed text-ink/45 lg:text-left">
              {t("formSubtitle")}
            </p>

            {submitted ? (
              <div role="status" className="flex flex-col items-center gap-4 rounded-xl bg-cream/60 px-5 py-8 text-center lg:items-start lg:text-left">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/15">
                  <CheckIcon className="h-5 w-5 text-gold" />
                </span>
                <p className="text-[1.05rem] font-semibold text-ink">{t("successTitle")}</p>
                <p className="text-[13.5px] leading-relaxed text-ink/60">{t("successBody")}</p>
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="mt-1 text-[13px] font-medium text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold"
                >
                  {t("sendAnother")}
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
              {/* Coordonnées — obligatoires (MB-004) : sans elles, impossible de
                  « revenir vers vous rapidement ». */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  { name: "lastName", type: "text", autoComplete: "family-name" },
                  { name: "firstName", type: "text", autoComplete: "given-name" },
                  { name: "email", type: "email", autoComplete: "email" },
                  { name: "phone", type: "tel", autoComplete: "tel" },
                ].map((field) => (
                  <div key={field.name} className="flex flex-col gap-1.5">
                    <label
                      htmlFor={`partner-${field.name}`}
                      className="block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                    >
                      {t(`${field.name}Label`)} <span className="text-red-400">{t("requiredAsterisk")}</span>
                    </label>
                    <input
                      type={field.type}
                      id={`partner-${field.name}`}
                      name={field.name}
                      required
                      autoComplete={field.autoComplete}
                      placeholder={t(`${field.name}Placeholder`)}
                      value={formData[field.name]}
                      onChange={handleChange}
                      className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                    />
                  </div>
                ))}
              </div>

              {/* Date range + Desired pace */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex h-full flex-col gap-1.5">
                  <label
                    htmlFor="startDate"
                    className="flex-1 mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    {t("startDateLabel")}
                  </label>
                  <input
                    type="date"
                    id="startDate"
                    name="startDate"
                    required
                    min={todayDate}
                    value={formData.startDate}
                    onChange={handleChange}
                    className="flex-1 w-full max-h-[46px] rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>
                <div className="flex h-full flex-col gap-1.5">
                  <label
                    htmlFor="desiredPace"
                    className="flex-1 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    {t("desiredPaceLabel")}
                  </label>
                  <select
                    id="desiredPace"
                    name="desiredPace"
                    value={formData.desiredPace}
                    onChange={handleChange}
                    className="flex-1 w-full max-h-[46px] rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  >
                    <option value="">{t("desiredPacePlaceholder")}</option>
                    <option value="1_day_per_week">{t("desiredPace1Day")}</option>
                    <option value="2_days_per_week">{t("desiredPace2Days")}</option>
                    <option value="3_days_per_week">{t("desiredPace3Days")}</option>
                    <option value="full_week">{t("desiredPaceFullWeek")}</option>
                  </select>
                </div>
              </div>
              {/* Specialty */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="specialty"
                    className="block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    {t("specialtyLabel")}
                  </label>
                  <input
                    type="text"
                    id="specialty"
                    name="specialty"
                    required
                    placeholder="ex. Onglerie..."
                    value={formData.specialty}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>
                {/* VAT Number */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="vatNumber"
                    className="block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    {t("vatLabel")}{" "}
                    <span className="font-normal normal-case tracking-normal text-ink/40">{t("vatOptional")}</span>
                  </label>
                  <input
                    type="text"
                    id="vatNumber"
                    name="vatNumber"
                    placeholder="ex. BE0123456789"
                    value={formData.vatNumber}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>

              {/* Message */}
              <div>
                <label
                  htmlFor="message"
                  className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                >
                  {t("messageLabel")}
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  placeholder="..."
                  value={formData.message}
                  onChange={handleChange}
                  className="w-full resize-none rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink placeholder-ink/30 transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                />
              </div>

              {/* Status message */}
              {submitStatus.type && (
                <div role="alert" className={`mt-2 whitespace-pre-line rounded-lg p-3 text-sm ${submitStatus.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                  {submitStatus.message}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="group mt-1 flex w-full items-center justify-center gap-2.5 rounded-xl bg-gold px-8 py-4 text-[14px] font-semibold text-white shadow-md shadow-gold/25 transition-all duration-300 hover:bg-gold/90 hover:shadow-lg hover:shadow-gold/35 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t("loadingText")}
                  </>
                ) : (
                  <>
                    {t("buttonText")}
                    <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}
