"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileText, Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getCashBookLedger } from "@/actions/dashboard/cash-book";
import { listSessionWithdrawals } from "@/actions/dashboard/bank-deposits";
import { sendTicketByEmail } from "@/actions/payments/send-ticket-email";
import { CashMovementPanel } from "@/components/dashboard/boutique/CashMovementPanel";
import { SessionBankDepositPanel } from "@/components/dashboard/boutique/SessionBankDepositPanel";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Brussels" });
}

const ROW_STYLES = {
  OPENING: "font-semibold text-gray-900 dark:text-white",
  REFUND: "text-red-600",
  EXPENSE: "text-red-600",
  WITHDRAWAL: "text-red-600",
};

/**
 * Where a row's N° pièce links to, so a controller reading the book can pull
 * up the actual document behind the line — not just its own sale (link with
 * ?transactionId, which /api/payments/[id]/ticket resolves to exactly one
 * collection), but for a REFUND too, since that's the row type where "what
 * did this money come from" traceability matters most. collectionTicketFields
 * rejects a REFUND transactionType and the payments-ticket route only ever
 * queries DEPOSIT/FINAL_PAYMENT collections, so a REFUND's own transactionId
 * can never resolve there — it links to the payment's ticket without one
 * instead, opening whatever collection(s) are on file for it. A drawer
 * movement (CashMovement — EXPENSE/CASH_IN/WITHDRAWAL) has no Payment at
 * all, so it never gets a link.
 */
function pieceNumberHref(row) {
  if (row.kind !== "SALE" && row.kind !== "REFUND") return null;
  if (row.orderId) return `/api/orders/${row.orderId}/ticket`;
  if (row.paymentId && row.kind === "SALE") return `/api/payments/${row.paymentId}/ticket?transactionId=${row.transactionId}`;
  if (row.paymentId) return `/api/payments/${row.paymentId}/ticket`;
  return null;
}

// A reservation ticket (never a boutique order's — that one has no e-mail
// counterpart in this feature) that a collection or refund actually produced.
function canEmailRow(row) {
  return Boolean(row.paymentId) && !row.orderId && (row.kind === "SALE" || row.kind === "REFUND");
}

export function CashBookClient({ ledger: initialLedger, movements = [], withdrawals = [], canSendTicketEmail = false }) {
  const [ledger, setLedger] = useState(initialLedger);
  const [sessionWithdrawals, setSessionWithdrawals] = useState(withdrawals);
  const [sendingRow, setSendingRow] = useState(null);
  const { session, rows, totals } = ledger;

  async function handleSendTicket(row, rowKey) {
    setSendingRow(rowKey);
    const result = await sendTicketByEmail(row.paymentId, { transactionId: row.kind === "SALE" ? row.transactionId : undefined });
    setSendingRow(null);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  const reload = useCallback(() => {
    getCashBookLedger(session.id).then((result) => {
      if (result.success) setLedger(result.data);
    }).catch(() => {});
    listSessionWithdrawals(session.id).then((result) => {
      if (result.success) setSessionWithdrawals(result.data);
    }).catch(() => {});
  }, [session.id]);

  // A closed session's ledger is a frozen historical record — nothing to
  // poll for. An open one changes every time a sale lands anywhere (POS,
  // Pointage & encaissement) while a cashier may be sitting on this exact
  // page watching it, so it re-reads itself rather than requiring a manual
  // reload to see a sale that just happened elsewhere.
  useEffect(() => {
    if (session.closedAt) return;
    let cancelled = false;
    const interval = setInterval(() => {
      getCashBookLedger(session.id).then((result) => {
        if (!cancelled && result.success) setLedger(result.data);
      }).catch(() => {});
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [session.id, session.closedAt]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/dashboard/boutique/caisse"
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-gray-500 hover:text-primary dark:text-dark-6"
        >
          <ArrowLeft size={14} />
          Retour à la caisse
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookOpen size={20} className="text-[#2f3a2e]" />
            <h1 className="text-2xl font-bold text-dark dark:text-white">Livre de caisse</h1>
          </div>
          <Link
            href={`/dashboard/boutique/caisse/${session.id}/rapport`}
            className="inline-flex items-center gap-1 text-sm font-medium text-[#2f3a2e] hover:underline dark:text-white"
          >
            <FileText size={14} />
            Rapport {session.closedAt ? "Z" : "X"}
          </Link>
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Session ouverte le {formatDateTime(session.openedAt)}
          {session.closedAt ? ` — clôturée le ${formatDateTime(session.closedAt)}` : " — en cours"}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.entrees)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Total entrées</p>
        </div>
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.sorties)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Total sorties</p>
        </div>
        <div className="rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
          <p className="text-xl font-bold text-dark dark:text-white">{formatEuro(totals.finalBalance)}</p>
          <p className="text-sm text-gray-500 dark:text-dark-6">Solde {session.closedAt ? "final" : "actuel"}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3">N° pièce</th>
              <th className="whitespace-nowrap px-4 py-3">Réf.</th>
              <th className="px-4 py-3">Désignation</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Entrées (€)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Sorties (€)</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Solde (€)</th>
              {canSendTicketEmail && <th className="whitespace-nowrap px-4 py-3">Ticket</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
            {rows.map((row, index) => {
              const href = pieceNumberHref(row);
              const rowKey = `${row.kind}-${row.pieceNumber ?? index}-${row.date}`;
              return (
              <tr key={rowKey}>
                <td className="whitespace-nowrap px-4 py-3">{formatDateTime(row.date)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2f3a2e] hover:underline dark:text-white"
                    >
                      {row.pieceNumber}
                    </a>
                  ) : (
                    row.pieceNumber ?? "—"
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.reference ?? "—"}</td>
                <td className={`px-4 py-3 ${ROW_STYLES[row.kind] ?? ""}`}>{row.label}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{row.entree ? formatEuro(row.entree) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">{row.sortie ? formatEuro(row.sortie) : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900 dark:text-white">
                  {formatEuro(row.solde)}
                </td>
                {canSendTicketEmail && (
                  <td className="whitespace-nowrap px-4 py-3">
                    {canEmailRow(row) && (
                      <button
                        type="button"
                        onClick={() => handleSendTicket(row, rowKey)}
                        disabled={sendingRow === rowKey}
                        title="Envoyer par e-mail"
                        aria-label="Envoyer par e-mail"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-dark-3 dark:text-white"
                      >
                        {sendingRow === rowKey ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                        Envoyer par e-mail
                      </button>
                    )}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Both panels belong to this opening, so they live with it rather than
          on the index page (movements) and a separate screen (deposits) —
          recording a withdrawal and walking it to the bank is one errand, and
          it used to span three pages. A closed session keeps the deposit
          panel: cash withdrawn on Friday is routinely banked on Monday, long
          after the till it came from was closed. Recording a *movement*
          against a closed till is refused server-side, so that panel is only
          rendered while the session is open. */}
      {!session.closedAt && <CashMovementPanel initialMovements={movements} onRecorded={reload} />}

      <SessionBankDepositPanel
        withdrawals={sessionWithdrawals}
        onChanged={reload}
        sessionOpen={!session.closedAt}
      />
    </div>
  );
}
