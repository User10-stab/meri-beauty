"use client";

import { Banknote, CreditCard, Landmark } from "lucide-react";

/**
 * The money half of every counter screen — the retail till (CounterCart) and
 * « Pointage & encaissement » (booking balance, pickup order, new prestation,
 * new atelier/formation seat). One component so every screen shows the same
 * tiles, the same labels, the same « montant reçu / monnaie à rendre » helper
 * and the same terminal-reference field. Before this, the till had tiles and
 * « Terminal externe » while Pointage had radio buttons and « Carte — terminal »
 * for the very same payment.
 *
 * Which methods appear is up to the caller: each screen offers only what its
 * server action accepts (bookings and pickups: CASH / EXTERNAL_TERMINAL; the
 * till adds CARD_QR and, for invoice sales, TRANSFER). Fully controlled.
 */

export const COUNTER_PAYMENT_METHODS = {
  CARD_QR: { label: "Carte QR", icon: CreditCard },
  CASH: { label: "Espèces", icon: Banknote },
  EXTERNAL_TERMINAL: { label: "Terminal externe", icon: CreditCard },
  TRANSFER: { label: "Virement", icon: Landmark },
};

export const TERMINAL_REFERENCE_LABEL = "Référence du ticket du terminal";

const inputClass =
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white";

/**
 * @param {object} props
 * @param {string[]} props.methods e.g. ["CASH", "EXTERNAL_TERMINAL"]
 * @param {string} props.value
 * @param {(method: string) => void} props.onChange
 * @param {Record<string, string>} [props.disabled] method → reason it is unavailable (shown as tooltip)
 * @param {string} [props.label] heading above the tiles
 */
export function CounterPaymentMethodTiles({ methods, value, onChange, disabled = {}, label = "Mode de paiement" }) {
  const columns = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[methods.length] ?? "sm:grid-cols-4";
  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-medium text-gray-700 dark:text-dark-6">{label}</p>}
      <div className={`grid grid-cols-1 gap-2 ${columns}`} role="radiogroup" aria-label={label || "Mode de paiement"}>
        {methods.map((method) => {
          const { label: text, icon: Icon } = COUNTER_PAYMENT_METHODS[method];
          const reason = disabled[method];
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={value === method}
              disabled={Boolean(reason)}
              title={reason || undefined}
              onClick={() => onChange(method)}
              className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                value === method ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]" : "border-gray-200 text-gray-600 dark:border-dark-3 dark:text-dark-6"
              }`}
            >
              <Icon size={16} />
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * « Montant reçu du client » + « Monnaie à rendre ». On the till the amount
 * is sent to the server (cash book); on the Pointage screens it is only a
 * helper for the change — their actions record the amount due.
 */
export function CounterCashReceived({ id, value, onChange, amountDue }) {
  const received = Number(value);
  const change = value !== "" && !Number.isNaN(received) ? Math.round((received - amountDue) * 100) / 100 : null;
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-dark-3">
      <label className="text-xs font-medium text-gray-500" htmlFor={id}>
        Montant reçu du client
      </label>
      <input id={id} type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0.00" className={inputClass} />
      {change !== null && (
        <p className={`text-sm font-medium ${change < 0 ? "text-red-600" : "text-gray-700 dark:text-dark-6"}`}>
          {change < 0 ? `Il manque ${Math.abs(change).toFixed(2)} €` : `Monnaie à rendre : ${change.toFixed(2)} €`}
        </p>
      )}
    </div>
  );
}

/** The terminal's receipt reference — the only evidence tying a card payment to a real charge. */
export function CounterTerminalReference({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      maxLength={100}
      placeholder={`${TERMINAL_REFERENCE_LABEL} (obligatoire)`}
      aria-label={TERMINAL_REFERENCE_LABEL}
      className={inputClass}
    />
  );
}
