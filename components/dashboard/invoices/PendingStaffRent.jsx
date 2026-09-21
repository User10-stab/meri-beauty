"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileText, Landmark } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { acceptStaffRentPayment } from "@/actions/invoices/staff-rent";

/**
 * « Loyers staff en attente de paiement » — rent due from staff (automatic
 * monthly billing), each with a pending transfer payment and NO invoice yet.
 * « Accepter le paiement » records the transfer and issues the invoice, paid
 * (actions/invoices/staff-rent.js), then offers to send it. Replaces the old
 * « Facturation mensuelle » page; issued invoices are in the list below.
 */

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));
const formatDate = (value) => (value ? new Date(value).toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

export function PendingStaffRent({ data }) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [issuedInvoice, setIssuedInvoice] = useState(null);

  const { rows, stats } = data;
  if (rows.length === 0 && !issuedInvoice) return null;

  async function confirmAccept() {
    if (!accepting || busy) return;
    setBusy(true);
    const result = await acceptStaffRentPayment(
      accepting.kind === "RENT" ? { rentId: accepting.rentId, reference } : { invoiceId: accepting.invoiceId, reference }
    );
    setBusy(false);
    if (!result?.success) {
      toast.error(result?.message ?? "Impossible d'enregistrer le paiement.");
      return;
    }
    toast.success(result.message);
    setAccepting(null);
    if (result.data?.invoice) setIssuedInvoice(result.data.invoice); // « proposer l'envoi »
    router.refresh();
  }

  const now = Date.now();

  return (
    <section className="rounded-xl border border-sky-200 bg-white dark:border-sky-900 dark:bg-gray-dark">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 px-4 py-3 dark:border-sky-900">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-sky-700" />
          <h2 className="text-sm font-bold text-dark dark:text-white">Loyers staff en attente de paiement</h2>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
            {stats.count} · {euro(stats.remainingTotal)}
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-dark-6">Virement : acceptez-le quand il est arrivé sur le compte — la facture est émise à ce moment-là.</p>
      </header>

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2">Loyer</th>
                <th className="px-4 py-2">Staff</th>
                <th className="px-4 py-2 text-right">Montant</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
              {rows.map((rent) => {
                const overdue = rent.dueDate && new Date(rent.dueDate).getTime() < now;
                return (
                  <tr key={rent.rentId ?? rent.invoiceId}>
                    <td className="px-4 py-3 align-top">
                      {rent.number ? (
                        <p className="font-semibold text-dark dark:text-white">Facture {rent.number}</p>
                      ) : (
                        <p className="font-semibold text-dark dark:text-white">Pas encore facturé</p>
                      )}
                      <p className="text-xs text-gray-400">Dû depuis le {formatDate(rent.createdAt)}</p>
                      {rent.dueDate && (
                        <p className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-gray-400"}`}>Échéance {formatDate(rent.dueDate)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-dark dark:text-white">{rent.staffName}</p>
                      <p className="text-xs text-gray-500">{rent.staffEmail}</p>
                      <p className="mt-1 max-w-xs truncate text-[11px] text-gray-400" title={rent.period}>
                        {rent.period}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-dark dark:text-white">{euro(rent.remainingAmount)}</td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Virement en attente
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        {rent.invoiceId && (
                          <a
                            href={`/api/invoices/${rent.invoiceId}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-stroke px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6"
                          >
                            <FileText size={13} /> PDF
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setReference("");
                            setAccepting(rent);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          <CheckCircle2 size={13} /> Accepter le paiement
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(accepting)}
        title={`Accepter le paiement de ${accepting?.staffName ?? ""} ?`}
        message={`${accepting?.staffName ?? ""} — ${euro(accepting?.remainingAmount)} par virement. Le loyer sera marqué payé et compté au livre de recettes${
          accepting?.kind === "RENT" ? " ; la facture est émise maintenant, déjà payée — son numéro est définitif." : "."
        }`}
        confirmLabel="Accepter le paiement"
        cancelLabel="Retour"
        loading={busy}
        onConfirm={confirmAccept}
        onCancel={() => !busy && setAccepting(null)}
      >
        <label className="block text-xs font-medium text-gray-500">
          Référence du virement (facultatif)
          <input
            type="text"
            maxLength={100}
            value={reference}
            disabled={busy}
            onChange={(event) => setReference(event.target.value)}
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
