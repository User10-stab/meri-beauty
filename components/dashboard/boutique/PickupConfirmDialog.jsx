"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Loader2, CreditCard, Banknote } from "lucide-react";
import Button from "@/components/ui/Button";
import { completeOrderPickup } from "@/actions/boutique/orders";
import { useTranslations } from "next-intl";

/**
 * @param {{ order: object|null, onClose: () => void, onDone: () => void }} props
 */
export function PickupConfirmDialog({ order, onClose, onDone }) {
  const t = useTranslations("dashboardBoutique.pickupConfirmDialog");
  const [method, setMethod] = useState("CASH");
  // A card collection is only accepted as EXTERNAL_TERMINAL: its receipt
  // reference is the only thing tying the row to a real charge on the
  // terminal, so completeOrderPickup refuses one without it.
  const [terminalReference, setTerminalReference] = useState("");
  const [loading, startLoading] = useTransition();

  if (!order) return null;

  const needsPayment = !order.hasPayment;
  // Belt and braces behind the callers. This used to be a bare
  // `order.totalAmount.toFixed(2)`, and a caller that built its own payload
  // without the amount (PickupsToVerify did) took the entire orders page down
  // to the error boundary the moment staff clicked "elle est venue" — the
  // handover could not be recorded at all. A dialog is not worth a page.
  const amountToCollect = Number(order.totalAmount);
  const hasAmount = Number.isFinite(amountToCollect);

  function handleConfirm() {
    startLoading(async () => {
      const result = await completeOrderPickup({
        orderId: order.id,
        method: needsPayment ? method : undefined,
        ...(needsPayment && method === "EXTERNAL_TERMINAL"
          ? { terminalApproved: true, terminalReference: terminalReference.trim() }
          : {}),
      });
      if (result.success) {
        toast.success(result.message);
        onDone();
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
          {t("orderInfo", { orderNumber: order.orderNumber, customerName: order.user?.fullName })}
        </p>

        {needsPayment ? (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700">
              {t("needsPayment")}
            </p>
            <div className="space-y-2">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  method === "CASH" ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input type="radio" name="method" checked={method === "CASH"} onChange={() => setMethod("CASH")} />
                <Banknote size={18} className="text-gray-500" />
                <span className="text-sm font-medium text-gray-800">{t("cash")}</span>
              </label>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  method === "EXTERNAL_TERMINAL" ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="method"
                  checked={method === "EXTERNAL_TERMINAL"}
                  onChange={() => setMethod("EXTERNAL_TERMINAL")}
                />
                <CreditCard size={18} className="text-gray-500" />
                <span className="text-sm font-medium text-gray-800">{t("card")}</span>
              </label>
            </div>

            {method === "EXTERNAL_TERMINAL" && (
              <input
                value={terminalReference}
                onChange={(event) => setTerminalReference(event.target.value)}
                maxLength={100}
                placeholder={t("terminalReference")}
                aria-label={t("terminalReference")}
                className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e]"
              />
            )}
            {/* Deliberately hidden rather than shown as 0,00 € when the
                amount is missing: a wrong figure at the till is worse than
                none, and the server recomputes the total anyway. */}
            {hasAmount && (
              <p className="text-lg font-semibold text-[#2f3a2e]">
                {t("totalToCollect", { amount: amountToCollect.toFixed(2) })}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-600">
            {t("alreadyPaid")}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t("cancel")}
          </button>
          <Button
            onClick={handleConfirm}
            disabled={loading || (needsPayment && method === "EXTERNAL_TERMINAL" && !terminalReference.trim())}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {t("confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
