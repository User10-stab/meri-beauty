"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, Tag, FileText } from "lucide-react";
import Button from "@/components/ui/Button";
import { createCategory, updateCategory } from "@/actions/services/create-service";

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

/**
 * Modal for creating and editing a category.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onCreated?: () => void,
 *   category?: { id: string, name: string, description: string | null } | null,
 * }} props
 */
export function CreateCategoryModal({ open, onClose, onCreated, category }) {
  const isEditing = !!category;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({
    name: "",
    description: "",
  });
  const [errors, setErrors] = useState({});

  // Pre-fill when editing
  useEffect(() => {
    if (!open || !category) {
      setForm({ name: "", description: "" });
      setErrors({});
      return;
    }
    setForm({
      name: category.name ?? "",
      description: category.description ?? "",
    });
    setErrors({});
  }, [open, category]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setErrors({});

    startLoading(async () => {
      const result = isEditing
        ? await updateCategory({ id: category.id, name: form.name, description: form.description || null })
        : await createCategory({ name: form.name, description: form.description || null });

      if (result.success) {
        toast.success(result.message);
        onCreated?.();
        onClose();
      } else {
        setErrors(result.errors ?? {});
        toast.error(result.message || "Impossible d'enregistrer la catégorie.");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-md flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEditing ? "Modifier la catégorie" : "Nouvelle catégorie"}
            </h2>
            <p className="text-xs text-gray-500">
              {isEditing ? "Modifier les informations de la catégorie" : "Ajouter une nouvelle catégorie de service"}
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
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {/* Name */}
          <ModalField label="Nom de la catégorie" required>
            <div className="relative">
              <Tag size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                placeholder="ex. Coiffure"
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
                placeholder="Description de la catégorie..."
              />
            </div>
            <FieldError message={errors.description} />
          </ModalField>

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
              {isEditing ? "Mettre à jour" : "Créer la catégorie"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}