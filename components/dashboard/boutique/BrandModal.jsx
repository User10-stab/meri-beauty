"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { PhotoUpload } from "@/components/ui/PhotoUpload";
import { createBrand, updateBrand } from "@/actions/boutique/brands";
import { useTranslations } from "next-intl";

/**
 * @param {{ open: boolean, brand: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function BrandModal({ open, brand, onClose, onSaved }) {
  const t = useTranslations("dashboardBoutique.modals.brand");
  const isEditing = !!brand;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({ name: "", description: "", logo: null, isActive: true });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({
      name: brand?.name ?? "",
      description: brand?.description ?? "",
      logo: brand?.logo ?? null,
      isActive: brand?.isActive ?? true,
    });
    setErrors({});
  }, [open, brand]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    startLoading(async () => {
      const result = isEditing
        ? await updateBrand({ id: brand.id, ...form })
        : await createBrand(form);

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
          <div className="flex justify-center">
            <PhotoUpload
              value={form.logo}
              onChange={(url) => setForm((f) => ({ ...f, logo: url }))}
              uploadFolder="products"
            />
          </div>

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

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">{t("description")}</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
            />
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
