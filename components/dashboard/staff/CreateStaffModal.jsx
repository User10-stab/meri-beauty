"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  X,
  Loader2,
  UserPlus,
  User,
  Mail,
  Phone,
  Globe,
  FileText,
  Calendar,
  FileSignature,
  Info,
  Camera,
  Briefcase,
  Layers,
  Hash,
} from "lucide-react";
import { createIndependentStaff } from "@/actions/staff/create-independent-staff";
import { createStaffFromRental } from "@/actions/staff/create-staff-from-rental";
import { createIndependentStaffSchema } from "@/lib/validations/independent-staff";
import { LanguageTagInput } from "./LanguageTagInput";
import { ServiceMultiSelect } from "./ServiceMultiSelect";
import { StaffPermissionsField } from "./StaffPermissionsField";
import { DEFAULT_STAFF_PERMISSIONS } from "@/lib/authorization";
import { optimizeImage, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES } from "@/lib/imageOptimization";
import Button from "@/components/ui/Button";

// ─── Reusable field primitives ────────────────────────────────────────────────

function FieldError({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1 text-xs font-medium text-red-600">
      {message}
    </p>
  );
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

function TextInput({ id, error, className = "", ...props }) {
  return (
    <input
      id={id}
      className={`h-9 w-full rounded-lg border px-3 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
        error
          ? "border-red-300 focus:border-red-400 focus:ring-red-100"
          : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
      } ${className}`}
      {...props}
    />
  );
}

function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50">
        <Icon size={14} className="text-indigo-600" />
      </div>
      <h3 className="text-sm font-semibold text-gray-700">{children}</h3>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  );
}

// ─── Photo upload widget ──────────────────────────────────────────────────────

