"use client";

import { Phone, Mail, MapPin, Clock, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { sendContactMessage } from "@/actions/contact/send-contact-message";

const DAYS_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const DAY_LABELS = {
  MONDAY: "Lun",
  TUESDAY: "Mar",
  WEDNESDAY: "Mer",
  THURSDAY: "Jeu",
  FRIDAY: "Ven",
  SATURDAY: "Sam",
  SUNDAY: "Dim",
};

const INITIAL_FORM = {
  name: "",
  email: "",
  phone: "",
  subject: "",
  message: "",
};

export default function ContactFormSection({ salon }) {
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState({});
  const [isPending, setIsPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrors({});
    setServerError("");
    setSuccess(false);
    setIsPending(true);

    const result = await sendContactMessage(formData);

    setIsPending(false);

    if (result.success) {
      setSuccess(true);
      setFormData(INITIAL_FORM);
    } else {
      if (result.errors) {
        setErrors(result.errors);
      }
      if (result.message) {
        setServerError(result.message);
      }
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    // Clear field error on change
    if (errors[e.target.name]) {
      setErrors((prev) => ({ ...prev, [e.target.name]: null }));
    }
  };

  function formatHours(workingDays) {
    if (!workingDays || workingDays.length === 0) {
      return "Horaires non disponibles";
    }

    // Group consecutive days with same hours
    const openDays = workingDays.filter((d) => d.isOpen);
    if (openDays.length === 0) return "Fermé";

    const groups = [];
    let currentGroup = [openDays[0]];

    for (let i = 1; i < openDays.length; i++) {
      const prev = openDays[i - 1];
      const curr = openDays[i];
      const prevIdx = DAYS_ORDER.indexOf(prev.day);
      const currIdx = DAYS_ORDER.indexOf(curr.day);

      if (
        currIdx === prevIdx + 1 &&
        prev.openingTime === curr.openingTime &&
        prev.closingTime === curr.closingTime
      ) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    groups.push(currentGroup);

    return groups.map((group) => {
      const start = DAY_LABELS[group[0].day];
      const end = DAY_LABELS[group[group.length - 1].day];
      const dayRange = group.length === 1 ? start : `${start} - ${end}`;
      return `${dayRange}: ${group[0].openingTime} - ${group[0].closingTime}`;
    });
  }

  const phone = salon?.phone || "+32 123 456 789";
  const email = salon?.email || "contact@meribeauty.be";
  const address = salon?.address || "66 Broklyn Golden Street\nJette, Belgique";
  const workingHours = salon?.workingDays ? formatHours(salon.workingDays) : ["Lun - Ven: 8:00 - 19:00", "Sam: 8:00 - 15:30"];

  return (
    <section className="w-full bg-cream py-16 lg:py-24">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-14 xl:px-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          
          {/* Left Side - Contact Form */}
          <div className="flex flex-col">
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px w-12 bg-gold" />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
                  Envoyez-nous un message
                </span>
              </div>
              <h2 className="text-[2rem] font-bold leading-tight text-ink sm:text-[2.4rem] lg:text-[2.8rem]">
                Nous sommes là pour vous
              </h2>
            </div>

            {/* Success message */}
            {success && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-sm text-green-800">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-green-600" />
                <div>
                  <p className="font-semibold">Message envoyé avec succès !</p>
                  <p className="mt-1 text-green-700">
                    Nous vous répondrons dans les plus brefs délais.
                  </p>
                </div>
              </div>
            )}

            {/* Server error message */}
            {serverError && !success && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
                <AlertCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
                <p>{serverError}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Nom complet
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className={`w-full border-b-2 bg-transparent px-4 py-3 text-ink placeholder:text-ink/40 focus:outline-none transition-colors ${
                      errors.name
                        ? "border-red-400 focus:border-red-500"
                        : "border-gold/30 focus:border-gold"
                    }`}
                    placeholder="Votre nom"
                  />
                  {errors.name && (
                    <p className="mt-1 text-[12px] font-medium text-red-600">{errors.name}</p>
                  )}
                </div>
                <div>
                  <label className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    className={`w-full border-b-2 bg-transparent px-4 py-3 text-ink placeholder:text-ink/40 focus:outline-none transition-colors ${
                      errors.email
                        ? "border-red-400 focus:border-red-500"
                        : "border-gold/30 focus:border-gold"
                    }`}
                    placeholder="votre@email.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-[12px] font-medium text-red-600">{errors.email}</p>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                  Téléphone
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className={`w-full border-b-2 bg-transparent px-4 py-3 text-ink placeholder:text-ink/40 focus:outline-none transition-colors ${
                    errors.phone
                      ? "border-red-400 focus:border-red-500"
                      : "border-gold/30 focus:border-gold"
                  }`}
                  placeholder="+32 123 456 789"
                />
                {errors.phone && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">{errors.phone}</p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                  Sujet
                </label>
                <input
                  type="text"
                  name="subject"
                  value={formData.subject}
                  onChange={handleChange}
                  required
                  className={`w-full border-b-2 bg-transparent px-4 py-3 text-ink placeholder:text-ink/40 focus:outline-none transition-colors ${
                    errors.subject
                      ? "border-red-400 focus:border-red-500"
                      : "border-gold/30 focus:border-gold"
                  }`}
                  placeholder="Sujet de votre message"
                />
                {errors.subject && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">{errors.subject}</p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                  Message
                </label>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  required
                  rows={5}
                  className={`w-full border-b-2 bg-transparent px-4 py-3 text-ink placeholder:text-ink/40 focus:outline-none transition-colors resize-none ${
                    errors.message
                      ? "border-red-400 focus:border-red-500"
                      : "border-gold/30 focus:border-gold"
                  }`}
                  placeholder="Votre message..."
                />
                {errors.message && (
                  <p className="mt-1 text-[12px] font-medium text-red-600">{errors.message}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-3 rounded-full bg-primary px-8 py-4 text-[0.9rem] font-semibold uppercase tracking-wider text-white transition-all duration-300 hover:bg-primary-dark hover:shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Envoi en cours…
                  </>
                ) : (
                  "Envoyer le message"
                )}
              </button>
            </form>
          </div>

          {/* Right Side - Contact Information */}
          <div className="flex flex-col justify-center space-y-8 lg:pl-12 bg-gold/10 p-8 rounded-xl">
            <div className="mb-8">
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px w-12 bg-gold" />
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
                  Informations de contact
                </span>
              </div>
              <h2 className="text-[2rem] font-bold leading-tight text-ink sm:text-[2.4rem] lg:text-[2.8rem]">
                Restons en contact
              </h2>
            </div>

            <div className="space-y-6">
              {/* Phone */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10">
                  <Phone className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Téléphone
                  </h3>
                  <p className="text-[1.1rem] text-ink">{phone}</p>
                </div>
              </div>

              {/* Email */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10">
                  <Mail className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Email
                  </h3>
                  <p className="text-[1.1rem] text-ink">{email}</p>
                </div>
              </div>

              {/* Address */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10">
                  <MapPin className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Adresse
                  </h3>
                  <p className="text-[1.1rem] leading-relaxed text-ink whitespace-pre-line">
                    {address}
                  </p>
                </div>
              </div>

              {/* Hours */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/10">
                  <Clock className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-[0.13em] text-ink/70">
                    Heures d'ouverture
                  </h3>
                  <p className="text-[1.1rem] leading-relaxed text-ink">
                    {workingHours.map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < workingHours.length - 1 && <br />}
                      </span>
                    ))}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}