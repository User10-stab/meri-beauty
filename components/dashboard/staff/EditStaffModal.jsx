"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  X,
  Loader2,
  User,
  Calendar,
  FileText,
  Globe,
  Camera,
  Briefcase,
  Phone,
  FileSignature,
  Layers,
  Info,
} from "lucide-react";
import { updateIndependentStaff } from "@/actions/staff/update-independent-staff";
import { updateIndependentStaffSchema } from "@/lib/validations/independent-staff";
import { LanguageTagInput } from "./LanguageTagInput";
import { ServiceMultiSelect } from "./ServiceMultiSelect";

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT_TYPE_LABELS  = { PERCENTAGE: "Commission", FIXED_RENT: "Loyer fixe", HYBRID: "Hybride" };
const CONTRACT_STATUS_LABELS = { ACTIVE: "Actif", EXPIRED: "Expiré", TERMINATED: "Résilié" };
const CONTRACT_STATUS_STYLES = {
  ACTIVE:     "bg-emerald-50 text-emerald-700 border border-emerald-200",
  EXPIRED:    "bg-amber-50 text-amber-700 border border-amber-200",
  TERMINATED: "bg-red-50 text-red-700 border border-red-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function FieldError({ message }) {
  if (!message) return null;
  return <p role="alert" className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function Label({ htmlFor, icon: Icon, required, children }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-600"
    >
      {Icon && <Icon size={13} className="text-gray-400" />}
      {children}
      {required && <span className="ml-0.5 text-red-400">*</span>}
    </label>
  );
}

function TextInput({ id, error, ...props }) {
  return (
    <input
      id={id}
      className={`h-9 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100"
          : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
      }`}
      {...props}
    />
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
        <Icon size={13} className="text-indigo-600" />
      </div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</h4>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="flex-shrink-0 whitespace-nowrap text-gray-400">{label}</span>
      <span className="text-right text-gray-700">{value}</span>
    </div>
  );
}

// ─── Photo upload widget (mirrors CreateStaffModal) ───────────────────────────

function PhotoUpload({ value, onChange, error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value ?? null);

  // Keep preview in sync when staff changes (modal re-opens)
  useEffect(() => { setPreview(value ?? null); }, [value]);

  async function handleFile(file) {
    if (!file) return;
    if (file){
          console.log({
        name: file.name,
        size: file.size,
        type: file.type,
      });
    }
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) { toast.error("Format non accepté. Utilisez JPEG, PNG, WebP ou GIF."); return; }
    if (file.size > 20 * 1024 * 1024)  { toast.error("Le fichier ne doit pas dépasser 20 Mo."); return; }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) { onChange(data.url); }
      else { toast.error(data.message ?? "Erreur lors du téléversement."); setPreview(value ?? null); onChange(value ?? null); }
    } catch { toast.error("Erreur réseau lors du téléversement."); setPreview(value ?? null); onChange(value ?? null); }
    finally  { setUploading(false); }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Modifier la photo de profil"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
        onDragOver={(e) => e.preventDefault()}
        className={`relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed transition-colors ${
          error ? "border-red-300" : "border-gray-300 hover:border-indigo-400"
        } ${uploading ? "opacity-60" : ""}`}
      >
        {preview ? (
          <img src={preview} alt="Photo de profil" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            {uploading ? <Loader2 size={18} className="animate-spin text-indigo-500" /> : <Camera size={18} />}
          </div>
        )}
        {preview && !uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity hover:opacity-100">
            <Camera size={16} className="text-white" />
          </div>
        )}
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} aria-hidden="true" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── View mode ────────────────────────────────────────────────────────────────

