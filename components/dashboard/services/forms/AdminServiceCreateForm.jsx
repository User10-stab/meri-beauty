"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { X, Loader2, Layers, Tag, FileText, Plus, Users } from "lucide-react";
import { toast } from "sonner";

import Button from "@/components/ui/Button";
import { InlineCategoryCreate } from "@/components/dashboard/services/InlineCategoryCreate";
import {
  createService,
  getCategories,
  getStaffOptions,
} from "@/actions/services/create-service";

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



export function AdminServiceCreateForm({ open, onClose, onCreated }) {
  const [categories, setCategories] = useState([]);
  const [staffOptions, setStaffOptions] = useState([]);
  const [loading, startLoading] = useTransition();

  const [showCategoryCreate, setShowCategoryCreate] = useState(false);
  const [showStaffPicker, setShowStaffPicker] = useState(false);

  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    description: "",
  });
  const [selectedStaffIds, setSelectedStaffIds] = useState([]);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      const [catsRes, staffRes] = await Promise.all([
        getCategories(),
        getStaffOptions(),
      ]);
      if (catsRes.success) setCategories(catsRes.data ?? []);
      if (staffRes.success) setStaffOptions(staffRes.data ?? []);
    });
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setForm({ name: "", categoryId: "", description: "" });
    setSelectedStaffIds([]);
    setErrors({});
    setShowCategoryCreate(false);
    setShowStaffPicker(false);
  }, [open]);

  const selectedStaff = useMemo(
    () => selectedStaffIds.map((id) => staffOptions.find((s) => s.id === id)).filter(Boolean),
    [selectedStaffIds, staffOptions]
  );

  function toggleStaffId(id) {
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      description: form.description || null,
      staffAssignments: selectedStaffIds.map((staffId) => ({
        staffId,
        // IMPORTANT: Admin create must not ask for price/duration/margin/photo.
        // Backend currently validates price/duration on staffAssignments,
        // so we send safe defaults.
        price: 0,
        duration: 0,
        margin: null,
        photo: "",
      })),
    };

    const result = await createService(payload);
    if (result.success) {
      toast.success(result.message);
      onCreated?.();
      onClose();
    } else {
      setErrors(result.errors ?? {});
      toast.error(result.message || "Impossible de créer le service.");
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
            <h2 className="text-base font-semibold text-gray-900">Nouveau service</h2>
            <p className="text-xs text-gray-500">Créer un service global et associer des professionnels</p>
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
            {/* Catégorie */}
            <ModalField label="Catégorie" required>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Layers size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select
                    required
                    value={form.categoryId}
                    onChange={(e) => setForm((p) => ({ ...p, categoryId: e.target.value }))}
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
                    setForm((p) => ({ ...p, categoryId: newCat.id }));
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
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="ex. Coupe classique"
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
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 pl-8 pr-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 min-h-[90px] resize-none"
                  placeholder="Description du service…"
                />
                <div className="flex justify-end mt-1">
                  <span className={`text-xs ${form.description.length > 500 ? 'text-red-600' : 'text-gray-400'}`}>
                    {form.description.length}/500
                  </span>
                </div>
              </div>
              <FieldError message={errors.description} />
            </ModalField>

            {/* Staff selection */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Professionnels associés
                </h3>
                <button
                  type="button"
                  onClick={() => setShowStaffPicker((p) => !p)}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    showStaffPicker
                      ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  aria-expanded={showStaffPicker}
                >
                  <Users size={14} /> Ajouter un professionnel
                </button>
              </div>

              {showStaffPicker && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
                  <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                    {staffOptions.length === 0 ? (
                      <p className="text-sm text-gray-500">Aucun professionnel disponible.</p>
                    ) : (
                      staffOptions.map((s) => {
                        const checked = selectedStaffIds.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <span className="truncate">{s.user.fullName}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleStaffId(s.id)}
                              className="h-4 w-4"
                            />
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowStaffPicker(false)}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              )}

              {selectedStaff.length === 0 ? (
                <p className="mt-3 text-xs text-gray-400 italic py-3 text-center border border-dashed border-gray-200 rounded-lg">
                  Aucun professionnel sélectionné.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedStaff.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700"
                    >
                      {s.user.fullName}
                      <button
                        type="button"
                        onClick={() => toggleStaffId(s.id)}
                        className="text-indigo-400 hover:text-indigo-700"
                        aria-label={`Retirer ${s.user.fullName}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
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
              Créer le service
            </Button>
          </div>
        </form>


      </div>
    </div>
  );
}
