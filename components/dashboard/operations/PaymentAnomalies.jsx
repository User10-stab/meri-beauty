"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, ShieldAlert, CircleCheck } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { listStuckPayments, runMissedRefundsScan } from "@/actions/dashboard/webhook-recovery";

const STATUS_LABEL = {
  REFUND_PENDING: "En attente",
  REFUND_FAILED: "Échoué",
};

const STATUS_STYLE = {
  REFUND_PENDING: "bg-amber-50 text-amber-700 border-amber-100",
  REFUND_FAILED: "bg-red-50 text-red-600 border-red-100",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}

function formatDate(d) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" }) : "—";
}

/**
 * "Anomalies à traiter" — payments left in REFUND_PENDING / REFUND_FAILED.
 *
 * This used to be its own /dashboard/payments/reconciliation page, and that
 * placement had become misleading: since the application stopped issuing
 * Stripe refunds itself (2026-09-02), nothing in the live refund flow sets
 * those statuses. A whole page named "Réconciliation" read as though it
 * supervised the manual RefundOperation process, which it does not — the
 * worklist that does is "Remboursements dus", right above this.
 *
 * Deleting it was the wrong call the other way: these rows are real money
 * from before the change, plus anything the legacy pin path
 * (lib/payments/pin-pending-refund.js) still writes, and removing the only
 * screen that shows them would just hide the discrepancy. So it lives here,
 * next to the other money that needs attention, sized like what it is: a
 * short anomalies list, empty on a healthy system.
 */
export function PaymentAnomalies({ initialPayments }) {
  const [payments, setPayments] = useState(initialPayments ?? []);
  const [isScanning, startScan] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

  function refetch() {
    startRefresh(async () => {
      const result = await listStuckPayments();
      if (result.success) setPayments(result.data);
      else toast.error(result.message);
    });
  }

  function handleScan() {
    startScan(async () => {
      const result = await runMissedRefundsScan();
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
      refetch();
    });
  }

  const totalOwed = useMemo(
    () => payments.reduce((sum, p) => sum + p.remainingToRefund, 0),
    [payments],
  );

  // A healthy system has nothing here. Rendering an empty panel on every visit
  // trains staff to scroll past the one place an anomaly would appear, so the
  // section collapses to a single line with the scan button still reachable.
  const isEmpty = payments.length === 0;

  return (
    <section className="rounded-2xl border border-stroke bg-white p-5 dark:border-dark-3 dark:bg-gray-dark">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm">
          {isEmpty ? (
            <>
              <CircleCheck size={16} className="text-green-500" />
              <span className="text-gray-600 dark:text-dark-6">
                Anomalies à traiter — aucune. Tous les paiements sont réconciliés.
              </span>
            </>
          ) : (
            <>
              <ShieldAlert size={16} className="text-amber-500" />
              <span className="font-semibold text-gray-900 dark:text-white">
                Anomalies à traiter — {payments.length} paiement{payments.length > 1 ? "s" : ""} bloqué
                {payments.length > 1 ? "s" : ""}, {formatPrice(totalOwed)}
              </span>
            </>
          )}
          {(isRefreshing || isScanning) && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>

        <button
          type="button"
          onClick={handleScan}
          disabled={isScanning}
          title="Interroge Stripe pour tout remboursement récent que le webhook aurait manqué"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
        >
          {isScanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Rechercher les webhooks manqués
        </button>
      </div>

      {!isEmpty && (
        <>
          <p className="mt-2 text-[13px] text-gray-600 dark:text-dark-6">
            Un remboursement a été décidé sur ces paiements mais Stripe ne l&apos;a jamais confirmé (webhook manqué,
            appel en erreur). Ils ne suivent pas le flux « Remboursements dus » ci-dessus — traitez-les à la main
            dans Stripe, puis relancez la recherche.
          </p>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Montant dû</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Dernière tentative</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="font-medium text-gray-800 dark:text-white">{p.type}</span>
                      <span className="block text-xs text-gray-400">{p.reference}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-700 dark:text-dark-6">{p.customerName ?? "—"}</span>
                      <span className="block text-xs text-gray-400">{p.customerEmail ?? ""}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-gray-700 dark:text-dark-6">{formatPrice(p.remainingToRefund)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[p.status]}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                      {p.refundFailureReason && (
                        <span className="block max-w-[220px] truncate text-xs text-red-400" title={p.refundFailureReason}>
                          {p.refundFailureReason}
                        </span>
                      )}
                      {!p.hasTransactionReference && (
                        <span className="block text-xs text-amber-500">Sans référence Stripe — manuel requis</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-500 dark:text-dark-6">{formatDate(p.refundAttemptedAt)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
