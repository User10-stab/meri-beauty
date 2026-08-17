"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Button from "@/components/ui/Button";
import { useTranslations } from "next-intl";

/**
 * Deposits are non-refundable by default — the client wants that relaxed
 * only for genuine exceptions (medical reasons, death, force majeure), as an
 * admin's manual case-by-case call, never automatic. The reason is required
 * whenever a refund is granted so the exception is justified in the record.
 *
 * @param {{ reservation: object|null, onClose: () => void, onConfirm: (args: { reason: string, refundDeposit: boolean }) => void, loading: boolean }} props
 */
export function CancelReservationDialog({ reservation, onClose, onConfirm, loading, formationMode = false }) {
  const t = useTranslations("dashboardWorkshops.cancelDialog");
function formatPrice(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
}
  const [refundDeposit, setRefundDeposit] = useState(false);
  const [reason, setReason] = useState("");

  if (!reservation) return null;

  const reasonRequired = refundDeposit;
  const canConfirm = !reasonRequired || reason.trim().length > 0;

  // The checkbox always refunds whatever was actually paid, not just a
  // deposit — for a full-payment booking (balanceDue === 0) that's the
  // entire amount. Label it accordingly so an admin doesn't think they're
  // only refunding a partial deposit when it's actually the full sum.
  const isFullPayment = Number(reservation.balanceDue) === 0;
  const paidAmount = Number(reservation.payment?.paidAmount ?? reservation.depositAmount ?? 0);
  const paidLabel = isFullPayment ? "le paiement total" : "l'acompte";

  function handleClose() {
    setRefundDeposit(false);
    setReason("");
    onClose();
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm({ reason: reason.trim(), refundDeposit });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-dark">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t("title")}</h2>
          <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-dark-6">
          « {reservation.customer?.fullName} » — {reservation.session?.workshop?.title ?? reservation.session?.formation?.title}
        </p>

        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-gray-200 p-3 text-sm dark:border-dark-3">
          <input
            type="checkbox"
            checked={refundDeposit}
            onChange={(e) => setRefundDeposit(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-gray-800 dark:text-white">
              {isFullPayment ? t("refundFull") : t("refundDeposit")} ({formatPrice(paidAmount)})
            </span>
            <span className="mt-0.5 block text-xs text-gray-400">
              {isFullPayment
                ? t("fullPaymentRefundHint")
                : t("refundHint")}
            </span>
          </span>
        </label>

        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-600">
            {t("reasonLabel")} {reasonRequired && <span className="text-red-400">*</span>}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={reasonRequired ? t("reasonRequired") : t("reasonOptional")}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>

        <p className="mt-3 text-xs text-gray-400">
          {refundDeposit
            ? `${formatPrice(paidAmount)} (${paidLabel}) sera remboursé via Stripe.`
            : `${formatPrice(paidAmount)} (${paidLabel}) ne sera pas remboursé.`}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex h-9 items-center rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
          >
            {t("back")}
          </button>
          <Button onClick={handleConfirm} disabled={!canConfirm || loading} className="!bg-red-600 hover:!bg-red-700">
            {loading ? t("cancelling") : t("confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
