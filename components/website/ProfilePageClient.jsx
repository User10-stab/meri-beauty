"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { updateMyProfile } from "@/actions/customer/profile";

function Field({ label, error, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  "w-full border border-neutral-200 px-4 py-3 text-sm focus:border-gold focus:outline-none";

export function ProfilePageClient({ user }) {
  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const hasChanges =
    fullName !== user.fullName || email !== user.email || phone !== user.phone || newPassword.length > 0;

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

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[700px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon profil</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Mes informations
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[700px] px-6 py-12 md:px-10">
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
        </div>
      </section>
    </>
  );
}
