"use client";

import { useEffect, useState, useRef, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, Calendar, Euro, Clock, Users, Globe2, BookOpen, Camera } from "lucide-react";
import Button from "@/components/ui/Button";
import { createActivity, updateActivity } from "@/actions/workshops/create-activity";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function ModalField({ label, children, required = false }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
        {required ? <span className="ml-1 text-red-400">*</span> : null}
      </label>
      {children}
    </div>
  );
}

function CoverUpload({ value, onChange, error }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(value ?? null);

  useEffect(() => {
    setPreview(value);
  }, [value]);

  async function handleFile(file) {
    if (!file) return;

    // Client-side guard
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED.includes(file.type)) {
      toast.error("Format non accepté. Utilisez JPEG, PNG, WebP ou GIF.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Le fichier ne doit pas dépasser 20 Mo.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "activities");
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
      toast.error("Erreur réseau.");
      setPreview(null);
      onChange(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div
        onClick={() => inputRef.current?.click()}
        className={`relative flex h-40 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-gray-50/50 hover:bg-gray-50 hover:border-indigo-400 transition-all overflow-hidden ${
          error ? "border-red-300" : "border-gray-300"
        }`}
      >
        {preview ? (
          <>
            <img src={preview} alt="Couverture" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPreview(null);
                onChange(null);
              }}
              className="absolute top-2 right-2 p-1.5 bg-red-500 hover:bg-red-600 rounded-full text-white shadow transition-colors"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1.5 text-gray-500">
            {uploading ? (
              <Loader2 className="animate-spin text-indigo-600" size={24} />
            ) : (
              <>
                <Camera size={24} className="text-gray-400" />
                <span className="text-sm font-medium">Image de couverture</span>
                <span className="text-xs text-gray-400">JPEG, PNG, WebP (max. 20Mo)</span>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function CreateActivityModal({ open, onClose, onCreated, activity, animators = [] }) {
  const isEditing = !!activity;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({
    type: "WORKSHOP",
    title: "",
    description: "",
    cover: "",
    price: "",
    duration: "",
    capacity: "",
    language: "Français",
    animatorId: "",
    status: "DRAFT",
    allowMultipleSessions: false,
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    if (activity) {
      setForm({
        type: activity.type ?? "WORKSHOP",
        title: activity.title ?? "",
        description: activity.description ?? "",
        cover: activity.cover ?? "",
        price: activity.price ?? "",
        duration: activity.duration ?? "",
        capacity: activity.capacity ?? "",
        language: activity.language ?? "Français",
        animatorId: activity.animatorId ?? "",
        status: activity.status ?? "DRAFT",
        allowMultipleSessions: activity.allowMultipleSessions ?? false,
      });
    } else {
      setForm({
        type: "WORKSHOP",
        title: "",
        description: "",
        cover: "",
        price: "",
        duration: "",
        capacity: "",
        language: "Français",
        animatorId: "",
        status: "DRAFT",
        allowMultipleSessions: false,
      });
    }
    setErrors({});
  }, [open, activity]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    startLoading(async () => {
      const payload = {
        ...form,
        price: form.price === "" ? 0 : parseFloat(form.price),
        duration: form.duration === "" ? 0 : parseInt(form.duration, 10),
        capacity: form.capacity === "" ? 0 : parseInt(form.capacity, 10),
      };

      const result = isEditing
        ? await updateActivity({ id: activity.id, ...payload })
        : await createActivity(payload);

      if (result.success) {
        toast.success(result.message);
        onCreated?.();
        onClose();
      } else {
        setErrors(result.errors ?? {});
        toast.error(result.message || "Une erreur est survenue.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl my-8">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEditing ? "Modifier l'activité" : "Nouvelle activité"}
            </h2>
            <p className="text-xs text-gray-500">
              {isEditing ? "Modifier les détails du workshop ou de l'événement" : "Créer un nouveau workshop ou événement"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5 max-h-[75vh] overflow-y-auto">
          {/* Cover upload */}
          <CoverUpload
            value={form.cover}
            onChange={(url) => setForm((prev) => ({ ...prev, cover: url }))}
            error={errors.cover}
          />

          {/* Type Selector */}
          <ModalField label="Type d'activité" required>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, type: "WORKSHOP" }))}
                className={`flex items-center justify-center py-2 px-4 border rounded-lg text-sm font-medium transition-all ${
                  form.type === "WORKSHOP"
                    ? "bg-amber-50 border-amber-500 text-amber-900 shadow-sm"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                Workshop (Atelier)
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, type: "EVENT" }))}
                className={`flex items-center justify-center py-2 px-4 border rounded-lg text-sm font-medium transition-all ${
                  form.type === "EVENT"
                    ? "bg-sky-50 border-sky-500 text-sky-900 shadow-sm"
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
              >
                Événement
              </button>
            </div>
            <FieldError message={errors.type} />
          </ModalField>

          {/* Title */}
          <ModalField label="Titre de l'activité" required>
            <div className="relative">
              <BookOpen size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                placeholder="ex. Masterclass Balayage & Brillance"
              />
            </div>
            <FieldError message={errors.title} />
          </ModalField>

          {/* Description */}
          <ModalField label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100 min-h-[80px] resize-none"
              placeholder="Détails de l'activité..."
            />
            <FieldError message={errors.description} />
          </ModalField>

          {/* Pricing, Duration & Capacity */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Price */}
            <ModalField label="Tarif (€)" required>
              <div className="relative">
                <Euro size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="0.00"
                />
              </div>
              <FieldError message={errors.price} />
            </ModalField>

            {/* Duration */}
            <ModalField label="Durée (min)" required>
              <div className="relative">
                <Clock size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  required
                  value={form.duration}
                  onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="120"
                />
              </div>
              <FieldError message={errors.duration} />
            </ModalField>

            {/* Capacity */}
            <ModalField label="Capacité (pers.)" required>
              <div className="relative">
                <Users size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="number"
                  required
                  value={form.capacity}
                  onChange={(e) => setForm((prev) => ({ ...prev, capacity: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="10"
                />
              </div>
              <FieldError message={errors.capacity} />
            </ModalField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Language */}
            <ModalField label="Langue">
              <div className="relative">
                <Globe2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={form.language}
                  onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
                  placeholder="ex. Français, Anglais"
                />
              </div>
              <FieldError message={errors.language} />
            </ModalField>

            {/* Animator */}
            <ModalField label="Animateur Externe">
              <select
                value={form.animatorId}
                onChange={(e) => setForm((prev) => ({ ...prev, animatorId: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">-- Sélectionner un animateur --</option>
                {animators.map((animator) => (
                  <option key={animator.id} value={animator.id}>
                    {animator.name}
                  </option>
                ))}
              </select>
              <FieldError message={errors.animatorId} />
            </ModalField>
          </div>

          {/* Status & Options */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2 border-t border-gray-100">
            {/* Status */}
            <ModalField label="Statut" required>
              <select
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 bg-white outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="DRAFT">Brouillon</option>
                <option value="PUBLISHED">Publié</option>
                <option value="CANCELLED">Annulé</option>
                <option value="ARCHIVED">Archivé</option>
              </select>
              <FieldError message={errors.status} />
            </ModalField>

            {/* Allow Multiple Sessions */}
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.allowMultipleSessions}
                  onChange={(e) => setForm((prev) => ({ ...prev, allowMultipleSessions: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-gray-700">Autoriser plusieurs sessions</span>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <Button type="submit" disabled={loading} className="bg-[#2f3a2e]">
              {loading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
              {isEditing ? "Mettre à jour" : "Créer l'activité"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
