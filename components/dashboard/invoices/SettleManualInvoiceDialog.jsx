"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { settleManualInvoice } from "@/actions/invoices/manual-invoice";
import { ManualInvoicePaymentFields, isPaymentComplete } from "@/components/dashboard/invoices/ManualInvoicePaymentFields";

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const EMPTY_PAYMENT = { method: "TRANSFER", cashReceived: "", reference: "" };

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * « Encaisser » on a pending manual sale. Defaults to the whole balance —
 * which issues the invoice, handed to `onInvoiceIssued` so the sending card
 * can open. Lowering the amount records a further acompte instead: the sale
 * stays pending, still without an invoice.
 *
 * `transferReceived` is the « Virement reçu » variant: the method is fixed to
 * a transfer, the amount defaults to the transfer announced at the till (if
 * any), and the bank reference is what staff type in once it has arrived.
 */
export function SettleManualInvoiceDialog({ sale, transferReceived = false, onClose, onInvoiceIssued }) {
  const router = useRouter();
  const [payment, setPayment] = useState(EMPTY_PAYMENT);
  const [amountInput, setAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const total = Number(sale?.totalAmount ?? 0);
  const alreadyPaid = Number(sale?.paidAmount ?? 0);
  const balance = sale ? round2(Number(sale.remainingAmount ?? total - alreadyPaid)) : 0;
  const amount = amountInput === "" ? NaN : round2(amountInput);
  const amountValid = amount > 0 && amount <= balance + 0.001;
  const isPartial = amountValid && amount < balance - 0.001;

  useEffect(() => {
    if (!sale) return;
    setPayment(EMPTY_PAYMENT);
    const awaited = Number(sale.awaitedTransferAmount ?? 0);
    const initial = transferReceived && awaited > 0 && awaited < balance ? awaited : balance;
    setAmountInput(String(initial.toFixed(2)));
    // Re-seeded only when another sale is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale, transferReceived]);

  async function handleConfirm() {
    if (!sale || submitting || !amountValid) return;
    setSubmitting(true);
    const result = await settleManualInvoice({
      orderId: sale.orderId,
      amount,
      method: payment.method,
      cashReceived: payment.method === "CASH" ? Number(payment.cashReceived) : null,
      reference: payment.method === "CASH" ? null : payment.reference,
    });
    setSubmitting(false);
    if (!result?.success) {
      toast.error(result?.message ?? "Encaissement impossible.");
      return;
    }
    toast.success(result.message);
    onClose();
    if (result.data?.invoice) onInvoiceIssued?.(result.data.invoice);
    router.refresh();
  }

  const summary = alreadyPaid > 0
    ? `${euro(total)} TTC — acompte déjà reçu ${euro(alreadyPaid)}, reste ${euro(balance)}.`
    : `${euro(total)} TTC — rien n'a encore été encaissé.`;

  return (
    <ConfirmDialog
      open={Boolean(sale)}
      title={transferReceived ? `Virement reçu — vente n°${sale?.orderNumber ?? ""}` : `Encaisser la vente n°${sale?.orderNumber ?? ""}`}
      message={`${sale?.customerLegalName || sale?.customerName || ""} · ${summary}`}
      confirmLabel={
        amountValid
          ? isPartial
            ? `Enregistrer l'acompte de ${euro(amount)}`
            : transferReceived
            ? `Enregistrer le virement de ${euro(amount)}`
            : `Encaisser ${euro(amount)}`
          : "Encaisser"
      }
      loading={submitting}
      confirmDisabled={!amountValid || !isPaymentComplete(payment, amountValid ? amount : balance)}
      onConfirm={handleConfirm}
      onCancel={() => !submitting && onClose()}
    >
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-500">
          {transferReceived ? "Montant reçu sur le compte" : "Montant encaissé"}
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              max={balance}
              value={amountInput}
              disabled={submitting}
              onChange={(event) => setAmountInput(event.target.value)}
              className="w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e]"
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => setAmountInput(balance.toFixed(2))}
              className="shrink-0 rounded-lg border border-stroke px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Tout le solde
            </button>
          </div>
        </label>
        {!amountValid && amountInput !== "" && (
          <p className="text-xs font-medium text-red-600">Le montant doit être compris entre 0,01 € et le solde de {euro(balance)}.</p>
        )}
        {isPartial ? (
          <p className="text-xs font-medium text-amber-700">
            Acompte : il restera {euro(balance - amount)} à encaisser. La facture ne sera émise qu&apos;au paiement du solde.
          </p>
        ) : amountValid && !sale?.invoiceNumber ? (
          <p className="text-xs font-medium text-emerald-700">Ce paiement solde la vente : la facture sera émise et numérotée.</p>
        ) : null}
        <ManualInvoicePaymentFields
          value={payment}
          onChange={setPayment}
          total={amountValid ? amount : balance}
          disabled={submitting}
          lockedMethod={transferReceived}
        />
      </div>
    </ConfirmDialog>
  );
}
