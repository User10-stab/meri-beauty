"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, HandCoins, Hourglass, Landmark } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { SettleManualInvoiceDialog } from "@/components/dashboard/invoices/SettleManualInvoiceDialog";
import { cancelManualSale } from "@/actions/invoices/manual-invoice";
import { acceptAwaitedTransfer } from "@/actions/payments/awaited-transfer";

/**
 * « Ventes en attente de paiement » — manual sales recorded with an acompte
 * or to be paid later. None has an invoice yet: it is issued by the payment
 * that clears the balance (actions/invoices/manual-invoice.js), after which
 * the sale leaves this panel and its invoice joins the list below.
 *
 * A bank transfer announced but not arrived yet shows as « Virement
 * attendu »; « Virement reçu » records it with its bank reference once it is
 * on the account — only then does it count as paid.
 *
 * The same panel lists the counter's other awaited transfers (kind
 * "TRANSFER"): a booking balance, a pickup order or a séance closed out with
 * « Virement » — see actions/payments/awaited-transfer.js.
 */

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
const formatDate = (value) => (value ? new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

const actionButton = "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition";

export function PendingManualSales({ data }) {
  const router = useRouter();
  const [settling, setSettling] = useState(null);
  const [settlingTransfer, setSettlingTransfer] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [issuedInvoice, setIssuedInvoice] = useState(null);
  // A counter transfer (booking, pickup, séance): reference then accept.
  const [acceptingTransfer, setAcceptingTransfer] = useState(null);
  const [transferReference, setTransferReference] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  const { rows, stats } = data;
  if (rows.length === 0 && !issuedInvoice) return null;

  async function confirmCancel() {
    if (!cancelling || cancelBusy) return;
    setCancelBusy(true);
    const result = await cancelManualSale({ orderId: cancelling.orderId, reason: cancelReason });
    setCancelBusy(false);
    if (!result?.success) {
      toast.error(result?.message ?? "Annulation impossible.");
      return;
    }
    toast.success(result.message);
    setCancelling(null);
    router.refresh();
  }

  async function confirmTransfer() {
    if (!acceptingTransfer || transferBusy) return;
    setTransferBusy(true);
    const result = await acceptAwaitedTransfer({ paymentId: acceptingTransfer.paymentId, reference: transferReference });
    setTransferBusy(false);
    if (!result?.success) {
      toast.error(result?.message ?? "Impossible d'enregistrer ce virement.");
      return;
    }
    toast.success(result.message);
    setAcceptingTransfer(null);
    router.refresh();
  }

  const now = Date.now();

  return (
    <section className="rounded-xl border border-amber-200 bg-white dark:border-amber-900 dark:bg-gray-dark">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 px-4 py-3 dark:border-amber-900">
        <div className="flex items-center gap-2">
          <Hourglass size={16} className="text-amber-700" />
          <h2 className="text-sm font-bold text-dark dark:text-white">Ventes en attente de paiement</h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {stats.count} · reste {euro(stats.remainingTotal)}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-dark-6">La facture est émise au paiement du solde, comme pour tout acompte.</p>
      </header>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2">Vente</th>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2 text-right">Total TTC</th>
                <th className="px-4 py-2 text-right">Reçu</th>
                <th className="px-4 py-2 text-right">Reste</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
              {rows.map((sale) => {
                const isTransfer = sale.kind === "TRANSFER";
                const overdue = sale.paymentDueDate && new Date(sale.paymentDueDate).getTime() < now;
                const cancellable = !isTransfer && sale.paidAmount <= 0 && !sale.invoiceNumber;
                return (
                  <tr key={sale.paymentId ?? sale.orderId}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold text-dark dark:text-white">{isTransfer ? sale.reference : `Vente n°${sale.orderNumber}`}</p>
                      <p className="text-xs text-gray-400">{formatDate(sale.createdAt)}</p>
                      {sale.paymentDueDate && (
                        <p className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-gray-400"}`}>
                          Échéance {formatDate(sale.paymentDueDate)}
                        </p>
                      )}
                      {sale.invoiceNumber && <p className="text-[11px] text-gray-500">Facture {sale.invoiceNumber}</p>}
                      {sale.awaitedTransferAmount > 0 && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                          <Landmark size={11} /> Virement attendu · {euro(sale.awaitedTransferAmount)}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-dark dark:text-white">{sale.customerLegalName || sale.customerName}</p>
                      <p className="text-xs text-gray-500">{sale.customerEmail}</p>
                      <p className="mt-1 max-w-xs truncate text-[11px] text-gray-400" title={sale.summary}>
                        {sale.summary}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-dark dark:text-white">{euro(sale.totalAmount)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top text-gray-600 dark:text-dark-6">
                      {sale.paidAmount > 0 ? euro(sale.paidAmount) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-amber-800">{euro(sale.remainingAmount)}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        {isTransfer ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTransferReference("");
                              setAcceptingTransfer(sale);
                            }}
                            className={`${actionButton} border-sky-700 bg-sky-700 text-white hover:bg-sky-800`}
                          >
                            <Landmark size={13} /> Virement reçu
                          </button>
                        ) : (
                        <>
                        <button
                          type="button"
                          onClick={() => {
                            setSettlingTransfer(true);
                            setSettling(sale);
                          }}
                          className={`${actionButton} ${
                            sale.awaitedTransferAmount > 0
                              ? "border-sky-700 bg-sky-700 text-white hover:bg-sky-800"
                              : "border-sky-300 text-sky-800 hover:bg-sky-50"
                          }`}
                        >
                          <Landmark size={13} /> Virement reçu
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSettlingTransfer(false);
                            setSettling(sale);
                          }}
                          className={`${actionButton} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
                        >
                          <HandCoins size={13} /> Encaisser
                        </button>
                        </>
                        )}
                        {cancellable && (
                          <button
                            type="button"
                            onClick={() => {
                              setCancelReason("");
                              setCancelling(sale);
                            }}
                            className={`${actionButton} border-stroke text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6`}
                          >
                            <Ban size={13} /> Annuler
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SettleManualInvoiceDialog
        sale={settling}
        transferReceived={settlingTransfer}
        onClose={() => setSettling(null)}
        onInvoiceIssued={setIssuedInvoice}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        title={`Annuler la vente n°${cancelling?.orderNumber ?? ""} ?`}
        message="Rien n'a été encaissé et aucune facture n'a été émise : la vente est annulée et les articles du catalogue sont remis en stock."
        confirmLabel="Annuler la vente"
        cancelLabel="Retour"
        loading={cancelBusy}
        confirmDisabled={cancelReason.trim().length < 3}
        onConfirm={confirmCancel}
        onCancel={() => !cancelBusy && setCancelling(null)}
      >
        <label className="block text-xs font-medium text-gray-500">
          Motif
          <input
            type="text"
            maxLength={300}
            value={cancelReason}
            disabled={cancelBusy}
            onChange={(event) => setCancelReason(event.target.value)}
            className="mt-1 w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e]"
            placeholder="Ex. commande annulée par le client"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(acceptingTransfer)}
        title={`Virement reçu — ${acceptingTransfer?.reference ?? ""} ?`}
        message={`${acceptingTransfer?.customerName ?? ""} · ${euro(acceptingTransfer?.awaitedTransferAmount)} attendus par virement. Le paiement sera enregistré${
          acceptingTransfer && acceptingTransfer.awaitedTransferAmount >= acceptingTransfer.remainingAmount
            ? " et la facture émise si le client est assujetti."
            : " comme acompte : le solde restera dû."
        }`}
        confirmLabel="Enregistrer le virement"
        cancelLabel="Retour"
        loading={transferBusy}
        confirmDisabled={transferReference.trim().length === 0}
        onConfirm={confirmTransfer}
        onCancel={() => !transferBusy && setAcceptingTransfer(null)}
      >
        <label className="block text-xs font-medium text-gray-500">
          Référence du virement (communication ou n° d&apos;opération)
          <input
            type="text"
            maxLength={100}
            value={transferReference}
            disabled={transferBusy}
            onChange={(event) => setTransferReference(event.target.value)}
            className="mt-1 w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e]"
            placeholder="Ex. +++123/4567/89012+++"
          />
        </label>
      </ConfirmDialog>

      <DocumentDeliveryDialog
        open={Boolean(issuedInvoice)}
        onClose={() => setIssuedInvoice(null)}
        document={issuedInvoice}
        invoice={issuedInvoice}
        kind="INVOICE"
      />
    </section>
  );
}
