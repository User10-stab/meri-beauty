"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, Star, Mail, Receipt, BadgeCheck, BadgeX, ShieldQuestion, MapPin, Building2 } from "lucide-react";
import { updateMyProfile } from "@/actions/customer/profile";
import { updateNewsletterPreference, updateMyVatNumber, updateMyAddress, updateMyBillingProfile } from "@/actions/customer/settings";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { createAppointmentReview } from "@/actions/review/review-actions";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/review-eligibility";
import { CountrySelect } from "@/components/shared/CountrySelect";

function Field({ label, error, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function formatAppointmentDate(startTime) {
  return new Date(startTime).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatAppointmentTime(startTime, endTime) {
  const start = new Date(startTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  const end = new Date(endTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return `${start} → ${end}`;
}

function formatReviewDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function StarRatingInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3, 4, 5].map((rating) => {
        const active = rating <= value;
        return (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            className="rounded-full p-1 transition-transform hover:scale-110"
            aria-label={`${rating} étoile${rating > 1 ? "s" : ""}`}
          >
            <Star className={`h-7 w-7 ${active ? "fill-[#C8A46A] text-[#C8A46A]" : "text-neutral-300"}`} />
          </button>
        );
      })}
    </div>
  );
}

function StaticStars({ rating }) {
  return (
    <div className="flex items-center gap-1 text-[#C8A46A]">
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          className={`h-4 w-4 ${index < rating ? "fill-current" : "text-neutral-300"}`}
        />
      ))}
    </div>
  );
}

