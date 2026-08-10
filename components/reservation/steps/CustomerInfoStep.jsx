"use client";

import { useState } from "react";
import { User, Mail, Phone, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { checkEmailExists } from "@/actions/shared/check-email-exists";
import { ExistingAccountBanner } from "@/components/shared/ExistingAccountBanner";
import { initCustomerVerification } from "@/actions/reservation/init-customer-verification";
import { isDisposableEmail } from "@/lib/validations/customer-identity";

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({ label, htmlFor, required, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-2 block text-sm font-semibold text-[#2F3A2E]"
      >
        {label} {required && <span className="text-[#C8A46A]">*</span>}
      </label>
      {children}
    </div>
  );
}

function InputIcon({ children }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Shown only for unauthenticated users. Authenticated users skip this step
 * entirely — ReservationForm filters it out of the STEPS array.
 */
export default function CustomerInfoStep({ data, updateData, nextStep }) {
  const [formData, setFormData] = useState(
    data.customerInfo ?? {
      fullName: "",
      email: "",
      phone: "",
      newsletterSubscribed: false,
    }
  );
  const [notes, setNotes] = useState(data.notes ?? "");

  // null = not checked yet | "exists" = account found | "dismissed" = user chose to continue anyway
  const [emailStatus, setEmailStatus] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    // Reset email check when the email field changes
    if (name === "email") setEmailStatus(null);
  };

  const handleEmailBlur = async () => {
    const email = formData.email.trim();
    if (!email || !email.includes("@")) return;

    setCheckingEmail(true);
    try {
      const result = await checkEmailExists(email);
      if (result.exists) {
        setEmailStatus("exists");
      }
    } catch {
      // Non-critical — silently ignore, user can still proceed
    } finally {
      setCheckingEmail(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.fullName.trim()) {
      toast.error("Veuillez entrer votre nom complet");
      return;
    }
    if (!formData.email.trim() || !formData.email.includes("@")) {
      toast.error("Veuillez entrer une adresse email valide");
      return;
    }
    if (isDisposableEmail(formData.email)) {
      toast.error("Les adresses e-mail temporaires ne sont pas acceptées.");
      return;
    }
    if (!formData.phone.trim()) {
      toast.error("Veuillez entrer votre numéro de téléphone");
      return;
    }

    // Create the customer account and send a verification email.
    // The user is blocked from advancing until they click the verification
    // link sent to their inbox (which sets emailVerified = true in the DB).
    setSendingVerification(true);
     try {
      const result = await initCustomerVerification({
        fullName: formData.fullName.trim(),
        email: formData.email.trim().toLowerCase(),
        phone: formData.phone.trim(),
        newsletterSubscribed: formData.newsletterSubscribed,
      });

      //toast.dismiss(loadingToastId);
      //toast.success("Email de vérification envoyé ! Veuillez vérifier votre boîte de réception.", { duration: 6000 });

      if (result.verified) {
        // Email already verified in DB — safe to proceed
        updateData({ customerInfo: formData, notes });
        nextStep();
      } 
      else {
        // Not verified yet — inform the user that a verification email was sent
        toast.success(result.message, { duration: 6000 });
      }
    } catch (err) {
      console.error("[CustomerInfoStep] initCustomerVerification failed:", err);
      toast.error("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setSendingVerification(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">Vos informations</h2>
        <p className="mt-2 text-gray-600">
          Nous aurons besoin de ces détails pour confirmer votre réservation.
        </p>
        <p className="mt-1 text-sm text-gray-400">
          Un compte sera créé automatiquement après votre réservation.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* ── Personal information ──────────────────────────────── */}
        <div className="rounded-2xl border-2 border-gray-200 p-6 space-y-5">

          {/* Full name */}
          <Field label="Nom complet" htmlFor="fullName" required>
            <div className="relative">
              <InputIcon><User size={18} /></InputIcon>
              <input
                type="text"
                id="fullName"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="Votre nom complet"
                className="w-full rounded-lg border-2 border-gray-200 py-3 pl-10 pr-4 transition-all focus:border-[#C8A46A] focus:outline-none"
                required
              />
            </div>
          </Field>

          {/* Email */}
          <Field label="Email" htmlFor="email" required>
            <div className="relative">
              <InputIcon><Mail size={18} /></InputIcon>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                onBlur={handleEmailBlur}
                placeholder="votre.email@exemple.com"
                className={`w-full rounded-lg border-2 py-3 pl-10 pr-4 transition-all focus:outline-none ${
                  emailStatus === "exists"
                    ? "border-amber-400 focus:border-amber-500"
                    : "border-gray-200 focus:border-[#C8A46A]"
                }`}
                required
              />
              {checkingEmail && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <svg className="h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Existing account warning */}
            {emailStatus === "exists" && (
              <div className="mt-3">
                <ExistingAccountBanner
                  email={formData.email}
                  callbackUrl="/reservation"
                  onDismiss={() => setEmailStatus("dismissed")}
                />
              </div>
            )}
          </Field>

          {/* Phone */}
          <Field label="Téléphone" htmlFor="phone" required>
            <div className="relative">
              <InputIcon><Phone size={18} /></InputIcon>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+33 6 12 34 56 78"
                className="w-full rounded-lg border-2 border-gray-200 py-3 pl-10 pr-4 transition-all focus:border-[#C8A46A] focus:outline-none"
                required
              />
            </div>
          </Field>

          {/* Newsletter */}
          <div>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="newsletterSubscribed"
                checked={formData.newsletterSubscribed}
                onChange={handleChange}
                className="mt-1 h-5 w-5 rounded border-gray-300 text-[#C8A46A] focus:ring-[#C8A46A]"
              />
              <span className="text-sm text-gray-600">
                Je souhaite recevoir des offres exclusives et des actualités par email
              </span>
            </label>
          </div>
        </div>

        {/* ── Notes ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border-2 border-gray-200 p-6">
          <Field label="Notes" htmlFor="notes">
            <div className="relative">
              <div className="pointer-events-none absolute left-3 top-3 text-gray-400">
                <MessageSquare size={18} />
              </div>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Des demandes particulières ? Faites-le nous savoir..."
                rows={4}
                className="w-full rounded-lg border-2 border-gray-200 py-3 pl-10 pr-4 transition-all focus:border-[#C8A46A] focus:outline-none resize-none"
              />
            </div>
          </Field>
        </div>

        <button
          type="submit"
          disabled={sendingVerification}
          className={`w-full rounded-lg px-6 py-4 text-base font-semibold text-white transition-all ${
            sendingVerification
              ? "cursor-not-allowed bg-gray-400"
              : "bg-[#C8A46A] hover:bg-[#B8945A]"
          }`}
        >
          {sendingVerification ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Envoi de l'email de vérification…
            </span>
          ) : (
            "Continuer vers le récapitulatif"
          )}
        </button>
      </form>
    </div>
  );
}
