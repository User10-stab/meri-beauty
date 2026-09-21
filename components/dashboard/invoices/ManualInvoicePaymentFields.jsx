"use client";

import { Banknote, CreditCard, Landmark, TriangleAlert } from "lucide-react";
import { CASH_PAYMENT_LEGAL_LIMIT } from "@/lib/invoices/manual-invoice-constants";

/**
 * The money half of a manual invoice — shared by the composer (« Encaisser
 * maintenant ») and the list's « Encaisser » dialog, so both ask for exactly
 * what settleManualInvoice / createManualInvoice require: the amount received
 * for cash, the terminal ticket for a card, the bank reference for a
 * transfer. Fully controlled — state lives in the parent.
 */

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

export const MANUAL_PAYMENT_METHOD_OPTIONS = [
  { value: "CASH", label: "Espèces", icon: Banknote },
  { value: "CARD", label: "Carte (terminal)", icon: CreditCard },
  { value: "TRANSFER", label: "Virement", icon: Landmark },
];

const inputClass =
  "w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white";

/** Whether the fields are complete enough to submit — mirrors the server schema. */
export function isPaymentComplete({ method, cashReceived, reference }, total) {
  if (method === "CASH") {
    const received = Number(cashReceived);
    return cashReceived !== "" && !Number.isNaN(received) && received + 0.001 >= total;
  }
  // A card's terminal ticket is its receipt, so it stays required; a transfer's
  // bank reference does not (see lib/validations/manual-invoice.js).
  return method !== "CARD" || Boolean(reference?.trim());
}

// `lockedMethod` hides the method choice — « Virement reçu » only ever
// records a transfer.
export function ManualInvoicePaymentFields({ value, onChange, total, disabled = false, lockedMethod = false }) {
  const { method, cashReceived, reference } = value;
  const received = Number(cashReceived);
  const changeDue = cashReceived !== "" && !Number.isNaN(received) ? received - total : null;
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {!lockedMethod && (
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Mode de paiement">
        {MANUAL_PAYMENT_METHOD_OPTIONS.map(({ value: option, label, icon: Icon }) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={method === option}
            disabled={disabled}
            onClick={() => set({ method: option })}
            className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs font-semibold transition disabled:opacity-50 ${
              method === option
                ? "border-[#2f3a2e] bg-[#f4f7f3] text-[#2f3a2e] ring-1 ring-[#2f3a2e]"
                : "border-stroke text-gray-600 hover:border-gray-400 dark:border-dark-3 dark:text-dark-6"
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
      )}

      {method === "CASH" && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">
            Montant reçu
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={cashReceived}
              disabled={disabled}
              onChange={(event) => set({ cashReceived: event.target.value })}
              className={`${inputClass} mt-1`}
              placeholder={total.toFixed(2)}
            />
          </label>
          {changeDue !== null && (
            <p className={`text-sm font-semibold ${changeDue < 0 ? "text-red-600" : "text-dark dark:text-white"}`}>
              {changeDue < 0 ? `Manque ${euro(-changeDue)}` : `À rendre : ${euro(changeDue)}`}
            </p>
          )}
          {total > CASH_PAYMENT_LEGAL_LIMIT && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              En Belgique, un paiement en espèces est limité à {euro(CASH_PAYMENT_LEGAL_LIMIT)}. Préférez un virement ou la carte.
            </p>
          )}
          <p className="text-[11px] text-gray-400">Les espèces sont inscrites au livre de caisse de la session ouverte.</p>
        </div>
      )}

      {method !== "CASH" && (
        <label className="block text-xs font-medium text-gray-500">
          {method === "CARD" ? "Référence du ticket terminal" : "Référence du virement (communication ou n° d'opération)"}
          <input
            type="text"
            maxLength={100}
            value={reference}
            disabled={disabled}
            onChange={(event) => set({ reference: event.target.value })}
            className={`${inputClass} mt-1`}
            placeholder={method === "CARD" ? "Ex. 004512" : "Ex. +++123/4567/89012+++"}
          />
        </label>
      )}
    </div>
  );
}
