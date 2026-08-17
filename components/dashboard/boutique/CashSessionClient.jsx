"use client";

import { useState, useTransition } from "react";
import { Wallet, Lock, LockOpen, History } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { openCashSession, closeCashSession, listCashSessions } from "@/actions/dashboard/cash-sessions";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
}

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-[10px] border border-stroke bg-white p-5 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)] text-[#2f3a2e] dark:bg-[#FFFFFF1A] dark:text-white">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-dark dark:text-white">{value}</p>
        <p className="truncate text-sm text-gray-500 dark:text-dark-6">{label}</p>
      </div>
    </div>
  );
}

export function CashSessionClient({ initialCurrent, initialHistory }) {
  const [current, setCurrent] = useState(initialCurrent);
  const [history, setHistory] = useState(initialHistory);
  const [openingFloat, setOpeningFloat] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [isPending, startTransition] = useTransition();

  async function refreshHistory() {
    const result = await listCashSessions({ pageSize: 20 });
    if (result.success) setHistory(result.data);
  }

  function handleOpen() {
    const amount = Number(openingFloat);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez un fond de caisse valide.");
    startTransition(async () => {
      const result = await openCashSession(amount);
      if (!result.success) return toast.error(result.message);
      setCurrent(result.data);
      setOpeningFloat("");
      toast.success("Caisse ouverte.");
      refreshHistory();
    });
  }

  function handleClose() {
    if (!current) return;
    const amount = Number(countedCash);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indiquez le montant compté.");
    startTransition(async () => {
      const result = await closeCashSession(current.id, amount);
      if (!result.success) return toast.error(result.message);
      setCurrent(null);
      setCountedCash("");
      toast.success(
        result.data.variance === 0
          ? "Caisse clôturée — aucun écart."
          : `Caisse clôturée — écart de ${formatEuro(result.data.variance)}.`
      );
      refreshHistory();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-dark dark:text-white">Clôture de caisse</h1>
        <p className="text-sm font-medium text-gray-500 dark:text-dark-6">
          Ouvrez la caisse en début de journée avec le fond de caisse, clôturez-la en fin de service avec le comptage réel.
        </p>
      </div>

      <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        {!current ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <LockOpen size={18} className="text-[#2f3a2e]" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Aucune session ouverte</h2>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="opening-float">Fond de caisse</label>
                <input
                  id="opening-float"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={openingFloat}
                  onChange={(event) => setOpeningFloat(event.target.value)}
                  placeholder="0.00"
                  className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </div>
              <Button onClick={handleOpen} disabled={isPending}>
                <Wallet size={16} />
                Ouvrir la caisse
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Lock size={18} className="text-[#2f3a2e]" />
              <h2 className="font-semibold text-gray-900 dark:text-white">Session ouverte</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-dark-6">
              Ouverte le {formatDateTime(current.openedAt)} par {current.openedBy?.fullName ?? "—"} — fond de caisse {formatEuro(current.openingFloat)}.
            </p>
            <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4 dark:border-dark-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="counted-cash">Montant compté en caisse</label>
                <input
                  id="counted-cash"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={countedCash}
                  onChange={(event) => setCountedCash(event.target.value)}
                  placeholder="0.00"
                  className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                />
              </div>
              <Button onClick={handleClose} disabled={isPending}>
                <Lock size={16} />
                Clôturer la caisse
              </Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <History size={18} className="text-[#2f3a2e]" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Historique</h2>
        </div>
        {history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-5 py-10 text-center text-sm text-gray-500">
            Aucune session clôturée pour l&apos;instant.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {history.some((s) => s.closedAt) && (
              <StatCard
                icon={<Wallet size={20} />}
                label="Dernier écart"
                value={formatEuro(history.find((s) => s.closedAt)?.variance ?? 0)}
              />
            )}
          </div>
        )}
        {history.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stroke text-xs uppercase text-gray-400 dark:border-dark-3">
                <tr>
                  <th className="px-4 py-3">Ouverte</th>
                  <th className="px-4 py-3">Par</th>
                  <th className="px-4 py-3">Fond</th>
                  <th className="px-4 py-3">Clôturée</th>
                  <th className="px-4 py-3">Attendu</th>
                  <th className="px-4 py-3">Compté</th>
                  <th className="px-4 py-3">Écart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-dark-3">
                {history.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(s.openedAt)}</td>
                    <td className="px-4 py-3">{s.openedBy?.fullName ?? "—"}</td>
                    <td className="px-4 py-3">{formatEuro(s.openingFloat)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.closedAt ? formatDateTime(s.closedAt) : "En cours"}</td>
                    <td className="px-4 py-3">{s.expectedCash == null ? "—" : formatEuro(s.expectedCash)}</td>
                    <td className="px-4 py-3">{s.countedCash == null ? "—" : formatEuro(s.countedCash)}</td>
                    <td className={`px-4 py-3 font-medium ${s.variance == null ? "" : s.variance === 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {s.variance == null ? "—" : formatEuro(s.variance)}
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
