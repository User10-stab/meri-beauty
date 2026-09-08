"use client";

import { Loader2, ShieldQuestion, UserRound } from "lucide-react";

/**
 * The buyer half of a counter transaction: walk-in toggle, customer
 * search/typeahead, VAT/VIES box, and the billing-address block that only
 * appears when it's actually required.
 *
 * Extracted verbatim from PointOfSaleClient (the retail till) so it can be
 * shared with the walk-in service composer and, later, a counter booking
 * composer — every screen that resolves a buyer needs the exact same B2C/B2B
 * capture, and duplicating this JSX across screens is how the three counter
 * surfaces drifted apart in the first place.
 *
 * Deliberately a pure, fully-controlled component: every piece of state
 * (customer, isWalkIn, matches, vatCheck…) and every side effect (the
 * debounced customer search, the walk-in e-mail account-match check) stays
 * in the parent. Moving that state here would risk changing behaviour during
 * what is meant to be a zero-behaviour-change extraction — this component
 * only ever renders props and calls the callbacks it's given.
 *
 * @param {object} props
 * @param {object} props.customer Current buyer draft — id, fullName, email,
 *   phone, vatNumber, isCompany, vatInvoiceReady, vatValidationName, and the
 *   five addressXxx fields.
 * @param {(field: string, value: string) => void} props.updateCustomer
 *   Identity field edit — detaches from an already-matched customer.
 * @param {(field: string, value: string) => void} props.updateCustomerAddress
 *   Address field edit — does not detach from a match.
 * @param {(value: string) => void} props.updateCustomerVat
 * @param {boolean} props.isWalkIn
 * @param {(next: boolean) => void} props.toggleWalkIn
 * @param {string} props.walkInEmail
 * @param {(value: string) => void} props.setWalkInEmail
 * @param {object|null} props.walkInEmailMatch An existing account whose email
 *   exactly matches the typed walk-in address, or null.
 * @param {() => void} props.useMatchedAccountInstead
 * @param {Array<object>} props.matches Customer search results (id, fullName, email).
 * @param {(match: object) => void} props.selectCustomer
 * @param {{loading?:boolean, error?:boolean, valid?:boolean, message?:string}|null} props.vatCheck
 *   Live VIES preview state — the authoritative check happens server-side.
 * @param {() => void} props.handleVerifyVat
 * @param {boolean} props.needsAddress Whether the billing-address block must show.
 * @param {boolean} props.willHaveVatInvoice
 * @param {boolean} props.willBeBelgianB2B
 * @param {boolean} [props.allowWalkIn] Default true (retail till, unchanged
 *   behaviour). A booking always needs a named holder — no ticket/QR to send
 *   otherwise — so the composer passes false to drop the checkbox and the
 *   anonymous branch entirely; the caller's own isWalkIn simply never
 *   becomes true in that case.
 */
