"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Landmark, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import {
  declareBankDeposit,
  confirmBankDeposit,
  listUndepositedWithdrawals,
  listBankDeposits,
  getCashInTransit,
} from "@/actions/dashboard/bank-deposits";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

function StatCard({ icon, label, value, tone = "default" }) {
  const toneClass =
    tone === "warning"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
      : "bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white";
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${toneClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}

/**
 * A withdrawal leaving the drawer and that cash actually reaching the bank
 * are two different facts (see actions/dashboard/bank-deposits.js). This
 * screen is where the second fact gets recorded: bundle one or more
 * undeposited withdrawals, declare what the deposit slip says, and later —
 * once someone checks the actual bank statement — confirm it.
 */
export function BankDepositClient({ initialUndeposited, initialHistory, initialTransit }) {
  const [undeposited, setUndeposited] = useState(initialUndeposited);
  const [history, setHistory] = useState(initialHistory);
  const [transit, setTransit] = useState(initialTransit);
  const [selectedIds, setSelectedIds] = useState([]);
  const [reference, setReference] = useState("");
  const [declaredAmount, setDeclaredAmount] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedTotal = useMemo(
    () => undeposited.filter((m) => selectedIds.includes(m.id)).reduce((sum, m) => sum + m.amount, 0),
    [undeposited, selectedIds]
  );

  async function refresh() {
    const [undepositedResult, historyResult, transitResult] = await Promise.all([
      listUndepositedWithdrawals(),
      listBankDeposits({ pageSize: 20 }),
      getCashInTransit(),
    ]);
    if (undepositedResult.success) setUndeposited(undepositedResult.data);
    if (historyResult.success) setHistory(historyResult.data);
    if (transitResult.success) setTransit(transitResult.data);
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleDeclare() {
    if (selectedIds.length === 0) return toast.error("Sélectionnez au moins un retrait à déposer.");
    if (!reference.trim()) return toast.error("Indiquez la référence de l'opération bancaire.");
    const amount = Number(declaredAmount);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez le montant déposé.");

    startTransition(async () => {
      const result = await declareBankDeposit({
        movementIds: selectedIds,
        reference: reference.trim(),
        declaredAmount: amount,
        note: note.trim() || null,
      });
      if (!result.success) return toast.error(result.message);
      setSelectedIds([]);
      setReference("");
      setDeclaredAmount("");
      setNote("");
      toast.success(
        result.data.variance === 0
          ? "Dépôt déclaré — aucun écart."
          : `Dépôt déclaré — écart de ${formatEuro(result.data.variance)}.`
      );
      refresh();
    });
  }

  function handleConfirm(depositId) {
    startTransition(async () => {
      const result = await confirmBankDeposit(depositId);
      if (!result.success) return toast.error(result.message);
      toast.success("Dépôt confirmé sur relevé bancaire.");
      refresh();
    });
  }

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
        <div className="flex items-center gap-2">
          <Landmark size={20} className="text-[#2f3a2e]" />
          <h1 className="text-2xl font-bold text-dark dark:text-white">Dépôts bancaires</h1>
        </div>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Un retrait de caisse et son arrivée en banque sont deux faits distincts — cet écran relie les deux.
        </p>
      </div>

      {transit && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<AlertTriangle size={20} />}
            label="Retraits non déposés"
            value={formatEuro(transit.undepositedAmount)}
            tone={transit.undepositedAmount > 0 ? "warning" : "default"}
          />
          <StatCard
            icon={<AlertTriangle size={20} />}
            label="Déposés, non confirmés"
            value={formatEuro(transit.unconfirmedAmount)}
            tone={transit.unconfirmedAmount > 0 ? "warning" : "default"}
          />
          <StatCard
            icon={<Landmark size={20} />}
            label="Total en transit"
            value={formatEuro(transit.total)}
            tone={transit.total > 0 ? "warning" : "default"}
          />
        </div>
      )}

      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <h2 className="mb-4 font-semibold text-gray-900 dark:text-white">Déclarer un dépôt</h2>

        {undeposited.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-dark-6">Aucun retrait en attente de dépôt.</p>
        ) : (
          <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-dark-3 dark:border-dark-3">
            {undeposited.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(m.id)}
                  onChange={() => toggleSelected(m.id)}
                  className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                />
                <span className="font-mono text-xs text-gray-400">{m.pieceNumber}</span>
                <span className="flex-1">{m.label}</span>
                <span className="text-xs text-gray-400">{formatDateTime(m.occurredAt)}</span>
                <span className="font-medium">{formatEuro(m.amount)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-dark-3">
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Retraits sélectionnés</p>
            <p className="h-10 flex items-center text-sm font-semibold text-gray-900 dark:text-white">
              {formatEuro(selectedTotal)}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="deposit-reference">
              Référence bancaire
            </label>
            <input
              id="deposit-reference"
              type="text"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="N° du bordereau / relevé"
              className="h-10 w-48 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="deposit-amount">
              Montant déposé (reçu bancaire)
            </label>
            <input
              id="deposit-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={declaredAmount}
              onChange={(event) => setDeclaredAmount(event.target.value)}
              placeholder={selectedTotal ? selectedTotal.toFixed(2) : "0.00"}
              className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="deposit-note">
              Note (optionnel)
            </label>
            <input
              id="deposit-note"
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <Button onClick={handleDeclare} disabled={isPending}>
            <Landmark size={16} />
            Déclarer le dépôt
          </Button>
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-semibold text-gray-900 dark:text-white">Historique des dépôts</h2>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500">
            Aucun dépôt déclaré pour l&apos;instant.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
                <tr>
                  <th className="px-4 py-3">Déclaré</th>
                  <th className="px-4 py-3">Référence</th>
                  <th className="px-4 py-3">Retraits</th>
                  <th className="px-4 py-3">Déposé</th>
                  <th className="px-4 py-3">Écart</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
                {history.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {formatDateTime(d.declaredAt)}
                      <div className="text-xs text-gray-400">{d.declaredBy?.fullName ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{d.reference}</td>
                    <td className="px-4 py-3">{formatEuro(d.amount)}</td>
                    <td className="px-4 py-3">{formatEuro(d.declaredAmount)}</td>
                    <td className={`px-4 py-3 font-medium ${d.variance === 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {formatEuro(d.variance)}
                    </td>
                    <td className="px-4 py-3">
                      {d.status === "CONFIRMED" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                          <CheckCircle2 size={12} />
                          Confirmé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          Déclaré
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.status === "DECLARED" && (
                        <button
                          type="button"
                          onClick={() => handleConfirm(d.id)}
                          disabled={isPending}
                          className="text-sm font-medium text-[#2f3a2e] hover:underline disabled:opacity-50 dark:text-white"
                        >
                          Confirmer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
