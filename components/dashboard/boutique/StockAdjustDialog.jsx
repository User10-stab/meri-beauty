"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { recordStockMovement } from "@/actions/boutique/stock";
import { useTranslations } from "next-intl";

/**
 * @param {{ variant: object|null, onClose: () => void, onAdjusted: () => void }} props
 */
export function StockAdjustDialog({ variant, onClose, onAdjusted }) {
  const t = useTranslations("dashboardBoutique.stock.adjustDialog");
  const [type, setType] = useState("RESTOCK");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [loading, startLoading] = useTransition();

  const TYPES = [
    { value: "RESTOCK", label: t("types.RESTOCK"), hint: t("types.RESTOCK_hint"), sign: "+" },
    { value: "LOSS", label: t("types.LOSS"), hint: t("types.LOSS_hint"), sign: "−" },
    { value: "SALON_USAGE", label: t("types.SALON_USAGE"), hint: t("types.SALON_USAGE_hint"), sign: "−" },
    { value: "ADJUSTMENT", label: t("types.ADJUSTMENT"), hint: t("types.ADJUSTMENT_hint"), sign: "−" },
  ];

  useEffect(() => {
    if (!variant) return;
    setType("RESTOCK");
    setQuantity("");
    setReason("");
  }, [variant]);

  if (!variant) return null;

  const selected = TYPES.find((t) => t.value === type);
  const projected =
    quantity && !isNaN(quantity)
      ? type === "RESTOCK"
        ? variant.stockQuantity + Number(quantity)
        : variant.stockQuantity - Number(quantity)
      : null;

  function handleSubmit(e) {
    e.preventDefault();
    startLoading(async () => {
      const result = await recordStockMovement({ variantId: variant.id, type, quantity, reason });
      if (result.success) {
        toast.success(result.message);
        onAdjusted();
      } else {
        toast.error(result.message);
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
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{t("title")}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-sm text-gray-500">
          {variant.product.name} — {variant.name} · <span className="font-medium">{variant.stockQuantity}</span> {t("currentStock")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">{t("movementType")}</label>
            <div className="mt-1.5 space-y-2">
              {TYPES.map((t) => (
                <label
                  key={t.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                    type === t.value ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium text-gray-800">{t.label}</div>
                    <div className="text-xs text-gray-400">{t.hint}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">{t("quantity")}</label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-medium text-gray-400">
                {selected.sign}
              </span>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
                className="h-9 w-full rounded-lg border border-gray-200 pl-7 pr-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
              />
            </div>
            {projected !== null && (
              <p className={`mt-1.5 text-xs ${projected < 0 ? "font-medium text-red-500" : "text-gray-400"}`}>
                {t("newStock", { stock: projected })}
                {projected < 0 && t("cannotBeNegative")}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">{t("reasonLabel")}</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
              className="mt-1.5 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("cancel")}
            </button>
            <Button type="submit" disabled={loading || (projected !== null && projected < 0)}>
              {loading && <Loader2 size={14} className="animate-spin" />}
              {t("confirm")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
