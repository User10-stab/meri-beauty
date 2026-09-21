"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Building2, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { completeCounterBuyer } from "@/actions/counter/update-buyer";
import { verifyVatNumber } from "@/actions/vat/verify-vat";
import { CounterAddressFields, CounterVatField } from "@/components/dashboard/boutique/counter/CounterBuyerForm";

const EMPTY_ADDRESS = { addressLine1: "", addressLine2: "", addressCity: "", addressPostalCode: "", addressCountry: "BE" };

/**
 * Completes the buyer already attached to a booking — never reassigns who
 * they are. A B2B booking paid in full needs a VAT number and a billing
 * address the moment it is invoiced; a deposit booking needs them by the
 * time it is settled, months later, with the customer no longer at the
 * till. Both windows can close unnoticed (see the unified-counter plan's
 * B2B trap #11) — this lets staff fix it here, whenever the gap is seen.
 */
export function FicheBuyerAction({ ticket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [vatNumber, setVatNumber] = useState(ticket.holderVatNumber ?? "");
  // Same shape as CounterBuyerForm's: { loading } | { valid, message } | { error, message }.
  const [vatCheck, setVatCheck] = useState(null);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [saving, setSaving] = useState(false);

  const hasVat = Boolean(ticket.holderVatNumber);
  const complete = hasVat ? ticket.holderVatInvoiceReady && ticket.holderHasAddress : true;

  async function handleVerifyVat() {
    if (!vatNumber.trim()) return;
    setVatCheck({ loading: true });
    const result = await verifyVatNumber(vatNumber);
    if (!result.success || !result.valid) {
      setVatCheck({ error: true, message: result.message ?? "Ce numéro n'est pas reconnu par le registre européen VIES." });
      return;
    }
    setVatCheck({ valid: true, message: result.name ? `Actif — enregistré au nom de « ${result.name} ».` : "Actif dans le registre VIES." });
  }

  async function handleSave() {
    const wantsVat = vatNumber.trim().length > 0;
    const wantsAddress = address.addressLine1.trim().length > 0;
    if (!wantsVat && !wantsAddress) {
      toast.error("Ajoutez un numéro de TVA ou une adresse avant d'enregistrer.");
      return;
    }
    setSaving(true);
    const result = await completeCounterBuyer({
      userId: ticket.holderId,
      ...(wantsVat ? { vatNumber: vatNumber.trim() } : {}),
      ...(wantsAddress ? address : {}),
    });
    setSaving(false);
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success("Informations client complétées.");
    setOpen(false);
    setAddress(EMPTY_ADDRESS);
    setVatCheck(null);
    onChanged();
  }

  return (
    <div className="rounded-[10px] border border-stroke px-4 py-3 dark:border-dark-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-dark dark:text-white">
          <Building2 className="h-4 w-4 text-primary" strokeWidth={1.75} />
          {hasVat ? `TVA ${ticket.holderVatNumber}` : "Client particulier"}
          {complete && <CheckCircle2 className="h-4 w-4 text-green-dark dark:text-green" strokeWidth={2} />}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {!open && hasVat && !complete && (
        <p className="mt-1.5 text-xs font-medium text-orange-dark dark:text-orange-light">
          Adresse de facturation manquante — nécessaire pour la facture.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-stroke pt-3 dark:border-dark-3">
          <CounterVatField
            value={vatNumber}
            onChange={(value) => {
              setVatNumber(value);
              setVatCheck(null);
            }}
            onVerify={handleVerifyVat}
            vatCheck={vatCheck}
          />

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-gray-500 dark:text-dark-6">
              Adresse de facturation {hasVat ? "(obligatoire pour la facture)" : "(facultatif)"}
            </p>
            <CounterAddressFields address={address} onChange={(field, value) => setAddress((current) => ({ ...current, [field]: value }))} />
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      )}
    </div>
  );
}