export function CounterBuyerForm({
  customer,
  updateCustomer,
  updateCustomerAddress,
  updateCustomerVat,
  isWalkIn,
  toggleWalkIn,
  walkInEmail,
  setWalkInEmail,
  walkInEmailMatch,
  useMatchedAccountInstead,
  matches,
  selectCustomer,
  vatCheck,
  handleVerifyVat,
  needsAddress,
  willHaveVatInvoice,
  willBeBelgianB2B,
  allowWalkIn = true,
}) {
  return (
    <>
      <div className="flex items-center gap-2"><UserRound size={18} className="text-[#2f3a2e]" /><h2 className="font-semibold text-gray-900 dark:text-white">Client et reçu</h2></div>

      {allowWalkIn && (
      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-dark-6">
        <input
          type="checkbox"
          checked={isWalkIn}
          onChange={(event) => toggleWalkIn(event.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
        />
        Client de passage — pas de compte, ticket simplifié sans nom
      </label>
      )}

      {isWalkIn ? (
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-dark-3 dark:bg-dark-2">
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Aucune identité n&apos;est enregistrée. Le ticket sera généré puis envoyé par e-mail — le paiement par QR n&apos;est pas disponible dans ce mode.
          </p>
          <input
            value={walkInEmail}
            onChange={(event) => setWalkInEmail(event.target.value)}
            placeholder="E-mail du client — obligatoire pour envoyer le ticket"
            type="email"
            autoComplete="off"
            className="h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-3 dark:text-white"
          />
          <p className="text-xs text-gray-400 dark:text-dark-6">
            Sans nom associé, ce n&apos;est jamais une facture nominative: seulement le ticket envoyé par e-mail.
          </p>
          {walkInEmailMatch && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/10">
              <p className="font-semibold">
                Un compte existe déjà pour cette adresse ({walkInEmailMatch.fullName}).
              </p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                Un ticket anonyme lui serait envoyé sans être rattaché à son profil ni à son historique.
              </p>
              <button
                type="button"
                onClick={useMatchedAccountInstead}
                className="mt-1.5 font-semibold underline decoration-amber-400 underline-offset-2 hover:no-underline"
              >
                Utiliser plutôt sa fiche client
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="relative space-y-3">
          <input value={customer.fullName} onChange={(event) => updateCustomer("fullName", event.target.value)} placeholder="Nom complet" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
          <input value={customer.email} onChange={(event) => updateCustomer("email", event.target.value)} placeholder="E-mail pour le reçu" type="email" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
          <input value={customer.phone} onChange={(event) => updateCustomer("phone", event.target.value)} placeholder="Téléphone (facultatif)" className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white" />
          {matches.length > 0 && (
            <div className="absolute z-10 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-dark-3 dark:bg-dark-2">
              {matches.map((match) => (
                <button key={match.id} type="button" onClick={() => selectCustomer(match)} className="block w-full border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50 dark:border-dark-3 dark:hover:bg-dark-3">
                  <span className="block text-sm font-medium">{match.fullName}</span><span className="block text-xs text-gray-500">{match.email}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isWalkIn && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Numéro de TVA (facultatif) — pour un client professionnel (B2B). Laissez vide pour un client particulier (B2C).
          </p>
          <div className="flex gap-2">
            <input
              value={customer.vatNumber}
              onChange={(event) => updateCustomerVat(event.target.value)}
              placeholder="BE0123456789 ou FRXX123456789"
              autoComplete="off"
              className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 text-sm uppercase tracking-wide outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            <button
              type="button"
              onClick={handleVerifyVat}
              disabled={customer.vatInvoiceReady || vatCheck?.loading}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 transition-colors hover:border-[#2f3a2e] hover:text-[#2f3a2e] disabled:opacity-50 dark:border-dark-3 dark:text-dark-6"
            >
              {vatCheck?.loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldQuestion size={14} />}
              {customer.vatInvoiceReady ? "Validée" : "Vérifier"}
            </button>
          </div>
          {customer.vatInvoiceReady && (
            <p className="text-xs font-medium text-emerald-600">
              TVA déjà validée via VIES{customer.vatValidationName ? ` — ${customer.vatValidationName}` : ""}. La facture sera créée, puis envoyée manuellement depuis Opérations.
            </p>
          )}
          {vatCheck && !vatCheck.loading && (
            <p className={`text-xs font-medium ${vatCheck.error || vatCheck.valid === false ? "text-red-600" : "text-emerald-600"}`}>
              {vatCheck.message}
            </p>
          )}
        </div>
      )}

      {!isWalkIn && (
        willHaveVatInvoice ? (
          <p className="text-xs font-medium text-gray-500 dark:text-dark-6">
            {willBeBelgianB2B
              ? "Client avec TVA belge valide — une facture sera créée et numérotée, puis transmise manuellement via Billit/Peppol depuis Opérations. Le client reçoit toujours son ticket par e-mail."
              : "Client avec TVA VIES valide — une facture sera créée et numérotée, puis envoyée manuellement depuis Opérations. Le client reçoit toujours son ticket par e-mail."}
          </p>
        ) : (
          <p className="text-xs font-medium text-gray-500 dark:text-dark-6">
            Client particulier — aucune facture ne sera générée. Le ticket sera envoyé automatiquement par e-mail.
          </p>
        )
      )}

      {!isWalkIn && needsAddress && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-900/10">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Adresse de facturation obligatoire pour ce client (nouveau ou sans adresse enregistrée).
          </p>
          <input
            required
            value={customer.addressLine1}
            onChange={(event) => updateCustomerAddress("addressLine1", event.target.value)}
            placeholder="Rue et numéro"
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          <input
            value={customer.addressLine2}
            onChange={(event) => updateCustomerAddress("addressLine2", event.target.value)}
            placeholder="Boîte, étage (facultatif)"
            className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
          <div className="flex gap-2">
            <input
              required
              value={customer.addressPostalCode}
              onChange={(event) => updateCustomerAddress("addressPostalCode", event.target.value)}
              placeholder="Code postal"
              className="h-10 w-24 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            <input
              required
              value={customer.addressCity}
              onChange={(event) => updateCustomerAddress("addressCity", event.target.value)}
              placeholder="Ville"
              className="h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
            <input
              value={customer.addressCountry}
              onChange={(event) => updateCustomerAddress("addressCountry", event.target.value.toUpperCase())}
              placeholder="BE"
              maxLength={2}
              className="h-10 w-16 rounded-lg border border-gray-200 px-3 text-center text-sm uppercase outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
        </div>
      )}
    </>
  );
}
