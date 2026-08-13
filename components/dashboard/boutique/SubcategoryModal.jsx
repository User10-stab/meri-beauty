"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { createProductSubcategory, updateProductSubcategory } from "@/actions/boutique/categories";
import { useTranslations } from "next-intl";

/**
 * @param {{ open: boolean, categoryId: string, subcategory: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function SubcategoryModal({ open, categoryId, subcategory, onClose, onSaved }) {
  const t = useTranslations("dashboardBoutique.modals.subcategory");
  const isEditing = !!subcategory;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({ name: "", isActive: true });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({ name: subcategory?.name ?? "", isActive: subcategory?.isActive ?? true });
    setErrors({});
  }, [open, subcategory]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    startLoading(async () => {
      const result = isEditing
        ? await updateProductSubcategory({ id: subcategory.id, categoryId, ...form })
        : await createProductSubcategory({ categoryId, ...form });

      if (result.success) {
        toast.success(result.message);
        onSaved();
      } else {
        toast.error(result.message);
        if (result.errors) setErrors(result.errors);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {isEditing ? t("editTitle") : t("newTitle")}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              {t("name")} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t("namePlaceholder")}
              required
              className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
            />
            {errors.name && <p className="mt-1 text-xs font-medium text-red-600">{errors.name}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            {t("isActive")}
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("cancel")}
            </button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {isEditing ? t("save") : t("create")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
