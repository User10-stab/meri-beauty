"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { getStockMovements } from "@/actions/boutique/stock";
import { useTranslations } from "next-intl";

function formatDate(d) {
  return new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

/** Slide-over showing a variant's full inventory ledger, most recent first. */
export function StockHistoryDrawer({ variant, onClose }) {
  const t = useTranslations("dashboardBoutique.stock.historyDrawer");
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);

  const TYPE_LABEL = {
    SALE: t("movementTypes.SALE"),
    RESTOCK: t("movementTypes.RESTOCK"),
    RETURN: t("movementTypes.RETURN"),
    LOSS: t("movementTypes.LOSS"),
    ADJUSTMENT: t("movementTypes.ADJUSTMENT"),
    SALON_USAGE: t("movementTypes.SALON_USAGE"),
  };

  useEffect(() => {
    if (!variant) return;
    setLoading(true);
    getStockMovements(variant.id).then((result) => {
      setMovements(result.data ?? []);
      setLoading(false);
    });
  }, [variant]);

  if (!variant) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t("title")}</h2>
            <p className="text-sm text-gray-500">{variant.product.name} — {variant.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 size={20} className="animate-spin text-gray-400" />
            </div>
          ) : movements.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">{t("noMovements")}</p>
          ) : (
            <ul className="space-y-3">
              {movements.map((m) => (
                <li key={m.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{TYPE_LABEL[m.type] ?? m.type}</span>
                    <span className={`text-sm font-semibold ${m.quantity > 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {m.quantity > 0 ? "+" : ""}{m.quantity}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {formatDate(m.createdAt)} · {m.previousStock} → {m.newStock}
                    {m.createdBy?.fullName && ` · ${m.createdBy.fullName}`}
                  </p>
                  {m.reason && <p className="mt-1 text-xs text-gray-500">{m.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
