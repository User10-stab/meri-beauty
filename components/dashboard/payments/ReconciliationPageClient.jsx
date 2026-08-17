"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2, ShieldAlert, CircleCheck } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Button from "@/components/ui/Button";
import { listStuckPayments, retryStuckPayment, runMissedRefundsScan } from "@/actions/dashboard/webhook-recovery";

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

export function ReconciliationPageClient({ initialPayments }) {
  const [payments, setPayments] = useState(initialPayments);
  const [retryingId, setRetryingId] = useState(null);
  const [isScanning, startScan] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

  function refetch() {
    startRefresh(async () => {
      const result = await listStuckPayments();
      if (result.success) {
        setPayments(result.data);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleRetry(payment) {
    setRetryingId(payment.id);
    startRefresh(async () => {
      const result = await retryStuckPayment({ paymentId: payment.id });
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      setRetryingId(null);
      refetch();
    });
  }

  function handleScan() {
    startScan(async () => {
      const result = await runMissedRefundsScan();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      refetch();
    });
  }

  const totalOwed = useMemo(
    () => payments.reduce((sum, p) => sum + p.remainingToRefund, 0),
    [payments],
  );

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-col gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-dark-6">
          {payments.length > 0 ? (
            <>
              <ShieldAlert size={16} className="text-amber-500" />
              <span>
                {payments.length} paiement{payments.length > 1 ? "s" : ""} en attente — {formatPrice(totalOwed)} à rembourser au total
              </span>
            </>
          ) : (
            <>
              <CircleCheck size={16} className="text-green-500" />
              <span>Aucun paiement en attente de réconciliation</span>
            </>
          )}
          {(isRefreshing || isScanning) && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>

        <button
          type="button"
          onClick={handleScan}
          disabled={isScanning}
          title="Interroge Stripe pour tout remboursement des 72 dernières heures que le webhook aurait manqué"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-dark-3 dark:text-dark-6 dark:hover:bg-dark-2"
        >
          {isScanning ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Rechercher les webhooks manqués
        </button>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
            <CircleCheck size={22} className="text-green-400" />
          </div>
          <p className="font-medium text-gray-700 dark:text-white">Tous les remboursements sont à jour</p>
          <p className="max-w-sm text-sm text-gray-400">
            Rien ne traîne en attente de traitement Stripe. Le job planifié vérifie aussi automatiquement toutes les 5 minutes.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Type</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Montant dû</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Tentatives</TableHead>
              <TableHead>Dernière tentative</TableHead>
              <TableHead className="pr-6 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-6">
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
                  <span className="text-gray-500 dark:text-dark-6">{p.refundRetryCount}</span>
                </TableCell>
                <TableCell>
                  <span className="text-gray-500 dark:text-dark-6">{formatDate(p.refundAttemptedAt)}</span>
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <Button
                    onClick={() => handleRetry(p)}
                    disabled={retryingId === p.id || !p.hasTransactionReference}
                    className="!px-3 !py-1.5 text-xs"
                  >
                    {retryingId === p.id && <Loader2 size={12} className="animate-spin" />}
                    Réessayer
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
