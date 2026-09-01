"use client";

import { useState, useTransition } from "react";
import { ArrowDownCircle, ArrowUpCircle, Receipt } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { recordCashMovement } from "@/actions/dashboard/cash-movements";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
}

const MOVEMENT_TYPES = [
  { value: "EXPENSE", label: "Dépense", hint: "Argent sorti du tiroir pour un achat (emballages, transport, fournisseur...)" },
  { value: "CASH_IN", label: "Apport", hint: "Argent ajouté au tiroir hors vente (appoint de monnaie...)" },
  { value: "WITHDRAWAL", label: "Transfert de banque", hint: "Argent sorti pour être déposé en banque" },
];

/**
 * Records money entering or leaving the drawer without being a sale — the
 * "D001 Achat petits emballages" / "D002 Frais de livraison" lines from the
 * cash-book example. Only rendered while a till session is open: recording
 * a movement against a closed till is refused server-side (see
 * actions/dashboard/cash-movements.js), so there's nothing useful to show
 * here without one.
 */
export function CashMovementPanel({ initialMovements }) {
  const [movements, setMovements] = useState(initialMovements);
  const [type, setType] = useState("EXPENSE");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Indiquez un montant strictement positif.");
    if (!label.trim()) return toast.error("Indiquez un motif.");

    startTransition(async () => {
      const result = await recordCashMovement({ type, amount: value, label: label.trim() });
      if (!result.success) return toast.error(result.message);
      setMovements((prev) => [...prev, result.data]);
      setAmount("");
      setLabel("");
      toast.success(`${result.data.pieceNumber} enregistré.`);
    });
  }

  const selected = MOVEMENT_TYPES.find((t) => t.value === type);

  return (
    <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Receipt size={18} className="text-[#2f3a2e]" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Mouvements de caisse</h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 border-b border-gray-100 pb-4 dark:border-dark-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-type">Type</label>
          <select
            id="movement-type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          >
            {MOVEMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-amount">Montant</label>
          <input
            id="movement-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            className="h-10 w-32 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="movement-label">Motif</label>
          <input
            id="movement-label"
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={selected?.hint}
            maxLength={200}
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {type === "EXPENSE" ? <ArrowDownCircle size={16} /> : <ArrowUpCircle size={16} />}
          Enregistrer
        </Button>
      </form>

      {movements.length === 0 ? (
        <p className="pt-4 text-sm text-gray-500 dark:text-dark-6">Aucun mouvement enregistré pour cette session.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-gray-400">
              <tr>
                <th className="py-2 pr-4">Heure</th>
                <th className="py-2 pr-4">N° pièce</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Motif</th>
                <th className="py-2 pr-4 text-right">Montant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="py-2 pr-4 whitespace-nowrap">{formatTime(m.occurredAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{m.pieceNumber}</td>
                  <td className="py-2 pr-4">{MOVEMENT_TYPES.find((t) => t.value === m.type)?.label ?? m.type}</td>
                  <td className="py-2 pr-4">{m.label}</td>
                  <td className={`py-2 pr-4 text-right font-medium ${m.type === "CASH_IN" ? "text-emerald-600" : "text-red-600"}`}>
                    {m.type === "CASH_IN" ? "+" : "−"}
                    {formatEuro(m.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
