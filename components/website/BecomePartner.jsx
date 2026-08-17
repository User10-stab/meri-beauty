"use client";

import { useEffect, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { isValidVatFormat } from "@/lib/vat-validation";


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

const BENEFITS = [
  "Fauteuil ou cabine privative",
  "Flexibilité des contrats",
  "Clientèle existante",
  "Ambiance premium & conviviale",
];

export default function BecomePartner() {
  const [sectionRef, sectionInView] = useInView();
  const todayDate = formatDateInputValue(new Date());

  const [formData, setFormData] = useState({
    locationType: "chair",
    startDate: "",
    endDate: "",
    commissionType: "percentage",
    specialty: "",
    vatNumber: "",
    message: "",
  });

  const [loading, setLoading] = useState(false);
  const [submitStatus, setSubmitStatus] = useState({ type: null, message: "" });
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  
  // Fetch user's VAT number from their profile
  useEffect(() => {
    if (sessionStatus === "authenticated" && session?.user?.id) {
      fetchUserVatNumber(session.user.id);
    }
  }, [sessionStatus, session?.user?.id]);
  
  async function fetchUserVatNumber(userId) {
    try {
      const response = await fetch(`/api/users/${userId}`);
      if (response.ok) {
        const userData = await response.json();
        setFormData(prev => ({ ...prev, vatNumber: userData.vatNumber || "" }));
      }
    } catch (error) {
      console.error("Error fetching user VAT number:", error);
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

    // Submit the pending request
    (async () => {
      setLoading(true);
      setSubmitStatus({ type: null, message: "" });

      try {
        const rentalType = pendingData.locationType === "chair" ? "Fauteuil" : "Cabine privative";

        const requestData = {
          rentalType,
          commissionType: "FIXED",
          startDate: pendingData.startDate,
          specialty: pendingData.specialty || undefined,
          vatNumber: pendingData.vatNumber || undefined,
          message: pendingData.message || undefined,
        };

        if (pendingData.endDate) {
          requestData.endDate = pendingData.endDate;
        }

        const response = await fetch("/api/rental-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData),
        });

        const text = await response.text();
        let result = null;
        try {
          result = text ? JSON.parse(text) : null;
        } catch (err) {
          console.error("Invalid JSON response from /api/rental-requests:", text);
          throw new Error("Réponse du serveur invalide. Veuillez réessayer.");
        }

        if (!response.ok) {
          if (result?.errors) {
            const errorMessages = result.errors
              .map((err) => `${err.field}: ${err.message}`)
              .join("\n");
            throw new Error(errorMessages);
          }
          throw new Error(result?.message || `Erreur serveur (${response.status}).`);
        }

        if (result?.success) {
          toast.success("Votre demande a été envoyée avec succès ! Nous vous contacterons sous 48h.");
          router.push("/");
        } else {
          throw new Error(result.message || "Erreur lors de l'envoi de la demande.");
        }
      } catch (error) {
        console.error("Error submitting rental request:", error);
        setSubmitStatus({
          type: "error",
          message: error.message || "Une erreur est survenue. Veuillez réessayer.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionStatus, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();

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

    if (!formData.startDate) {
      setSubmitStatus({ type: "error", message: "Veuillez renseigner la date de début." });
      return;
    }

    if (formData.startDate < todayDate) {
      setSubmitStatus({ type: "error", message: "La date de début ne peut pas être dans le passé." });
      return;
    }

    // The field is marked with a red asterisk and carries `required`, but that
    // is browser-only — and the schema behind the POST route used to accept it
    // missing. Checked here too so a typo shows an explanation instead of a
    // bare 422 from the API.
    if (!formData.vatNumber?.trim()) {
      setSubmitStatus({ type: "error", message: "Veuillez renseigner votre numéro de TVA." });
      return;
    }
    if (!isValidVatFormat(formData.vatNumber)) {
      setSubmitStatus({
        type: "error",
        message:
          "Numéro de TVA invalide. Indiquez le préfixe du pays, par exemple BE0751854027.",
      });
      return;
    }

    // Only validate endDate if it's provided
    if (formData.endDate && new Date(formData.endDate) <= new Date(formData.startDate)) {
      setSubmitStatus({ type: "error", message: "La date de fin doit être postérieure à la date de début." });
      return;
    }

    setLoading(true);
    setSubmitStatus({ type: null, message: "" });

    try {
      const rentalType = formData.locationType === "chair" ? "Fauteuil" : "Cabine privative";

      const requestData = {
        rentalType,
        commissionType: "FIXED",
        startDate: formData.startDate,
        specialty: formData.specialty || undefined,
        vatNumber: formData.vatNumber || undefined,
        message: formData.message || undefined,
      };

      // Only include endDate if the user provided one
      if (formData.endDate) {
        requestData.endDate = formData.endDate;
      }

      const response = await fetch("/api/rental-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      });

      const text = await response.text();
      let result = null;
      try {
        result = text ? JSON.parse(text) : null;
      } catch (err) {
        console.error("Invalid JSON response from /api/rental-requests:", text);
        throw new Error("Réponse du serveur invalide. Veuillez réessayer.");
      }

      if (!response.ok) {
        if (result?.errors) {
          const errorMessages = result.errors
            .map((err) => `${err.field}: ${err.message}`)
            .join("\n");
          throw new Error(errorMessages);
        }
        throw new Error(result?.message || `Erreur serveur (${response.status}).`);
      }

      if (result?.success) {
        // Show success toast and redirect to home page
        toast.success("Votre demande a été envoyée avec succès ! Nous vous contacterons sous 48h.");
        router.push("/");
      } else {
        throw new Error(result.message || "Erreur lors de l'envoi de la demande.");
      }
    } catch (error) {
      console.error("Error submitting rental request:", error);
      setSubmitStatus({ 
        type: "error", 
        message: error.message || "Une erreur est survenue. Veuillez réessayer." 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSpecialtyChange = (e) => {
    setFormData({ ...formData, specialty: e.target.value });
  };

  return (
    <section
      ref={sectionRef}
      id="rejoindre"
      className="relative w-full overflow-hidden"
      style={{ minHeight: "520px" }}
    >
      {/* ── Full-bleed salon background image ── */}
      <div className="absolute inset-0">
        <Image
          src="/Images/salone.webp"
          alt="Intérieur du salon MeriBeauty"
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
      <div className="relative flex w-full flex-col items-stretch lg:min-h-[660px] lg:flex-row">

        {/* ── LEFT: Dark green content panel ── */}
        <div
          className={`relative z-10 flex w-full flex-col justify-center bg-primary px-6 py-12 sm:px-10 sm:py-16
            transition-all duration-700 ease-out
            lg:w-[35%] lg:px-14 lg:py-20
            ${sectionInView ? "opacity-90 translate-x-0" : "opacity-0 -translate-x-8"}`}
        >
          {/* Eyebrow */}
          <div className="mb-6 inline-flex items-center gap-3">
            <span className="h-px w-7 bg-gold/70" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold">
              Rejoignez-nous
            </span>
          </div>

          {/* Heading */}
          <h2 className="mb-5 text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.3rem] lg:text-[3rem]">
            Louez un espace,{" "}
            <em className="font-light text-gold/90 not-italic">
              développez votre talent.
            </em>
          </h2>

          {/* Body */}
          <p className="mb-8 max-w-[380px] text-[15px] leading-[1.8] text-white/60">
            Vous êtes coiffeuse, esthéticienne ou professionnelle de la beauté ?
            Rejoignez MeriBeauty et profitez d'un espace haut de gamme pour faire
            grandir votre clientèle.
          </p>

          {/* Benefits */}
          <ul className="mb-10 flex flex-col gap-3">
            {BENEFITS.map((benefit) => (
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
            <h3 className="mb-1 text-[1.35rem] font-bold leading-tight text-ink">
              Demande de location
            </h3>
            <p className="mb-7 text-[12.5px] leading-relaxed text-ink/45">
              Notre équipe vous répondra sous 48h.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* Type de location */}
              <div>
                <label
                  htmlFor="locationType"
                  className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                >
                  Type de location
                </label>
                <div className="relative">
                  <select
                    id="locationType"
                    name="locationType"
                    value={formData.locationType}
                    onChange={handleChange}
                    className="w-full appearance-none rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  >
                    <option value="chair">Fauteuil</option>
                    <option value="cabin">Cabine privative</option>
                  </select>
                  {/* Custom chevron */}
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink/30">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="startDate"
                    className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    Date de début souhaitée
                  </label>
                  <input
                    type="date"
                    id="startDate"
                    name="startDate"
                    required
                    min={todayDate}
                    value={formData.startDate}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="endDate"
                    className=" block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    Date de fin souhaitée
                  </label>
                  <input
                    type="date"
                    id="endDate"
                    name="endDate"
                    min={formData.startDate || todayDate}
                    value={formData.endDate}
                    onChange={handleChange}
                    className=" w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                 {/* Specialty */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="specialty"
                    className="block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    Spécialité
                  </label>
                  <input
                    type="text"
                    id="specialty"
                    name="specialty"
                    required
                    placeholder="ex. Coiffure, Esthétique, Onglerie..."
                    value={formData.specialty}
                    onChange={handleSpecialtyChange}
                    className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>

                {/* VAT Number */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="vatNumber"
                    className="block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                  >
                    Numéro de TVA <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    id="vatNumber"
                    name="vatNumber"
                    required
                    placeholder="ex. BE0123456789"
                    value={formData.vatNumber}
                    onChange={handleChange}
                    className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                  />
                </div>
              </div>

             

              {/* Message */}
              <div>
                <label
                  htmlFor="message"
                  className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.09em] text-ink/60"
                >
                  Votre message (optionnel)
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  placeholder="Parlez-nous de vous..."
                  value={formData.message}
                  onChange={handleChange}
                  className="w-full resize-none rounded-xl border border-ink/12 bg-white px-4 py-3 text-[13.5px] text-ink placeholder-ink/30 transition-all duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/15"
                />
              </div>

              {/* Status message */}
              {submitStatus.type && (
                <div className={`mt-2 rounded-lg p-3 text-sm ${submitStatus.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
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
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    Envoyer ma demande
                    <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

      </div>
    </section>
  );
}
