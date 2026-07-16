"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, Tag, Layers, FileText, Plus, Image } from "lucide-react";
import Button from "@/components/ui/Button";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { createService, updateService, getCategories, getStaffOptions } from "@/actions/services/create-service";
import { InlineCategoryCreate } from "@/components/dashboard/services/InlineCategoryCreate";

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


export function CreateServiceModal({ open, onClose, onCreated, service }) {
  const isEditing = !!service;
  const [categories, setCategories] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [loading, startLoading] = useTransition();
  const [showCategoryCreate, setShowCategoryCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    description: "",
    selectedStaffId: "",
    price: "",
    duration: "",
    margin: "",
    photo: "",
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    
    startLoading(async () => {
      const [catsRes, staffRes] = await Promise.all([
        getCategories(),
        getStaffOptions(),
      ]);

      if (catsRes.success) {
        setCategories(catsRes.data ?? []);
      }
      if (staffRes.success) {
        setStaffOptions(staffRes.data ?? []);
      }
    });
  }, [open]);

  // Pre-fill form when editing
  useEffect(() => {
    if (!open || !service) {
      // Reset form for create mode
      setForm({
        name: "",
        categoryId: "",
        description: "",
        selectedStaffId: "",
        price: "",
        duration: "",
        margin: "",
        photo: "",
      });
      setErrors({});
      return;
    }

    const existingAssignment = service.staffServices?.[0];
    setForm({
      name: service.name ?? "",
      categoryId: service.category?.id ?? "",
      description: service.description ?? "",
      selectedStaffId: existingAssignment?.staffId ?? "",
      price: existingAssignment ? String(existingAssignment.price) : "",
      duration: existingAssignment ? String(existingAssignment.duration) : "",
      margin: existingAssignment?.margin != null ? String(existingAssignment.margin) : "",
      photo: existingAssignment?.photo ?? "",
    });
    setErrors({});
  }, [open, service]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    if (form.selectedStaffId && (!form.price || !form.duration)) {
      setErrors({
        price: !form.price ? "Le prix est obligatoire lorsque vous associez un professionnel." : null,
        duration: !form.duration ? "La durée est obligatoire lorsque vous associez un professionnel." : null,
      });
      return;
    }

    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      description: form.description || null,
      selectedStaffId: form.selectedStaffId || null,
      price: form.selectedStaffId ? (form.price ? parseFloat(form.price) : null) : null,
      duration: form.selectedStaffId ? (form.duration ? parseInt(form.duration) : null) : null,
      margin: form.selectedStaffId ? (form.margin ? parseFloat(form.margin) : null) : null,
      photo: form.selectedStaffId ? (form.photo || null) : null,
    };

    const result = isEditing
      ? await updateService({ id: service.id, ...payload })
      : await createService(payload);

    if (result.success) {
      toast.success(result.message);
      onCreated?.();
      onClose();
    } else {
      setErrors(result.errors ?? {});
      toast.error(result.message || "Impossible de créer le service.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEditing ? "Modifier le service" : "Nouveau service"}
            </h2>
            <p className="text-xs text-gray-500">
              {isEditing ? "Modifier les informations du service" : "Ajouter un service et l'associer à des professionnels"}
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
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Catégorie */}
            <ModalField label="Catégorie" required>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Layers size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    required
                    value={form.categoryId}
                    onChange={(e) => setForm((prev) => ({ ...prev, categoryId: e.target.value }))}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 bg-white"
                  >
                    <option value="">Sélectionner une catégorie…</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCategoryCreate((p) => !p)}
                  title="Créer une nouvelle catégorie"
                  aria-label="Créer une nouvelle catégorie"
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
                    showCategoryCreate
                      ? "border-indigo-400 bg-indigo-100 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                  }`}
                >
                  <Plus size={16} />
                </button>
              </div>
              {showCategoryCreate && (
                <InlineCategoryCreate
                  onCreated={(newCat) => {
                    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name, "fr")));
                    setForm((prev) => ({ ...prev, categoryId: newCat.id }));
                    setShowCategoryCreate(false);
                  }}
                  onCancel={() => setShowCategoryCreate(false)}
                />
              )}
              <FieldError message={errors.categoryId} />
            </ModalField>

            {/* Nom */}
            <ModalField label="Nom du service" required>
              <div className="relative">
                <Tag size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="ex. Coupe Homme"
                />
              </div>
              <FieldError message={errors.name} />
            </ModalField>

            {/* Description */}
            <ModalField label="Description">
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-4 text-gray-400" />
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 min-h-[80px] resize-none"
                  placeholder="Description du service..."
                />
              </div>
              <FieldError message={errors.description} />
            </ModalField>

            {/* Professionnel */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Associer à un professionnel (Optionnel)
              </label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                {staffOptions.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun professionnel disponible</p>
                ) : (
                  staffOptions.map((staff) => (
                    <label
                      key={staff.id}
                      className="flex cursor-pointer items-center gap-2.5 text-sm text-gray-700 hover:text-gray-900"
                    >
                      <input
                        type="radio"
                        name="selectedStaff"
                        value={staff.id}
                        checked={form.selectedStaffId === staff.id}
                        onChange={(e) => {
                          setForm((prev) => ({ 
                            ...prev, 
                            selectedStaffId: e.target.value,
                            price: "",
                            duration: "",
                            margin: "",
                            photo: "",
                          }));
                        }}
                        className="h-4 w-4 rounded-full border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                      />
                      {staff.user.fullName}
                    </label>
                  ))
                )}
              </div>
              <p className="text-[10px] text-gray-400 italic">
                Sélectionnez un seul professionnel pour ce service.
              </p>
            </div>

            {/* Price, Duration, Margin, and Photo fields (only shown when staff is selected) */}
            {form.selectedStaffId && (
              <div className="space-y-4 border-t border-gray-100 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  {/* Price */}
                  <ModalField label="Prix (€)" required>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={form.price}
                        onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        placeholder="0.00"
                      />
                    </div>
                    <FieldError message={errors.price} />
                  </ModalField>

                  {/* Duration */}
                  <ModalField label="Durée (minutes)" required>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>
                      <input
                        type="number"
                        min="1"
                        required
                        value={form.duration}
                        onChange={(e) => setForm((prev) => ({ ...prev, duration: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        placeholder="30"
                      />
                    </div>
                    <FieldError message={errors.duration} />
                  </ModalField>
                </div>

                {/* Margin */}
                <ModalField label="Marge(minutes)">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.margin}
                      onChange={(e) => setForm((prev) => ({ ...prev, margin: e.target.value }))}
                      className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      placeholder="Optionnel"
                    />
                  </div>
                  <FieldError message={errors.margin} />
                </ModalField>

                {/* Photo upload */}
                <ModalField label="Photo du service">
                  <div className="flex items-center gap-3">
                    <PhotoUpload
                      value={form.photo}
                      onChange={(url) => setForm((prev) => ({ ...prev, photo: url ?? "" }))}
                      uploadFolder="services"
                    />
                    <div className="text-xs text-gray-400">
                      <p>Photo illustrant le service</p>
                      <p>JPEG, PNG, WebP ou GIF (max 20 Mo)</p>
                    </div>
                  </div>
                  <FieldError message={errors.photo} />
                </ModalField>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <Button type="submit" disabled={loading} className="bg-[#2f3a2e]">
              {loading ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
              {isEditing ? "Mettre à jour" : "Créer le service"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}