"use client";

import { useMemo, useState, useTransition } from "react";
import { Landmark, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/Button";
import { declareBankDeposit, confirmBankDeposit } from "@/actions/dashboard/bank-deposits";

function formatEuro(value) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(value);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
}

/**
 * Depositing this opening's takings, on the page where the opening already
 * lives.
 *
 * The deposit that actually happens ninety-nine times out of a hundred is
 * "everything that left this drawer went to the bank, and the slip says the
 * same" — so that is the one gesture: a single button, with every pending
 * withdrawal already selected. The reference and a differing amount are the
 * exceptions, and they are folded away behind "Le dépôt diffère" rather than
 * standing between the cashier and the common case.
 *
 * Deselection, not selection, is what is tracked — a withdrawal recorded
 * while this panel is open is then included by default instead of silently
 * left behind by a selection made before it existed.
 *
 * `withdrawals` is owned by CashBookClient, which also owns the ledger the
 * same movements appear in: two copies of that list, refreshed
 * independently, would eventually disagree on the same screen.
 */
export function SessionBankDepositPanel({ withdrawals, onChanged, sessionOpen = true }) {
  const [excludedIds, setExcludedIds] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [reference, setReference] = useState("");
  const [declaredAmount, setDeclaredAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirmReference, setConfirmReference] = useState({});
  const [isPending, startTransition] = useTransition();

  const pending = useMemo(() => withdrawals.filter((w) => !w.deposit), [withdrawals]);
  const deposited = useMemo(() => withdrawals.filter((w) => w.deposit), [withdrawals]);
  const selected = useMemo(() => pending.filter((w) => !excludedIds.includes(w.id)), [pending, excludedIds]);
  const selectedTotal = useMemo(() => selected.reduce((sum, w) => sum + w.amount, 0), [selected]);

  function toggleExcluded(id) {
    setExcludedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleDeclare() {
    if (selected.length === 0) return toast.error("Sélectionnez au moins un retrait à déposer.");

    // Left blank, the amount is not missing — it is the cashier saying the
    // slip matches what left the drawer. declareBankDeposit records that as
    // an agreeing count, not as an absent one.
    const typed = showDetails ? declaredAmount.trim() : "";
    if (typed !== "") {
      const parsed = Number(typed);
      if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Indiquez un montant déposé valide.");
    }

    startTransition(async () => {
      const result = await declareBankDeposit({
        movementIds: selected.map((w) => w.id),
        reference: showDetails ? reference.trim() || null : null,
        declaredAmount: typed === "" ? null : Number(typed),
        note: showDetails ? note.trim() || null : null,
      });
      if (!result.success) return toast.error(result.message);
      setExcludedIds([]);
      setReference("");
      setDeclaredAmount("");
      setNote("");
      setShowDetails(false);
      toast.success(
        result.data.variance === 0
          ? "Dépôt enregistré — aucun écart."
          : `Dépôt enregistré — écart de ${formatEuro(result.data.variance)}.`
      );
      onChanged?.();
    });
  }

  function handleConfirm(depositId) {
    startTransition(async () => {
      const result = await confirmBankDeposit(depositId, { reference: confirmReference[depositId] ?? null });
      if (!result.success) return toast.error(result.message);
      setConfirmReference((prev) => ({ ...prev, [depositId]: "" }));
      toast.success("Dépôt confirmé sur relevé bancaire.");
      onChanged?.();
    });
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Landmark size={18} className="text-[#2f3a2e]" />
        <h2 className="font-semibold text-gray-900 dark:text-white">Dépôts bancaires de cette ouverture</h2>
      </div>

      {pending.length === 0 && deposited.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-dark-6">
          Aucun transfert vers la banque sur cette ouverture.
          {/* The movement form only exists while the till is open, so a
              closed session must not be told to use it. */}
          {sessionOpen && " Enregistrez-en un avec le type « Transfert de banque » ci-dessus."}
        </p>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">En attente de dépôt</p>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-dark-3 dark:border-dark-3">
                {pending.map((w) => (
                  <label key={w.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!excludedIds.includes(w.id)}
                      onChange={() => toggleExcluded(w.id)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                    />
                    <span className="font-mono text-xs text-gray-400">{w.pieceNumber}</span>
                    <span className="flex-1 text-gray-700 dark:text-dark-6">{w.label}</span>
                    <span className="text-xs text-gray-400">{formatTime(w.occurredAt)}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatEuro(w.amount)}</span>
                  </label>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button onClick={handleDeclare} disabled={isPending || selected.length === 0}>
                  <Landmark size={16} />
                  Déposer en banque — {formatEuro(selectedTotal)}
                </Button>
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-[#2f3a2e] dark:text-dark-6 dark:hover:text-white"
                >
                  {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Le dépôt diffère (montant, référence)
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Sans précision, le dépôt est enregistré pour le montant exact sorti du tiroir.
              </p>

              {showDetails && (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3 dark:border-dark-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="session-deposit-amount">
                      Montant réellement déposé
                    </label>
                    <input
                      id="session-deposit-amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={declaredAmount}
                      onChange={(event) => setDeclaredAmount(event.target.value)}
                      placeholder={selectedTotal.toFixed(2)}
                      className="h-10 w-40 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="session-deposit-reference">
                      Référence bancaire (optionnel)
                    </label>
                    <input
                      id="session-deposit-reference"
                      type="text"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="N° du bordereau / relevé"
                      className="h-10 w-48 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                  </div>
                  <div className="min-w-[180px] flex-1">
                    <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="session-deposit-note">
                      Note (optionnel)
                    </label>
                    <input
                      id="session-deposit-note"
                      type="text"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {deposited.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Déposé</p>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-dark-3 dark:border-dark-3">
                {deposited.map((w) => (
                  <div key={w.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-gray-400">{w.pieceNumber}</span>
                    <span className="flex-1 text-gray-700 dark:text-dark-6">{w.label}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatEuro(w.amount)}</span>
                    {w.deposit.reference && (
                      <span className="font-mono text-xs text-gray-400">{w.deposit.reference}</span>
                    )}
                    {w.deposit.variance !== 0 && (
                      <span className="text-xs font-medium text-red-600">écart {formatEuro(w.deposit.variance)}</span>
                    )}
                    {w.deposit.status === "CONFIRMED" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                        <CheckCircle2 size={12} />
                        Confirmé
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        {!w.deposit.reference && (
                          <input
                            type="text"
                            value={confirmReference[w.deposit.id] ?? ""}
                            onChange={(event) =>
                              setConfirmReference((prev) => ({ ...prev, [w.deposit.id]: event.target.value }))
                            }
                            placeholder="Réf. relevé (optionnel)"
                            className="h-8 w-40 rounded-lg border border-gray-200 px-2 text-xs outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => handleConfirm(w.deposit.id)}
                          disabled={isPending}
                          className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-500/10 dark:text-amber-400"
                        >
                          Confirmer sur relevé
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
