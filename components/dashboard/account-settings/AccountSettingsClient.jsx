"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User,
  FileText,
  Settings2,
  Clock,
  CreditCard,
  Loader2,
  Save,
  Upload,
  Plus,
  X,
  Trash2,
  Mail,
  Phone,
  Lock,
  IdCard,
} from "lucide-react";
import { updatePersonalInfo } from "@/actions/staff/update-personal-info";
import { updateStaffProfile } from "@/actions/staff/update-staff-profile";
import { updateReservationSettings } from "@/actions/staff/update-reservation-settings";
import { upsertMyWorkingHours } from "@/actions/staff/upsert-my-working-hours";
import { createStaffTimeOff } from "@/actions/staff/manage-time-off";
import { updatePaymentSettings } from "@/actions/staff/update-payment-settings";
import Button from "@/components/ui/Button";

// ─── Constants ─────────────────────────────────────────────────────────────

const DAY_LABELS = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

// ─── Reusable UI Primitives ────────────────────────────────────────────────

function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-[11px] font-medium text-red-600">{message}</p>;
}

function Label({ icon: Icon, required, children }) {
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
      {Icon && <Icon size={12} className="text-gray-400 dark:text-gray-500" />}
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function TextInput({ id, error, className = "", ...props }) {
  return (
    <input
      id={id}
      className={`h-9 w-full rounded-lg border px-3 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100 dark:border-red-700/50 dark:focus:ring-red-900/30"
          : "border-gray-200 focus:border-gray-300 focus:ring-gray-100 dark:border-gray-700 dark:focus:border-gray-600 dark:focus:ring-gray-700/50"
      } ${className}`}
      {...props}
    />
  );
}

function Textarea({ id, error, className = "", ...props }) {
  return (
    <textarea
      id={id}
      className={`min-h-[76px] w-full resize-none rounded-lg border px-3 py-2 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100 dark:border-red-700/50 dark:focus:ring-red-900/30"
          : "border-gray-200 focus:border-gray-300 focus:ring-gray-100 dark:border-gray-700 dark:focus:border-gray-600 dark:focus:ring-gray-700/50"
      } ${className}`}
      {...props}
    />
  );
}

function SectionCard({ icon: Icon, title, description, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-3 dark:border-gray-800">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-50 dark:bg-gray-800">
          <Icon size={14} className="text-gray-500 dark:text-gray-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
        checked ? "bg-gray-900 dark:bg-white" : "bg-gray-200 dark:bg-gray-700"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 dark:bg-gray-900 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatShortDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ─── Main Export ───────────────────────────────────────────────────────────

export function AccountSettingsClient({ initialData }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
            <User size={20} className="text-gray-400 dark:text-gray-500" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">
            Informations non disponibles
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Vos paramètres n'ont pas pu être chargés. Veuillez réessayer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
         <PersonalInfoSection data={data} onSuccess={(updated) => setData((prev) => ({ ...prev, ...updated }))} />
          <ProfileSection data={data} onSuccess={(updated) => setData((prev) => ({ ...prev, ...updated }))} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ContractSection data={data} />
        <ReservationSettingsSection data={data} onSuccess={(updated) => setData((prev) => ({ ...prev, ...updated }))} />
      </div>
      <PaymentSettingsSection data={data} onSuccess={(updated) => setData((prev) => ({ ...prev, ...updated }))} />
      <WorkingHoursSection data={data} onSuccess={(wh) => setData((prev) => ({ ...prev, workingHours: wh }))} />
      <TimeOffSection data={data} onSuccess={(timeOffs) => setData((prev) => ({ ...prev, timeOffs }))} />
    </div>
  );
}

// ─── Section 1: Personal Info ──────────────────────────────────────────────

function PersonalInfoSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();

  const user = data?.user ?? {};

  const [fullName, setFullName] = useState(user.fullName ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [errors, setErrors] = useState({});

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const payload = { currentPassword };

      if (fullName !== user.fullName) payload.fullName = fullName;
      if (email !== user.email) payload.email = email;
      if (phone !== user.phone) payload.phone = phone;
      if (newPassword) payload.newPassword = newPassword;

      const res = await updatePersonalInfo(payload);
      if (res.success) {
        toast.success(res.message);
        setCurrentPassword("");
        setNewPassword("");
        setShowPasswordFields(false);
        // Merge the optimistic data
        const updatedUser = { ...user };
        if (payload.fullName) updatedUser.fullName = payload.fullName;
        if (payload.email) updatedUser.email = payload.email;
        if (payload.phone) updatedUser.phone = payload.phone;
        onSuccess({ user: updatedUser });
      } else {
        if (res.errors) {
          setErrors(res.errors);
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  const hasChanges =
    fullName !== user.fullName ||
    email !== user.email ||
    phone !== user.phone ||
    newPassword.length > 0;

  return (
    <SectionCard icon={IdCard} title="Informations personnelles" description="Gérez votre nom, vos coordonnées et votre mot de passe.">
      <div className="space-y-3.5">
        {/* Full Name */}
        <div>
          <Label icon={User} required>Nom complet</Label>
          <TextInput
            placeholder="Votre nom complet"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={errors.fullName}
          />
          <FieldError message={errors.fullName} />
        </div>

        {/* Email */}
        <div>
          <Label icon={Mail} required>Email</Label>
          <TextInput
            type="email"
            placeholder="exemple@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <FieldError message={errors.email} />
        </div>

        {/* Phone */}
        <div>
          <Label icon={Phone} required>Téléphone</Label>
          <TextInput
            type="tel"
            placeholder="+33 1 23 45 67 89"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            error={errors.phone}
          />
          <FieldError message={errors.phone} />
        </div>

        {/* Password section toggle */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-800/50">
          <div className="flex items-center gap-2.5">
            <Lock size={16} className="text-gray-400 dark:text-gray-500" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Mot de passe</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {newPassword ? "Un nouveau mot de passe sera défini" : "Laissez ce champ vide pour conserver le mot de passe actuel"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPasswordFields((prev) => !prev)}
            className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            {showPasswordFields ? "Annuler" : "Modifier"}
          </button>
        </div>

        {showPasswordFields && (
          <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3.5 dark:border-gray-800 dark:bg-gray-800/50">
            <div>
              <Label icon={Lock} required>Nouveau mot de passe</Label>
              <TextInput
                type="password"
                placeholder="Minimum 8 caractères"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={errors.newPassword}
              />
              <FieldError message={errors.newPassword} />
            </div>
          </div>
        )}

        {/* Current password — always required when saving changes */}
        {hasChanges && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/30 dark:bg-amber-900/15">
            <Label icon={Lock} required>Mot de passe actuel</Label>
            <TextInput
              type="password"
              placeholder="Saisissez votre mot de passe actuel pour confirmer"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              error={errors.currentPassword}
            />
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              Votre mot de passe actuel est requis pour appliquer les modifications.
            </p>
            <FieldError message={errors.currentPassword} />
          </div>
        )}

        <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button onClick={handleSave} disabled={isPending || !hasChanges || !currentPassword}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Enregistrer</>
            )}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section 2: Profile ────────────────────────────────────────────────────

function ProfileSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [photo, setPhoto] = useState(data?.photo ?? "");
  const [bio, setBio] = useState(data?.bio ?? "");
  const [languages, setLanguages] = useState(data?.languages ?? []);
  const [languageInput, setLanguageInput] = useState("");
  const [yearsOfExperience, setYearsOfExperience] = useState(data?.yearsOfExperience ?? "");

  const [errors, setErrors] = useState({});

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", "staff");

    setUploading(true);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (json.success) {
        setPhoto(json.url);
        toast.success("Photo téléversée avec succès.");
      } else {
        toast.error(json.message);
      }
    } catch {
      toast.error("Erreur lors du téléversement.");
    }
    setUploading(false);
  }

  function addLanguage() {
    const val = languageInput.trim();
    if (!val) return;
    if (languages.includes(val)) {
      toast.error("Cette langue est déjà ajoutée.");
      return;
    }
    setLanguages([...languages, val]);
    setLanguageInput("");
  }

  function removeLanguage(lang) {
    setLanguages(languages.filter((l) => l !== lang));
  }

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const res = await updateStaffProfile({
        photo: photo || null,
        bio: bio || null,
        languages,
        yearsOfExperience: yearsOfExperience !== "" ? Number(yearsOfExperience) : null,
      });
      if (res.success) {
        toast.success(res.message);
        onSuccess({ photo, bio, languages, yearsOfExperience });
        router.refresh();
      } else {
        if (res.errors) {
          setErrors(res.errors);
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <SectionCard icon={User} title="Profil" description="Photo, biographie, langues et expérience professionnelle.">
      <div className="space-y-4">
        {/* Photo */}
        <div>
          <Label>Photo de profil</Label>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
              {photo ? (
                <img src={photo} alt="Photo de profil" className="h-full w-full object-cover" />
              ) : (
                <User size={20} className="text-gray-400 dark:text-gray-500" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                {uploading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Upload size={12} />
                )}
                {uploading ? "Téléversement…" : "Choisir une photo"}
              </button>
              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto("")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm transition-all hover:bg-red-50 dark:border-red-900/30 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={12} /> Supprimer
                </button>
              )}
            </div>
          </div>
          <FieldError message={errors.photo} />
        </div>

        {/* Bio */}
        <div>
          <Label>Biographie</Label>
          <Textarea
            placeholder="Parlez de vous, de votre parcours, de vos spécialités…"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
          <div className="mt-1.5 flex justify-end">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{bio.length}/500</span>
          </div>
          <FieldError message={errors.bio} />
        </div>

        {/* Languages */}
        <div>
          <Label required>Langues parlées</Label>
          <div className="flex items-center gap-2">
            <TextInput
              placeholder="ex. Français, Anglais, Arabe…"
              value={languageInput}
              onChange={(e) => setLanguageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLanguage(); } }}
            />
            <button
              type="button"
              onClick={addLanguage}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <Plus size={15} />
            </button>
          </div>
          {languages.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {languages.map((lang) => (
                <span
                  key={lang}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {lang}
                  <button
                    type="button"
                    onClick={() => removeLanguage(lang)}
                    className="inline-flex transition-colors hover:text-red-600 dark:hover:text-red-400"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <FieldError message={errors.languages} />
        </div>

        {/* Years of Experience */}
        <div className="max-w-[180px]">
          <Label>Années d'expérience</Label>
          <TextInput
            type="number"
            min={0}
            max={60}
            placeholder="ex. 5"
            value={yearsOfExperience}
            onChange={(e) => setYearsOfExperience(e.target.value)}
          />
          <FieldError message={errors.yearsOfExperience} />
        </div>

        <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Enregistrer le profil</>
            )}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section 3: Contract (Read‑only) ───────────────────────────────────────

function ContractSection({ data }) {
  const contract = data?.contract;

  if (!contract) {
    return (
      <SectionCard icon={FileText} title="Contrat" description="Consultez votre contrat de location.">
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText size={32} className="mb-2 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Aucun contrat associé à votre profil.
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Contactez la direction pour plus d'informations.
          </p>
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard icon={FileText} title="Contrat" description="Consultez votre contrat de location.">
      <div className="space-y-4">
        {/* Monthly Rent */}
        <div className="max-w-[180px]">
          <Label>Loyer mensuel (€)</Label>
          <div className="h-9 flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
            {contract.fixedRent != null
              ? Number(contract.fixedRent).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : "—"}
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Date de début</Label>
            <div className="h-9 flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
              {contract.startDate ? formatDate(contract.startDate) : "—"}
            </div>
          </div>
          <div>
            <Label>Date de fin</Label>
            <div className="h-9 flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
              {contract.endDate ? formatDate(contract.endDate) : "Non définie"}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <Label>Notes</Label>
          <div className="min-h-[76px] w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white">
            {contract.notes || "Aucune note."}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section 4: Reservation Settings ───────────────────────────────────────

function ReservationSettingsSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();

  const [confirmationMode, setConfirmationMode] = useState(
    data?.reservationConfirmationMode ?? "MANUAL"
  );
  const [depositEnabled, setDepositEnabled] = useState(data?.depositEnabled ?? false);
  const [depositPercentage, setDepositPercentage] = useState(
    data?.depositPercentage?.toString() ?? "10"
  );
  const [errors, setErrors] = useState({});

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const res = await updateReservationSettings({
        confirmationMode,
        depositEnabled,
        depositPercentage: depositEnabled ? Number(depositPercentage) : null,
      });
      if (res.success) {
        toast.success(res.message);
        onSuccess({
          reservationConfirmationMode: confirmationMode,
          depositEnabled,
          depositPercentage: depositEnabled ? Number(depositPercentage) : 0,
        });
      } else {
        if (res.errors) {
          setErrors(res.errors);
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <SectionCard
      icon={Settings2}
      title="Paramètres de réservation"
      description="Configurez la confirmation des rendez-vous et les acomptes."
    >
      <div className="space-y-4">
        {/* Confirmation Mode */}
        <div>
          <Label required>Mode de confirmation</Label>
          <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setConfirmationMode("AUTOMATIC")}
              className={`rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                confirmationMode === "AUTOMATIC"
                  ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-800"
                  : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
              }`}
            >
              <div className="text-xs font-semibold text-gray-900 dark:text-white">Automatique</div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Les rendez-vous sont confirmés immédiatement
              </div>
            </button>
            <button
              type="button"
              onClick={() => setConfirmationMode("MANUAL")}
              className={`rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                confirmationMode === "MANUAL"
                  ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-800"
                  : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
              }`}
            >
              <div className="text-xs font-semibold text-gray-900 dark:text-white">Manuel</div>
              <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                Vous confirmez chaque rendez-vous
              </div>
            </button>
          </div>
          <FieldError message={errors.confirmationMode} />
        </div>

        {/* Deposit Toggle */}
        <div className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-800/50">
          <div>
            <p className="text-xs font-medium text-gray-900 dark:text-white">Acompte</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Exiger un acompte à la réservation
            </p>
          </div>
          <Toggle checked={depositEnabled} onChange={() => setDepositEnabled((prev) => !prev)} />
        </div>

        {/* Deposit Percentage */}
        {depositEnabled && (
          <div className="max-w-[180px]">
            <Label required>Pourcentage de l'acompte</Label>
            <div className="relative">
              <TextInput
                type="number"
                min={1}
                max={100}
                step="0.1"
                placeholder="ex. 30"
                value={depositPercentage}
                onChange={(e) => setDepositPercentage(e.target.value)}
                error={errors.depositPercentage}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
            </div>
            <FieldError message={errors.depositPercentage} />
          </div>
        )}

        <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Enregistrer les paramètres</>
            )}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section 5: Payment Settings ───────────────────────────────────────────

const PAYMENT_METHOD_LABELS = {
  BOTH: "Paiement en ligne et en espèces",
  ONLINE_ONLY: "Paiement en ligne uniquement",
  CASH_ONLY: "Paiement en espèces uniquement",
};

const PAYMENT_METHOD_DESCRIPTIONS = {
  BOTH: "Les clients pourront payer en ligne ou au salon.",
  ONLINE_ONLY: "Les clients ne pourront payer qu'en ligne.",
  CASH_ONLY: "Les clients ne pourront payer qu'au salon.",
};

function PaymentSettingsSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();

  const [allowedPaymentMethods, setAllowedPaymentMethods] = useState(
    data?.allowedPaymentMethods ?? "BOTH"
  );

  function handleSave() {
    startTransition(async () => {
      const res = await updatePaymentSettings({ allowedPaymentMethods });
      if (res.success) {
        toast.success(res.message);
        onSuccess({ allowedPaymentMethods });
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <SectionCard
      icon={CreditCard}
      title="Paramètres de paiement"
      description="Choisissez les modes de paiement que vous acceptez pour vos services."
    >
      <div className="space-y-4">
        <div>
          <Label required>Modes de paiement acceptés</Label>
          <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAllowedPaymentMethods(key)}
                className={`rounded-lg border px-3.5 py-2.5 text-left transition-all ${
                  allowedPaymentMethods === key
                    ? "border-gray-900 bg-gray-50 dark:border-white dark:bg-gray-800"
                    : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                }`}
              >
                <div className="text-xs font-semibold text-gray-900 dark:text-white">{label}</div>
                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {PAYMENT_METHOD_DESCRIPTIONS[key]}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Enregistrer les paramètres</>
            )}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// ─── Section 6: Working Hours ──────────────────────────────────────────────

function WorkingHoursSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();

  const existingMap = {};
  (data?.workingHours ?? []).forEach((wh) => {
    existingMap[wh.day] = wh;
  });

  const [days, setDays] = useState(
    DAY_ORDER.map((day) => {
      const existing = existingMap[day];
      return existing
        ? { ...existing }
        : { day, startTime: "09:00", endTime: "17:00", isClosed: false };
    })
  );

  const [errors, setErrors] = useState({});

  function toggleDay(index) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, isClosed: !d.isClosed } : d)));
  }

  function updateTime(index, field, value) {
    setDays((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
  }

  function applySameHours() {
    const firstOpenDay = days.find((d) => !d.isClosed);
    if (firstOpenDay) {
      setDays((prev) =>
        prev.map((d) =>
          !d.isClosed ? { ...d, startTime: firstOpenDay.startTime, endTime: firstOpenDay.endTime } : d
        )
      );
      toast.success("Horaires appliqués à tous les jours ouverts.");
    }
  }

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const res = await upsertMyWorkingHours({ days });
      if (res.success) {
        toast.success(res.message);
        onSuccess(days);
      } else {
        if (res.errors) {
          setErrors(res.errors);
          toast.error(res.errors.days || res.message);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <SectionCard
      icon={Clock}
      title="Horaires de travail"
      description="Gérez vos disponibilités hebdomadaires."
    >
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={applySameHours}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Appliquer les mêmes horaires
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400">Jour</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400">Statut</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400">Début</th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400">Fin</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day, i) => (
              <tr key={day.day} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-medium ${day.isClosed ? "text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-white"}`}>
                    {DAY_LABELS[day.day]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Toggle checked={!day.isClosed} onChange={() => toggleDay(i)} />
                    <span className={`text-xs ${day.isClosed ? "text-gray-400 dark:text-gray-500" : "text-gray-900 dark:text-white"}`}>
                      {day.isClosed ? "Fermé" : "Ouvert"}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {!day.isClosed ? (
                    <input
                      type="time"
                      value={day.startTime}
                      onChange={(e) => updateTime(i, "startTime", e.target.value)}
                      className="h-8 w-[88px] rounded-lg border border-gray-200 bg-transparent px-2.5 text-xs text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:text-white dark:focus:border-gray-600"
                    />
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {!day.isClosed ? (
                    <input
                      type="time"
                      value={day.endTime}
                      onChange={(e) => updateTime(i, "endTime", e.target.value)}
                      className="h-8 w-[88px] rounded-lg border border-gray-200 bg-transparent px-2.5 text-xs text-gray-900 outline-none transition focus:border-gray-300 dark:border-gray-700 dark:text-white dark:focus:border-gray-600"
                    />
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {errors.days && (
        <div className="mt-2.5 text-[11px] font-medium text-red-600">{errors.days}</div>
      )}

      <div className="mt-4 flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? (
            <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
          ) : (
            <><Save size={16} /> Enregistrer les horaires</>
          )}
        </Button>
      </div>
    </SectionCard>
  );
}

function TimeOffSection({ data, onSuccess }) {
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState({});

  const timeOffs = data?.timeOffs ?? [];

  function handleSave() {
    setErrors({});
    startTransition(async () => {
      const res = await createStaffTimeOff({ startDate, endDate, reason });
      if (res.success) {
        toast.success(res.message);
        onSuccess([...(timeOffs || []), res.data]);
        setStartDate(new Date().toISOString().split("T")[0]);
        setEndDate(new Date().toISOString().split("T")[0]);
        setReason("");
      } else {
        if (res.errors) {
          setErrors(res.errors);
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <SectionCard
      icon={Clock}
      title="Indisponibilités"
      description="Ajoutez des périodes pendant lesquelles vous ne serez pas disponible."
    >
      <div className="space-y-3.5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label required>Date de début</Label>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
            <FieldError message={errors.startDate} />
          </div>
          <div>
            <Label required>Date de fin</Label>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} />
            <FieldError message={errors.endDate} />
          </div>
        </div>

        <div>
          <Label>Motif</Label>
          <Textarea
            placeholder="Ex. Congé, formation, visite médicale…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={errors.reason}
          />
          <FieldError message={errors.reason} />
        </div>

        <div className="flex justify-end border-t border-gray-100 pt-3.5 dark:border-gray-800">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={16} /> Ajouter l’indisponibilité</>
            )}
          </Button>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3.5 dark:border-gray-800 dark:bg-gray-800/30">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Périodes enregistrées</p>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">{timeOffs.length}</span>
          </div>

          {timeOffs.length > 0 ? (
            <div className="space-y-1.5">
              {timeOffs.map((item) => (
                <div key={item.id} className="flex flex-col gap-0.5 rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs dark:border-gray-800 dark:bg-gray-900/70 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {formatDate(item.startDate)} {item.endDate && item.endDate !== item.startDate ? `– ${formatDate(item.endDate)}` : ""}
                    </p>
                    {item.reason ? <p className="text-[11px] text-gray-500 dark:text-gray-400">{item.reason}</p> : null}
                  </div>
                  <span className="inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                    Indisponible
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Aucune indisponibilité définie pour le moment.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}