function ReviewModal({ appointment, onClose, onSaved }) {
  const [rating, setRating] = useState(appointment.review?.rating ?? 0);
  const [comment, setComment] = useState(appointment.review?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const result = await createAppointmentReview({
      appointmentId: appointment.id,
      rating,
      comment,
    });

    setSubmitting(false);

    if (result.success) {
      toast.success(result.message);
      onSaved({
        id: result.data.id,
        rating: result.data.rating,
        comment: result.data.comment,
        createdAt: result.data.createdAt,
      });
      return;
    }

    if (result.errors) {
      setErrors(result.errors);
    }
    toast.error(result.message);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg border border-neutral-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Laisser un avis</p>
            <h3 className="mt-1 text-xl font-bold text-primary">{appointment.serviceName}</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {formatAppointmentDate(appointment.startTime)} • {formatAppointmentTime(appointment.startTime, appointment.endTime)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-neutral-400 hover:text-neutral-600">
            Fermer
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <Field label="Votre note" error={errors.rating}>
            <StarRatingInput value={rating} onChange={setRating} />
          </Field>

          <Field label="Commentaire (optionnel)" error={errors.comment}>
            <textarea
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={REVIEW_COMMENT_MAX_LENGTH}
              placeholder="Partagez votre expérience…"
              className="w-full resize-none border border-neutral-200 px-4 py-3 text-sm focus:border-gold focus:outline-none"
            />
          </Field>

          <div className="flex justify-end gap-3 border-t border-neutral-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="border border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white hover:bg-gold/90 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Envoyer l&apos;avis
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AppointmentReviewCard({ appointment, onReviewCreated }) {
  const canLeaveReview = appointment.status === "COMPLETED" && !appointment.review;

  return (
    <div className="border border-ink/8 bg-white p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">{appointment.serviceName}</p>
          <p className="mt-1 text-sm text-neutral-500">Avec {appointment.staffName}</p>
          <p className="mt-2 text-sm text-neutral-600">
            {formatAppointmentDate(appointment.startTime)} • {formatAppointmentTime(appointment.startTime, appointment.endTime)}
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className={`inline-flex items-center px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            appointment.status === "COMPLETED"
              ? "bg-emerald-50 text-emerald-700"
              : appointment.status === "CONFIRMED"
                ? "bg-blue-50 text-blue-700"
                : appointment.status === "PENDING"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-neutral-100 text-neutral-500"
          }`}>
            {appointment.status}
          </span>

          {canLeaveReview ? (
            <button
              type="button"
              onClick={() => onReviewCreated(appointment, null)}
              className="inline-flex items-center gap-2 border border-[#C8A46A] px-4 py-2 text-sm font-semibold text-[#C8A46A] hover:bg-[#C8A46A]/5"
            >
              <Star className="h-4 w-4 fill-current" />
              Laisser un avis
            </button>
          ) : appointment.review ? (
            <div className="rounded-md bg-neutral-50 px-4 py-2 text-sm text-neutral-600">
              <StaticStars rating={appointment.review.rating} />
              <p className="mt-1 font-medium">Avis envoyé</p>
            </div>
          ) : null}
        </div>
      </div>

      {appointment.review && (
        <div className="mt-4 border-t border-neutral-200 pt-4">
          <StaticStars rating={appointment.review.rating} />
          <p className="mt-2 text-xs text-neutral-400">Envoyé le {formatReviewDate(appointment.review.createdAt)}</p>
          {appointment.review.comment && <p className="mt-2 text-sm text-neutral-600">{appointment.review.comment}</p>}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full border border-neutral-200 px-4 py-3 text-sm focus:border-gold focus:outline-none";

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-60 ${
        checked ? "bg-gold" : "bg-ink/15"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

const ADDRESS_COUNTRIES = [
  { value: "BE", label: "Belgique" },
  { value: "FR", label: "France" },
  { value: "LU", label: "Luxembourg" },
  { value: "NL", label: "Pays-Bas" },
  { value: "DE", label: "Allemagne" },
];

function AddressCard({ initialAddress }) {
  const empty = { addressLine1: "", addressLine2: "", addressCity: "", addressPostalCode: "", addressCountry: "BE" };
  const initial = { ...empty, ...(initialAddress ?? {}) };
  const [address, setAddress] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const hasChanges = JSON.stringify(address) !== JSON.stringify(saved);
  const isComplete = Boolean(saved.addressLine1 && saved.addressCity && saved.addressPostalCode);

  function update(field, value) {
    setAddress((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: null }));
  }

  async function handleSave() {
    setSaving(true);
    const result = await updateMyAddress(address);
    setSaving(false);
    if (result.success) {
      toast.success(result.message);
      setSaved(address);
      setErrors({});
    } else {
      toast.error(result.message);
      if (result.errors) setErrors(result.errors);
    }
  }

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Adresse de facturation</p>
          <p className="mt-0.5 text-xs text-ink/50">
            {isComplete
              ? "Utilisée sur vos factures."
              : "Obligatoire pour toute facture — particulier ou entreprise."}
          </p>

          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={address.addressLine1}
              onChange={(e) => update("addressLine1", e.target.value)}
              placeholder="Rue et numéro"
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />
            {errors.addressLine1 && <p className="text-xs text-red-600">{errors.addressLine1}</p>}

            <input
              type="text"
              value={address.addressLine2 ?? ""}
              onChange={(e) => update("addressLine2", e.target.value)}
              placeholder="Boîte, étage (optionnel)"
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />

            <div className="flex flex-wrap gap-2">
              <div className="min-w-27.5 flex-1">
                <input
                  type="text"
                  value={address.addressPostalCode}
                  onChange={(e) => update("addressPostalCode", e.target.value)}
                  placeholder="Code postal"
                  className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
                />
                {errors.addressPostalCode && <p className="text-xs text-red-600">{errors.addressPostalCode}</p>}
              </div>
              <div className="min-w-40 flex-2">
                <input
                  type="text"
                  value={address.addressCity}
                  onChange={(e) => update("addressCity", e.target.value)}
                  placeholder="Ville"
                  className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
                />
                {errors.addressCity && <p className="text-xs text-red-600">{errors.addressCity}</p>}
              </div>
            </div>

            <select
              value={address.addressCountry}
              onChange={(e) => update("addressCountry", e.target.value)}
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            >
              {ADDRESS_COUNTRIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="inline-flex items-center gap-1.5 bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VatNumberCard({ initialVatNumber }) {
  const [vatNumber, setVatNumber] = useState(initialVatNumber ?? "");
  const [savedVatNumber, setSavedVatNumber] = useState(initialVatNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [vatCheck, setVatCheck] = useState(null); // { loading } | { valid, message } | { error, message }

  const hasVatChanges = vatNumber.trim() !== (savedVatNumber ?? "");

  async function handleSave() {
    setSaving(true);
    const result = await updateMyVatNumber(vatNumber);
    setSaving(false);
    if (result.success) {
      toast.success(result.message);
      const savedValue = result.vatNumber ?? vatNumber.trim();
      setVatNumber(savedValue);
      setSavedVatNumber(savedValue);
      setVatCheck(null);
    } else {
      toast.error(result.message);
    }
  }

  async function handleVerify() {
    if (!vatNumber.trim()) {
      toast.error("Renseignez d'abord un numéro de TVA.");
      return;
    }
    setVatCheck({ loading: true });
    const result = await verifyVatNumber(vatNumber);
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

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Numéro de TVA</p>
          <p className="mt-0.5 text-xs text-ink/50">
            Réservez en tant que professionnel(le) et ce numéro apparaîtra sur vos factures — de quoi
            déduire la TVA et passer l&apos;achat en frais professionnels.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="text"
              value={vatNumber}
              onChange={(e) => {
                setVatNumber(e.target.value);
                setVatCheck(null);
              }}
              placeholder="BE0123456789 ou FRXX123456789"
              className="h-10 min-w-0 flex-1 border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={vatCheck?.loading}
              className="inline-flex items-center gap-1.5 border border-neutral-200 px-3 text-xs font-semibold text-ink/60 transition-colors hover:border-gold hover:text-ink disabled:opacity-50"
            >
              {vatCheck?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldQuestion className="h-3.5 w-3.5" />}
              Vérifier
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasVatChanges}
              className="inline-flex items-center gap-1.5 bg-gold px-4 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Enregistrer
            </button>
          </div>

          {vatCheck && !vatCheck.loading && (
            <p
              className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${
                vatCheck.error ? "text-amber-600" : vatCheck.valid ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {vatCheck.error ? (
                <ShieldQuestion className="h-3.5 w-3.5" />
              ) : vatCheck.valid ? (
                <BadgeCheck className="h-3.5 w-3.5" />
              ) : (
                <BadgeX className="h-3.5 w-3.5" />
              )}
              {vatCheck.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function BillingProfileCard({ initialBillingProfile }) {
  const empty = {
    companyLegalName: "",
    companyRegistrationNo: "",
    companyLegalForm: "",
    billingContactName: "",
    purchaseOrderReference: "",
    peppolParticipantId: "",
  };
  const initial = { ...empty, ...(initialBillingProfile ?? {}) };
  const [profile, setProfile] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  const hasChanges = JSON.stringify(profile) !== JSON.stringify(saved);
  const isComplete = Boolean(saved.companyLegalName);

  function update(field, value) {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: null }));
  }

  async function handleSave() {
    setSaving(true);
    const result = await updateMyBillingProfile(profile);
    setSaving(false);
    if (result.success) {
      toast.success(result.message);
      setSaved(profile);
      setErrors({});
    } else {
      toast.error(result.message);
      if (result.errors) setErrors(result.errors);
    }
  }

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">Identité de facturation entreprise</p>
          <p className="mt-0.5 text-xs text-ink/50">
            {isComplete
              ? "Utilisée sur vos factures B2B."
              : "Renseignez votre raison sociale pour recevoir des factures B2B."}
          </p>

          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={profile.companyLegalName}
              onChange={(e) => update("companyLegalName", e.target.value)}
              placeholder="Raison sociale (ex. Doe Consulting SRL)"
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />
            {errors.companyLegalName && <p className="text-xs text-red-600">{errors.companyLegalName}</p>}

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={profile.companyRegistrationNo ?? ""}
                onChange={(e) => update("companyRegistrationNo", e.target.value)}
                placeholder="N° BCE (optionnel)"
                className="h-10 min-w-40 flex-1 border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
              />
              <input
                type="text"
                value={profile.companyLegalForm ?? ""}
                onChange={(e) => update("companyLegalForm", e.target.value)}
                placeholder="Forme juridique (SRL, SA…)"
                className="h-10 min-w-40 flex-1 border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
              />
            </div>

            <input
              type="text"
              value={profile.billingContactName ?? ""}
              onChange={(e) => update("billingContactName", e.target.value)}
              placeholder="Contact facturation (optionnel)"
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />

            <input
              type="text"
              value={profile.purchaseOrderReference ?? ""}
              onChange={(e) => update("purchaseOrderReference", e.target.value)}
              placeholder="Référence bon de commande (optionnel)"
              className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
            />

            <div>
              <input
                type="text"
                value={profile.peppolParticipantId ?? ""}
                onChange={(e) => update("peppolParticipantId", e.target.value)}
                placeholder="Identifiant Peppol (optionnel, ex. 9925:BE0823758741)"
                className="h-10 w-full border border-neutral-200 px-4 text-sm focus:border-gold focus:outline-none"
              />
              {errors.peppolParticipantId ? (
                <p className="mt-1 text-xs text-red-600">{errors.peppolParticipantId}</p>
              ) : (
                <p className="mt-1 text-xs text-ink/40">
                  Pour recevoir vos factures directement sur le réseau Peppol plutôt que par e-mail.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="inline-flex items-center gap-1.5 bg-gold px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProfilePageClient({ user, initialNewsletterSubscribed, initialVatNumber, initialAddress, initialBillingProfile }) {
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [appointments, setAppointments] = useState(user.appointments ?? []);
  const [reviewModalAppointment, setReviewModalAppointment] = useState(null);
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(initialNewsletterSubscribed);
  const [newsletterPending, setNewsletterPending] = useState(false);

  const hasChanges =
    fullName !== user.fullName || email !== user.email || phone !== user.phone || newPassword.length > 0;

  const appointmentCards = useMemo(
    () => appointments.map((appointment) => ({
      ...appointment,
      serviceName: appointment.staffService?.service?.name ?? "Rendez-vous",
      staffName: appointment.staffService?.staff?.user?.fullName ?? "—",
    })),
    [appointments]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    setSubmitting(true);

    const payload = { currentPassword };
    if (fullName !== user.fullName) payload.fullName = fullName;
    if (email !== user.email) payload.email = email;
    if (phone !== user.phone) payload.phone = phone;
    if (newPassword) payload.newPassword = newPassword;

    const result = await updateMyProfile(payload);
    setSubmitting(false);

    if (result.success) {
      toast.success(result.message);
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordFields(false);
      user.fullName = fullName;
      user.email = email;
      user.phone = phone;
    } else if (result.errors) {
      setErrors(result.errors);
      const first = Object.values(result.errors).find(Boolean);
      toast.error(first || result.message);
    } else {
      toast.error(result.message);
    }
  }

  function handleNewsletterToggle(next) {
    setNewsletterSubscribed(next);
    setNewsletterPending(true);
    (async () => {
      const result = await updateNewsletterPreference(next);
      setNewsletterPending(false);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
        setNewsletterSubscribed(!next);
      }
    })();
  }

  function handleOpenReview(appointment) {
    setReviewModalAppointment(appointment);
  }

  function handleReviewSaved(review) {
    setAppointments((current) =>
      current.map((appointment) =>
        appointment.id === reviewModalAppointment.id
          ? { ...appointment, review }
          : appointment
      )
    );
    setReviewModalAppointment(null);
  }

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[900px] px-6 text-center md:px-10">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon profil</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Mes informations et réservations
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[900px] space-y-10 px-6 py-12 md:px-10">
          <form onSubmit={handleSubmit} className="space-y-6 border border-ink/8 bg-white p-6 sm:p-8">
            <Field label="Nom complet" error={errors.fullName}>
              <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </Field>

            <Field label="Email" error={errors.email}>
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>

            <Field label="Téléphone" error={errors.phone}>
              <input type="tel" className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>

            <div className="flex items-center justify-between border border-ink/8 bg-cream/60 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Lock className="h-4 w-4 text-ink/40" />
                <div>
                  <p className="text-sm font-medium text-ink">Mot de passe</p>
                  <p className="text-xs text-ink/45">
                    {newPassword ? "Un nouveau mot de passe sera défini" : "Laissez vide pour le conserver"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordFields((prev) => !prev)}
                className="text-sm font-semibold text-gold hover:text-gold/80"
              >
                {showPasswordFields ? "Annuler" : "Modifier"}
              </button>
            </div>

            {showPasswordFields && (
              <Field label="Nouveau mot de passe" error={errors.newPassword}>
                <input
                  type="password"
                  className={inputClass}
                  placeholder="Minimum 8 caractères"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </Field>
            )}

            {hasChanges && (
              <div className="border border-amber-200 bg-amber-50 p-4">
                <Field label="Mot de passe actuel (pour confirmer)" error={errors.currentPassword}>
                  <input
                    type="password"
                    className={inputClass}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </Field>
              </div>
            )}

            <div className="flex justify-end border-t border-ink/8 pt-6">
              <button
                type="submit"
                disabled={submitting || !hasChanges || !currentPassword}
                className="inline-flex items-center gap-2 bg-gold px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer
              </button>
            </div>
          </form>

          <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-gold" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-bold text-ink">Newsletter</p>
                  <p className="mt-0.5 text-xs text-ink/50">
                    Recevez nos actualités, offres et nouveautés par email.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {newsletterPending && <Loader2 className="h-4 w-4 animate-spin text-ink/30" />}
                <Toggle checked={newsletterSubscribed} onChange={handleNewsletterToggle} disabled={newsletterPending} />
              </div>
            </div>
          </div>

          <AddressCard initialAddress={initialAddress} />

          <VatNumberCard initialVatNumber={initialVatNumber} />

          {user.isCompany && <BillingProfileCard initialBillingProfile={initialBillingProfile} />}

          <section className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Mes réservations</p>
              <h2 className="mt-1 text-2xl font-bold text-primary">Rendez-vous et avis</h2>
              <p className="mt-2 text-sm text-neutral-500">
                Vous pouvez laisser un avis une fois votre rendez-vous terminé.
              </p>
            </div>

            {appointmentCards.length === 0 ? (
              <div className="border border-ink/8 bg-white p-6 text-sm text-neutral-500">
                Aucun rendez-vous pour le moment.
              </div>
            ) : (
              <div className="space-y-4">
                {appointmentCards.map((appointment) => (
                  <AppointmentReviewCard
                    key={appointment.id}
                    appointment={appointment}
                    onReviewCreated={handleOpenReview}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

      {reviewModalAppointment && (
        <ReviewModal
          appointment={reviewModalAppointment}
          onClose={() => setReviewModalAppointment(null)}
          onSaved={handleReviewSaved}
        />
      )}
    </>
  );
}
