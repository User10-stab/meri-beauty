"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { creditStaffRentInvoice } from "@/actions/invoices/staff-rent";

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const inputClass =
  "mt-1 w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white";

/**
 * Note de crédit on a staff rent invoice — a mistake, before or after the
 * rent was paid (actions/invoices/staff-rent.js#creditStaffRentInvoice).
 *
 * Unpaid, the note only lowers what is still owed. Paid, the money must go
 * back: the app never refunds by itself, so Marie makes the transfer from the
 * bank first and confirms it here — the note and the refund are recorded
 * together.
 */
export function CreditStaffRentDialog({ invoice, onClose }) {
  const router = useRouter();
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");
  const [refundSent, setRefundSent] = useState(false);
  const [refundReference, setRefundReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const creditable = invoice ? round2(Number(invoice.totalInclVat) - Number(invoice.creditedTotal ?? 0)) : 0;
  const paid = Number(invoice?.paidAmount ?? 0) > 0.001;
  const amount = amountInput === "" ? NaN : round2(amountInput);
  const amountValid = amount > 0 && amount <= creditable + 0.001;
  const canSubmit = amountValid && reason.trim().length >= 3 && (!paid || refundSent);

  useEffect(() => {
    if (!invoice) return;
    setAmountInput(creditable.toFixed(2));
    setReason("");
    setRefundSent(false);
    setRefundReference("");
    // Re-seeded only when another invoice is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  async function handleConfirm() {
    if (!invoice || submitting || !canSubmit) return;
    setSubmitting(true);
    const result = await creditStaffRentInvoice({ invoiceId: invoice.id, amount, reason, refundSent, refundReference });
    setSubmitting(false);
    if (!result?.success) {
      toast.error(result?.message ?? "Note de crédit impossible.");
      return;
    }
    toast.success(result.message);
    onClose();
    // The row then shows the note with its own Voir / E-mail / Peppol.
    router.refresh();
  }

  const name = invoice?.customerLegalName || invoice?.customerName || "";

  return (
    <ConfirmDialog
      open={Boolean(invoice)}
      title={`Note de crédit — facture ${invoice?.number ?? ""}`}
      message={`${name} · facture de ${euro(invoice?.totalInclVat)}${
        Number(invoice?.creditedTotal ?? 0) > 0 ? `, déjà créditée de ${euro(invoice?.creditedTotal)}` : ""
      }. ${paid ? "Ce loyer est déjà payé : le montant crédité doit lui être remboursé." : "Ce loyer n'est pas encore payé : la note réduit ce qu'il reste à payer."}`}
      confirmLabel={amountValid ? `Créditer ${euro(amount)}` : "Créditer"}
      cancelLabel="Retour"
      loading={submitting}
      confirmDisabled={!canSubmit}
      onConfirm={handleConfirm}
      onCancel={() => !submitting && onClose()}
    >
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-500">
          Montant à créditer (TTC)
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={creditable}
              value={amountInput}
              disabled={submitting}
              onChange={(event) => setAmountInput(event.target.value)}
              className={inputClass}
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => setAmountInput(creditable.toFixed(2))}
              className="mt-1 shrink-0 rounded-lg border border-stroke px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Tout
            </button>
          </div>
        </label>
        {!amountValid && amountInput !== "" && (
          <p className="text-xs font-medium text-red-600">Entre 0,01 € et {euro(creditable)}.</p>
        )}

        <label className="block text-xs font-medium text-gray-500">
          Motif (imprimé sur la note de crédit)
          <input
            type="text"
            maxLength={300}
            value={reason}
            disabled={submitting}
            onChange={(event) => setReason(event.target.value)}
            className={inputClass}
            placeholder="Ex. erreur de montant, mauvaise période"
          />
        </label>

        {paid && (
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-xs font-semibold text-amber-900">
              <input
                type="checkbox"
                checked={refundSent}
                disabled={submitting}
                onChange={(event) => setRefundSent(event.target.checked)}
                className="mt-0.5"
              />
              J&apos;ai viré le remboursement de {amountValid ? euro(amount) : "ce montant"} à {name} depuis le compte du salon.
            </label>
            <label className="block text-xs font-medium text-amber-900">
              Référence du virement de remboursement (facultatif)
              <input
                type="text"
                maxLength={100}
                value={refundReference}
                disabled={submitting}
                onChange={(event) => setRefundReference(event.target.value)}
                className={inputClass}
              />
            </label>
            <p className="text-[11px] text-amber-800">
              L&apos;application ne rembourse jamais elle-même : faites d&apos;abord le virement, puis enregistrez-le ici. Il sera déduit des « Loyers staff » au livre de recettes.
            </p>
          </div>
        )}
      </div>
    </ConfirmDialog>
  );
}