function ViewContent({ staff }) {
  return (
    <div className="space-y-5">
      {/* Photo + identity */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-indigo-100">
          {staff.photo ? (
            <img src={staff.photo} alt={staff.user.fullName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-indigo-600 uppercase">
              {staff.user.fullName.slice(0, 2)}
            </div>
          )}
        </div>
        <div>
          <p className="font-semibold text-gray-900">{staff.user.fullName}</p>
          <p className="text-sm text-indigo-600">{staff.user.email}</p>
          <p className="text-xs text-gray-400">{staff.user.phone}</p>
        </div>
      </div>

      {/* Account */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
        <SectionTitle icon={User}>Compte</SectionTitle>
        <InfoRow label="Créé le"      value={formatDate(staff.user.createdAt)} />
        <InfoRow label="Statut"       value={staff.isActive ? "Actif" : "Inactif"} />
        <InfoRow label="E-mail vérifié" value={staff.user.emailVerified ? "Oui" : "Non"} />
      </div>

      {/* Profile */}
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
        <SectionTitle icon={Briefcase}>Profil</SectionTitle>
        <InfoRow label="Années d'exp." value={staff.yearsOfExperience != null ? `${staff.yearsOfExperience} an${staff.yearsOfExperience > 1 ? "s" : ""}` : "—"} />
        <InfoRow label="Date d'embauche" value={formatDate(staff.hireDate)} />
        <InfoRow
          label="Langues"
          value={staff.languages?.length > 0 ? staff.languages.join(", ") : "—"}
        />
        <InfoRow label="Biographie" value={staff.bio || "—"} />
        <InfoRow label="Services" value={`${staff.servicesCount ?? 0} service${(staff.servicesCount ?? 0) !== 1 ? "s" : ""}`} />
      </div>

      {/* Contract */}
      {staff.contract && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
          <SectionTitle icon={FileSignature}>Contrat actif</SectionTitle>
          <InfoRow label="Type"   value={CONTRACT_TYPE_LABELS[staff.contract.type]   ?? staff.contract.type} />
          <InfoRow label="Statut" value={CONTRACT_STATUS_LABELS[staff.contract.status] ?? staff.contract.status} />
          {staff.contract.fixedRent != null && (
            <InfoRow label="Loyer mensuel" value={`${staff.contract.fixedRent} €`} />
          )}
          {staff.contract.commissionPercentage != null && (
            <InfoRow label="Commission" value={`${staff.contract.commissionPercentage} %`} />
          )}
          <InfoRow label="Début" value={formatDate(staff.contract.startDate)} />
          <InfoRow label="Fin"   value={formatDate(staff.contract.endDate)} />
          {staff.contract.notes && (
            <InfoRow label="Notes" value={staff.contract.notes} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({ staff, services, onSuccess, onCancel }) {
  const [addContract, setAddContract] = useState(!!staff.contract);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(updateIndependentStaffSchema),
    defaultValues: {
      id:                staff.id,
      fullName:          staff.user.fullName,
      phone:             staff.user.phone,
      photo:             staff.photo     ?? null,
      bio:               staff.bio       ?? "",
      languages:         staff.languages ?? [],
      yearsOfExperience: staff.yearsOfExperience ?? "",
      hireDate:          staff.hireDate ? staff.hireDate.slice(0, 10) : "",
      isActive:          staff.isActive,
      serviceIds:        staff.serviceIds ?? [],   // pre-populated from server fetch
      contract: staff.contract
        ? {
            fixedRent: staff.contract.fixedRent ?? "",
            startDate: staff.contract.startDate ? staff.contract.startDate.slice(0, 10) : "",
            endDate:   staff.contract.endDate   ? staff.contract.endDate.slice(0, 10)   : "",
            notes:     staff.contract.notes     ?? "",
          }
        : null,
    },
  });

  function onSubmit(data) {
    const payload = {
      ...data,
      contract: addContract ? data.contract : null,
    };
    startTransition(async () => {
      const res = await updateIndependentStaff(payload);
      if (res.success) {
        toast.success(res.message);
        onSuccess();
      } else {
        if (res.errors) {
          const first = Object.values(res.errors).find(Boolean);
          if (first) toast.error(first);
        } else {
          toast.error(res.message);
        }
      }
    });
  }

  return (
    <form id="edit-staff-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <input type="hidden" {...register("id")} />

      {/* ── Photo + identity ──────────────────────────────────────── */}
      <div>
        <SectionTitle icon={User}>Informations personnelles</SectionTitle>
        <div className="flex items-start gap-4 mb-3">
          <Controller
            name="photo"
            control={control}
            render={({ field }) => (
              <PhotoUpload value={field.value} onChange={field.onChange} error={errors.photo?.message} />
            )}
          />
          <div className="flex-1 space-y-3">
            <div>
              <Label htmlFor="editFullName" icon={User} required>Nom complet</Label>
              <TextInput id="editFullName" type="text" error={errors.fullName} {...register("fullName")} />
              <FieldError message={errors.fullName?.message} />
            </div>
            <div>
              <Label htmlFor="editPhone" icon={Phone} required>Téléphone</Label>
              <TextInput id="editPhone" type="tel" placeholder="+33 6 12 34 56 78" error={errors.phone} {...register("phone")} />
              <FieldError message={errors.phone?.message} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Professional profile ───────────────────────────────────── */}
      <div>
        <SectionTitle icon={Briefcase}>Profil professionnel</SectionTitle>
        <div className="space-y-3">

          {/* Languages */}
          <div>
            <Label htmlFor="editLanguages" icon={Globe} required>Langues parlées</Label>
            <Controller
              name="languages"
              control={control}
              render={({ field }) => (
                <LanguageTagInput id="editLanguages" value={field.value} onChange={field.onChange} error={errors.languages?.message} />
              )}
            />
            <FieldError message={errors.languages?.message} />
          </div>

          {/* Bio */}
          <div>
            <Label htmlFor="editBio" icon={FileText}>Biographie</Label>
            <textarea
              id="editBio"
              rows={3}
              placeholder="Courte présentation..."
              {...register("bio")}
              className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
                errors.bio ? "border-red-300 focus:border-red-400 focus:ring-red-100" : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
              }`}
            />
            <FieldError message={errors.bio?.message} />
          </div>

          {/* Years of experience + hire date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="editYears" icon={Briefcase}>Années d'expérience</Label>
              <TextInput id="editYears" type="number" min="0" max="60" step="1" placeholder="ex. 5" error={errors.yearsOfExperience} {...register("yearsOfExperience")} />
              <FieldError message={errors.yearsOfExperience?.message} />
            </div>
            <div>
              <Label htmlFor="editHireDate" icon={Calendar}>Date d'embauche</Label>
              <TextInput id="editHireDate" type="date" error={errors.hireDate} {...register("hireDate")} />
              <FieldError message={errors.hireDate?.message} />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Profil actif</p>
              <p className="text-xs text-gray-400">Un profil inactif n'apparaît pas sur la plateforme.</p>
            </div>
            <Controller
              name="isActive"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${field.value ? "bg-indigo-600" : "bg-gray-200"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${field.value ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              )}
            />
          </div>
        </div>
      </div>

      {/* ── Services ──────────────────────────────────────────────── */}
      {services && services.length >= 0 && (
        <div>
          <SectionTitle icon={Layers}>Services proposés</SectionTitle>
          <Controller
            name="serviceIds"
            control={control}
            render={({ field }) => (
              <ServiceMultiSelect
                services={services}
                value={field.value ?? []}
                onChange={field.onChange}
                error={errors.serviceIds?.message}
              />
            )}
          />
          <FieldError message={errors.serviceIds?.message} />
          <p className="mt-1.5 text-xs text-gray-400">
            Les services retirés qui ont des rendez-vous seront désactivés, pas supprimés.
          </p>
        </div>
      )}

      {/* ── Contract ──────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
              <FileSignature size={13} className="text-indigo-600" />
            </div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Contrat</h4>
            <div className="w-8 border-t border-gray-100" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={addContract}
              onChange={(e) => setAddContract(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            {addContract ? "Modifier le contrat" : "Ajouter un contrat"}
          </label>
        </div>

        {addContract && (
          <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
            {/* Fixed rent badge */}
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2">
              <FileSignature size={13} className="text-indigo-400" />
              <span className="text-sm font-medium text-indigo-700">Loyer fixe (FIXED_RENT)</span>
              <span className="ml-auto text-xs text-gray-400">Type automatique</span>
            </div>

            <div>
              <Label htmlFor="editFixedRent" required>Montant du loyer mensuel (€)</Label>
              <TextInput id="editFixedRent" type="number" min="0" step="0.01" placeholder="ex. 500" error={errors.contract?.fixedRent} {...register("contract.fixedRent")} />
              <FieldError message={errors.contract?.fixedRent?.message} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="editContractStart" icon={Calendar} required>Date de début</Label>
                <TextInput id="editContractStart" type="date" error={errors.contract?.startDate} {...register("contract.startDate")} />
                <FieldError message={errors.contract?.startDate?.message} />
              </div>
              <div>
                <Label htmlFor="editContractEnd" icon={Calendar}>Date de fin</Label>
                <TextInput id="editContractEnd" type="date" error={errors.contract?.endDate} {...register("contract.endDate")} />
                <FieldError message={errors.contract?.endDate?.message} />
              </div>
            </div>

            <div>
              <Label htmlFor="editContractNotes">Notes</Label>
              <textarea
                id="editContractNotes"
                rows={2}
                placeholder="Conditions particulières..."
                {...register("contract.notes")}
                className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              <FieldError message={errors.contract?.notes?.message} />
            </div>
          </div>
        )}

        {/* Notice when contract is being terminated */}
        {!addContract && staff.contract?.status === "ACTIVE" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <Info size={14} className="mt-0.5 flex-shrink-0 text-amber-500" />
            <p className="text-xs text-amber-700">
              Le contrat actif sera <strong>résilié</strong> lors de la sauvegarde si vous laissez cette option décochée.
            </p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          form="edit-staff-form"
          disabled={isPending || !isDirty}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          {isPending && <Loader2 size={15} className="animate-spin" />}
          Enregistrer les modifications
        </button>
      </div>
    </form>
  );
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

/**
 * @param {{
 *   staff:   object,
 *   mode:    "view" | "edit",
 *   onClose: () => void,
 *   services?: Array<{ id: string, name: string, category: { id: string, name: string } }>,
 * }} props
 */
export function EditStaffModal({ staff, mode, onClose, services = [] }) {
  const [currentMode, setCurrentMode] = useState(mode);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset mode when staff changes (e.g. switching rows without closing)
  useEffect(() => { setCurrentMode(mode); }, [mode, staff.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-indigo-100">
              {staff.photo ? (
                <img src={staff.photo} alt={staff.user.fullName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-indigo-600 uppercase">
                  {staff.user.fullName.slice(0, 2)}
                </div>
              )}
            </div>
            <div>
              <h2 id="edit-modal-title" className="text-base font-semibold text-gray-900">
                {currentMode === "view" ? "Profil auto-entrepreneur" : "Modifier le profil"}
              </h2>
              <p className="text-xs text-gray-400">{staff.user.fullName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle view ↔ edit */}
            {currentMode === "view" ? (
              <button
                type="button"
                onClick={() => setCurrentMode("edit")}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                Modifier
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentMode("view")}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Voir
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {currentMode === "view" ? (
            <ViewContent staff={staff} />
          ) : (
            <EditForm
              staff={staff}
              services={services}
              onSuccess={onClose}
              onCancel={() => setCurrentMode("view")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
