"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { X, Loader2, Layers, Package, FileText, Tag, Plus, Check } from "lucide-react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { getCategories, createService, getCurrentStaffProfile } from "@/actions/services/create-service";
import { InlineCategoryCreate } from "@/components/dashboard/services/InlineCategoryCreate";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs font-medium text-red-600">{message}</p>;
}

function ModalField({ label, required = false, children }) {
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

export function StaffServiceCreateForm({ open, onClose, onCreated }) {
  const [categories, setCategories] = useState([]);
  const [loading, startLoading] = useTransition();

  const [showCategoryCreate, setShowCategoryCreate] = useState(false);

  const [form, setForm] = useState({
    categoryId: "",
    serviceId: "",
    name: "",
    description: "",
    price: "",
    duration: "",
    margin: "",
    photo: "",
    _staffId: "",
  });

  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      const [catsRes, staffRes] = await Promise.all([
        getCategories(),
        getCurrentStaffProfile(),
      ]);
      if (catsRes.success) setCategories(catsRes.data ?? []);
      if (staffRes.success && staffRes.data?.id) {
        setForm((p) => ({ ...p, _staffId: staffRes.data.id }));
      }
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setShowCategoryCreate(false);
    setErrors({});

    // Reset visible fields, but keep the fetched staffId (used for correct saving)
    setForm((p) => ({
      ...p,
      categoryId: "",
      serviceId: "",
      name: "",
      description: "",
      price: "",
      duration: "",
      margin: "",
      photo: "",
    }));
  }, [open]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.categoryId) ?? null,
    [categories, form.categoryId]
  );

  const servicesInCategory = selectedCategory?.services ?? [];

  const selectedService = useMemo(
    () => servicesInCategory.find((s) => s.id === form.serviceId) ?? null,
    [servicesInCategory, form.serviceId]
  );

  const isReadyForDetails = !!form.serviceId || !!form.name.trim();

  // When selecting an existing service, prefill name/description (staff can override)
  useEffect(() => {
    if (!selectedService) return;
    setForm((p) => ({
      ...p,
      name: selectedService.name ?? p.name,
      description: selectedService.description ?? p.description,
    }));
  }, [selectedService]);

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    // Staff flow: link to existing global Service when possible.
    // Backend currently only supports createService (creates Service row).
    // We pass the selected existing service name/categoryId and rely on
    // backend uniqueness check to prevent duplicates.
    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      description: form.description || null,
      staffAssignments: [
        {
          // IMPORTANT: for STAFF, the server action matches the assignment by
          // the real staffId (current staff record).
          staffId: form._staffId ?? "",
          price: parseFloat(form.price),
          duration: parseInt(form.duration, 10),
          margin: form.margin ? parseFloat(form.margin) : null,
          photo: form.photo || "",
        },
      ],
    };

    // The server action expects staffId to be a string; it will ignore unknown IDs
    // for STAFF and instead uses the current staff record.
    const result = await createService(payload);

    if (result.success) {
      toast.success(result.message);
      onCreated?.();
      onClose();
    } else {
      setErrors(result.errors ?? {});
      toast.error(result.message || "Impossible d'ajouter le service.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Ajouter un service</h2>
            <p className="text-xs text-gray-500">Choisir un service existant et définir vos détails</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {/* Category */}
            <ModalField label="Catégorie" required>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Layers size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    required
                    value={form.categoryId}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        categoryId: e.target.value,
                        serviceId: "",
                      }))
                    }
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
                    setCategories((prev) =>
                      [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name, "fr"))
                    );
                    setForm((p) => ({ ...p, categoryId: newCat.id, serviceId: "" }));
                    setShowCategoryCreate(false);
                  }}
                  onCancel={() => setShowCategoryCreate(false)}
                />
              )}
              <FieldError message={errors.categoryId} />
            </ModalField>

            {/* Existing services list (to check duplicates) */}
            {form.categoryId && servicesInCategory.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <Package size={14} className="text-indigo-600" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                    Services existants dans « {selectedCategory?.name} »
                  </h3>
                </div>

                <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {servicesInCategory.map((svc) => {
                    const isSelected = form.serviceId === svc.id;
                    return (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() =>
                          setForm((p) => ({
                            ...p,
                            serviceId: svc.id,
                            name: svc.name ?? p.name,
                            description: svc.description ?? p.description,
                          }))
                        }
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <span className="truncate font-medium">{svc.name}</span>
                        {isSelected ? (
                          <span className="flex items-center gap-1 text-xs font-medium">
                            <Check size={12} /> Sélectionné
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>

                <p className="mt-2.5 border-t border-indigo-100 pt-2 text-[11px] text-indigo-500">
                  Si le service existe déjà, sélectionnez-le. Sinon, créez-en un nouveau ci-dessous.
                </p>
              </div>
            )}

            {/* New service name (if not selecting existing) */}
            <ModalField label="Nom du service" required>
              <div className="relative">
                <Tag size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setForm((p) => ({
                      ...p,
                      name: nextName,
                      // if they start typing, they're creating a new one
                      serviceId: "",
                    }));
                  }}
                  disabled={!form.categoryId}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                  placeholder={form.categoryId ? "ex. Coupe + brushing" : "Choisir une catégorie d'abord"}
                />
              </div>
              <FieldError message={errors.name} />
            </ModalField>

            {/* Photo */}
            <ModalField label="Photo">
              <div className="flex items-center gap-3">
                <PhotoUpload
                  value={form.photo}
                  onChange={(url) => setForm((p) => ({ ...p, photo: url ?? "" }))}
                  uploadFolder="services"
                />
                <div className="text-xs text-gray-400">
                  <p>Photo illustrant le service</p>
                  <p>JPEG, PNG, WebP ou GIF (max 20 Mo)</p>
                </div>
              </div>
            </ModalField>



            {/* Price/Duration/Margin */}
            <div className="grid grid-cols-2 gap-3">
              <ModalField label="Prix (€)" required>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">€</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.price}
                    onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))}
                    disabled={!isReadyForDetails}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                    placeholder="0.00"
                  />
                </div>
                <FieldError message={errors.assignments?.[0]?.price} />
              </ModalField>

              <ModalField label="Durée (minutes)" required>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.duration}
                    onChange={(e) => setForm((p) => ({ ...p, duration: e.target.value }))}
                    disabled={!isReadyForDetails}
                    className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                    placeholder="30"
                  />
                </div>
                <FieldError message={errors.assignments?.[0]?.duration} />
              </ModalField>
            </div>

            <ModalField label="Marge (minutes)">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⏱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.margin}
                  onChange={(e) => setForm((p) => ({ ...p, margin: e.target.value }))}
                  disabled={!isReadyForDetails}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                  placeholder="Optionnel"
                />
              </div>
            </ModalField>

            {/* Description */}
            <ModalField label="Description">
              <div className="relative">
                <FileText size={14} className="pointer-events-none absolute left-3 top-4 text-gray-400" />
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  disabled={!isReadyForDetails}
                  className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 min-h-[90px] resize-none disabled:opacity-50"
                  placeholder="Description du service…"
                />
              </div>
              <FieldError message={errors.description} />
            </ModalField>
          </div>

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
              Ajouter
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
