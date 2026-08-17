"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { createPromoCode, updatePromoCode } from "@/actions/promo-codes";

const TYPE_OPTIONS = [
  { value: "PERCENTAGE", label: "Pourcentage (%)" },
  { value: "FIXED", label: "Montant fixe (€)" },
];

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * @param {{ open: boolean, promoCode: object|null, onClose: () => void, onSaved: () => void }} props
 */
export function PromoCodeModal({ open, promoCode, onClose, onSaved }) {
  const isEditing = !!promoCode;
  const [loading, startLoading] = useTransition();
  const [form, setForm] = useState({ code: "", type: "PERCENTAGE", value: "", minOrderAmount: "", expiresAt: "", maxUses: "", isActive: true });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm({
      code: promoCode?.code ?? "",
      type: promoCode?.type ?? "PERCENTAGE",
      value: promoCode?.value ?? "",
      minOrderAmount: promoCode?.minOrderAmount ?? "",
      expiresAt: toDateTimeLocal(promoCode?.expiresAt),
      maxUses: promoCode?.maxUses ?? "",
      isActive: promoCode?.isActive ?? true,
    });
    setErrors({});
  }, [open, promoCode]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    setErrors({});
    startLoading(async () => {
      const payload = {
        code: form.code,
        type: form.type,
        value: form.value,
        minOrderAmount: form.minOrderAmount === "" ? null : form.minOrderAmount,
        expiresAt: form.expiresAt === "" ? null : form.expiresAt,
        maxUses: form.maxUses === "" ? null : form.maxUses,
        isActive: form.isActive,
      };
      const result = isEditing
        ? await updatePromoCode({ id: promoCode.id, ...payload })
        : await createPromoCode(payload);

      if (result.success) {
        toast.success(result.message);
        onSaved(result.data);
      } else {
        toast.error(result.message);
        if (result.errors) {
          setErrors(Object.fromEntries(Object.entries(result.errors).map(([k, v]) => [k, v?.[0]])));
        }
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
            {isEditing ? "Modifier le code promo" : "Nouveau code promo"}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Code <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="BIENVENUE10"
              required
              className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 font-mono text-sm uppercase tracking-wide text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
            />
            {errors.code && <p className="mt-1 text-xs font-medium text-red-600">{errors.code}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Valeur <span className="text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.value}
                onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                placeholder={form.type === "PERCENTAGE" ? "10" : "5.00"}
                required
                className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
              />
              {errors.value && <p className="mt-1 text-xs font-medium text-red-600">{errors.value}</p>}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Montant minimum de commande (optionnel)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.minOrderAmount}
              onChange={(e) => setForm((f) => ({ ...f, minOrderAmount: e.target.value }))}
              placeholder="Aucun minimum"
              className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
            />
            {errors.minOrderAmount && <p className="mt-1 text-xs font-medium text-red-600">{errors.minOrderAmount}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">Expiration (optionnelle)</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
              />
              {errors.expiresAt && <p className="mt-1 text-xs font-medium text-red-600">{errors.expiresAt}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">Utilisations max. (optionnel)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
                placeholder="Illimité"
                className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
              />
              {errors.maxUses && <p className="mt-1 text-xs font-medium text-red-600">{errors.maxUses}</p>}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Code actif
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Annuler
            </button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {isEditing ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