function PhotoUpload({ value, onChange, error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value ?? null);

  async function handleFile(file) {
    if (!file) return;

    // Client-side type guard (mirrors server)
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error("Format non accepté. Utilisez JPEG, PNG, WebP ou GIF.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error("Le fichier ne doit pas dépasser 25 Mo.");
      return;
    }

    let fileToUpload = file;
    try {
      fileToUpload = await optimizeImage(file);
    } catch (err) {
      toast.error(err?.message ?? "Impossible de traiter l'image. Veuillez réessayer avec une autre image.");
      return;
    }
    if (fileToUpload.size > MAX_OUTPUT_BYTES) {
      toast.error("L'image reste trop volumineuse après optimisation (>10 Mo). Essayez avec une image plus légère.");
      return;
    }

    // Show local preview immediately (optimized)
    const objectUrl = URL.createObjectURL(fileToUpload);
    setPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", fileToUpload);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();

      if (data.success) {
        onChange(data.url);
      } else {
        toast.error(data.message ?? "Erreur lors du téléversement.");
        setPreview(null);
        onChange(null);
      }
    } catch {
      toast.error("Erreur réseau lors du téléversement.");
      setPreview(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  function handleChange(e) {
    handleFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] ?? null);
  }

  function clearPhoto(e) {
    e.stopPropagation();
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Téléverser une photo de profil"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`relative flex h-24 w-24 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed transition-colors ${
          error
            ? "border-red-300 hover:border-red-400"
            : "border-gray-300 hover:border-indigo-400"
        } ${uploading ? "opacity-60" : ""}`}
      >
        {preview ? (
          <>
            <img
              src={preview}
              alt="Aperçu photo de profil"
              className="h-full w-full object-cover"
            />
            {/* Remove button */}
            <button
              type="button"
              onClick={clearPhoto}
              aria-label="Supprimer la photo"
              className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
            >
              <X size={10} />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            {uploading ? (
              <Loader2 size={20} className="animate-spin text-indigo-500" />
            ) : (
              <>
                <Camera size={20} />
                <span className="text-center text-[10px] leading-tight">
                  Photo
                </span>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={handleChange}
          aria-hidden="true"
        />
      </div>
      <p className="mt-1.5 max-w-[112px] text-center text-[11px] leading-tight text-gray-400">
        Pour une qualité optimale, utilisez une image de moins de 10&nbsp;Mo.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function CreateStaffModal({ onClose, services = [], initialValues = {}, onSuccess, serverAction }) {
  const action = serverAction ?? createIndependentStaff;
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createIndependentStaffSchema),
    defaultValues: {
      fullName:          initialValues.fullName ?? "",
      email:             initialValues.email ?? "",
      phone:             initialValues.phone ?? "",
      photo:             null,
      bio:               "",
      languages:         [],
      yearsOfExperience: "",
      hireDate:          "",
      vatNumber:         "",
      serviceIds:        [],
      dashboardPermissions: initialValues.dashboardPermissions ?? [...DEFAULT_STAFF_PERMISSIONS],
      contract: {
        fixedRent: initialValues.contract?.fixedRent ?? "",
        startDate: initialValues.contract?.startDate ?? "",
        endDate:   initialValues.contract?.endDate ?? "",
        notes:     initialValues.contract?.notes ?? "",
      },
    },
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function onSubmit(data) {
    startTransition(async () => {
      const res = await action(data);
      if (res.success) {
        toast.success(res.message);
        onSuccess?.(res);
        onClose();
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl">

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100">
              <UserPlus size={17} className="text-indigo-600" />
            </div>
            <div>
              <h2
                id="create-modal-title"
                className="text-base font-semibold text-gray-900"
              >
                Nouvel auto-entrepreneur
              </h2>
              <p className="text-xs text-gray-400">
                Un mot de passe sera généré et envoyé par e-mail.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Scrollable body ───────────────────────────────────────── */}
        <form
          id="create-staff-form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex-1 space-y-6 overflow-y-auto px-6 py-5"
        >

          {/* ── Section 1: Informations personnelles ─────────────── */}
          <div>
            <SectionTitle icon={User}>Informations personnelles</SectionTitle>

            {/* Photo + name row */}
            <div className="mb-3 flex items-start gap-4">
              {/* Photo upload */}
              <Controller
                name="photo"
                control={control}
                render={({ field }) => (
                  <PhotoUpload
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.photo?.message}
                  />
                )}
              />

              {/* Name */}
              <div className="flex-1">
                <Label htmlFor="fullName" icon={User} required>
                  Nom complet
                </Label>
                <TextInput
                  id="fullName"
                  type="text"
                  placeholder="ex. Leïla Benali"
                  error={errors.fullName}
                  {...register("fullName")}
                />
                <FieldError message={errors.fullName?.message} />
              </div>
            </div>

            {/* Email + phone */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="email" icon={Mail} required>
                  Adresse e-mail
                </Label>
                <TextInput
                  id="email"
                  type="email"
                  placeholder="leila@exemple.com"
                  error={errors.email}
                  {...register("email")}
                />
                <FieldError message={errors.email?.message} />
              </div>
              <div>
                <Label htmlFor="phone" icon={Phone} required>
                  Téléphone
                </Label>
                <TextInput
                  id="phone"
                  type="tel"
                  placeholder="+33 6 12 34 56 78"
                  error={errors.phone}
                  {...register("phone")}
                />
                <FieldError message={errors.phone?.message} />
              </div>
            </div>
          </div>

          {/* ── Section 2: Profil professionnel ──────────────────── */}
          <div>
            <SectionTitle icon={Briefcase}>Profil professionnel</SectionTitle>
            <div className="space-y-3">

              {/* Languages tag input */}
              <div>
                <Label htmlFor="languages" icon={Globe} required>
                  Langues parlées
                </Label>
                <Controller
                  name="languages"
                  control={control}
                  render={({ field }) => (
                    <LanguageTagInput
                      id="languages"
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.languages?.message}
                    />
                  )}
                />
                <FieldError message={errors.languages?.message} />
              </div>

              {/* Bio */}
              <div>
                <Label htmlFor="bio" icon={FileText}>
                  Biographie
                </Label>
                <textarea
                  id="bio"
                  rows={3}
                  placeholder="Courte présentation du professionnel..."
                  {...register("bio")}
                  className={`w-full resize-none rounded-lg border px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:ring-2 ${
                    errors.bio
                      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                      : "border-gray-200 focus:border-indigo-400 focus:ring-indigo-100"
                  }`}
                />
                <div className="flex justify-end mt-1">
                  <span className={`text-xs ${watch("bio")?.length > 500 ? 'text-red-600' : 'text-gray-400'}`}>
                    {watch("bio")?.length || 0}/500
                  </span>
                </div>
                <FieldError message={errors.bio?.message} />
              </div>

              {/* Years of experience + hire date */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="yearsOfExperience" icon={Briefcase} required>
                    Années d'expérience
                  </Label>
                  <TextInput
                    id="yearsOfExperience"
                    type="number"
                    min="0"
                    max="60"
                    step="1"
                    placeholder="ex. 5"
                    error={errors.yearsOfExperience}
                    {...register("yearsOfExperience")}
                  />
                  <FieldError message={errors.yearsOfExperience?.message} />
                </div>
                <div>
                  <Label htmlFor="hireDate" icon={Calendar}>
                    Date d'embauche
                  </Label>
                  <TextInput
                    id="hireDate"
                    type="date"
                    error={errors.hireDate}
                    {...register("hireDate")}
                  />
                  <FieldError message={errors.hireDate?.message} />
                </div>
              </div>

              {/* VAT Number */}
              <div>
                <Label htmlFor="vatNumber" icon={Hash} required>
                  Numéro de TVA
                </Label>
                <TextInput
                  id="vatNumber"
                  type="text"
                  placeholder="ex. BE0123456789"
                  error={errors.vatNumber}
                  {...register("vatNumber")}
                />
                <FieldError message={errors.vatNumber?.message} />
              </div>
            </div>
          </div>

          {/* ── Section 3: Services ───────────────────────────────── */}
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
              Le prix et la durée de chaque service pourront être configurés après la création.
            </p>
          </div>

          {/* ── Section 4: Contrat (obligatoire, toujours FIXED_RENT) ── */}
          <div>
            <SectionTitle icon={Layers}>Autorisations du tableau de bord</SectionTitle>
            <Controller
              name="dashboardPermissions"
              control={control}
              render={({ field }) => (
                <StaffPermissionsField
                  value={field.value ?? []}
                  onChange={field.onChange}
                  error={errors.dashboardPermissions?.message}
                />
              )}
            />
          </div>

          {/* ── Section 5: Contrat (obligatoire, toujours FIXED_RENT) ── */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50">
                <FileSignature size={14} className="text-indigo-600" />
              </div>
              <h3 className="text-sm font-semibold text-gray-700">Contrat</h3>
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-600">
                Obligatoire
              </span>
              <div className="flex-1 border-t border-gray-100" />
            </div>

            <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
              {/* Fixed rent amount */}
              <div>
                <Label htmlFor="fixedRent" required>
                  Montant du loyer mensuel (€)
                </Label>
                <TextInput
                  id="fixedRent"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="ex. 500"
                  error={errors.contract?.fixedRent}
                  {...register("contract.fixedRent")}
                />
                <FieldError message={errors.contract?.fixedRent?.message} />
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="contractStart" icon={Calendar} required>
                    Date de début
                  </Label>
                  <TextInput
                    id="contractStart"
                    type="date"
                    error={errors.contract?.startDate}
                    {...register("contract.startDate")}
                  />
                  <FieldError message={errors.contract?.startDate?.message} />
                </div>
                <div>
                  <Label htmlFor="contractEnd" icon={Calendar}>
                    Date de fin
                  </Label>
                  <TextInput
                    id="contractEnd"
                    type="date"
                    error={errors.contract?.endDate}
                    {...register("contract.endDate")}
                  />
                  <FieldError message={errors.contract?.endDate?.message} />
                </div>
              </div>

              {/* Notes */}
              <div>
                <Label htmlFor="contractNotes">Notes (optionnel)</Label>
                <textarea
                  id="contractNotes"
                  rows={2}
                  placeholder="Conditions particulières, remarques..."
                  {...register("contract.notes")}
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <FieldError message={errors.contract?.notes?.message} />
              </div>
            </div>
          </div>

          {/* Password notice */}
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <Info size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-700">
              Un mot de passe sécurisé sera{" "}
              <strong>généré automatiquement</strong> et envoyé à l'adresse
              e-mail du professionnel. Aucune saisie manuelle n'est nécessaire.
            </p>
          </div>
        </form>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <Button 
            type="submit"
            form="create-staff-form"
            disabled={isPending}>

               {isPending ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Création en cours…
              </>
            ) : (
              <>
                <UserPlus size={15} />
                Créer le profil
              </>
            )}
            </Button>
        </div>
      </div>
    </div>
  );
}
