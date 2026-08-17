"use client";

import { useState, useEffect } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * Collects the on-site balance when closing out an atelier/formation
 * reservation. Shared by both flows — they take the same 50% deposit and
 * settle identically.
 *
 * The "j'ai bien reçu le paiement" checkbox is not decoration: the server
 * refuses to settle without it (see lib/reservations/settle-reservation.js).
 * Nothing here can observe a cash handoff or a terminal's APPROUVÉ screen,
 * so a human has to attest before the system books it as real revenue and
 * issues an invoice against it.
 */
export function SettleReservationDialog({ reservation, onClose, onConfirm, loading }) {
  const [method, setMethod] = useState("CASH");
  const [confirmed, setConfirmed] = useState(false);

  const balance = Number(reservation?.payment?.remainingAmount ?? 0);
  const hasBalance = balance > 0;

  // Reset per reservation, so a previous row's attestation never carries over.
  useEffect(() => {
    setMethod("CASH");
    setConfirmed(false);
  }, [reservation?.id]);

  if (!reservation) return null;

  const priceFormatted = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(balance);

  return (
    <ConfirmDialog
      open={Boolean(reservation)}
      title="Clôturer la réservation"
      message={
        hasBalance
          ? `Encaissez le solde de ${priceFormatted} avant de clôturer. Une facture sera émise et envoyée au client.`
          : "Cette réservation est déjà entièrement payée. Elle sera simplement marquée comme terminée."
      }
      confirmLabel={hasBalance ? "Encaisser et clôturer" : "Clôturer"}
      loading={loading}
      confirmDisabled={hasBalance && !confirmed}
      onConfirm={() => onConfirm({ method, paymentConfirmed: confirmed })}
      onCancel={onClose}
    >
      {hasBalance && (
        <div className="space-y-4">
          <div>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Mode de paiement du solde
            </span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "CASH", label: "Espèces" },
                { value: "CARD", label: "Carte (terminal)" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMethod(option.value)}
                  className={`rounded-lg border p-2.5 text-sm font-medium transition-colors ${
                    method === option.value
                      ? "border-[#2f3a2e] bg-[#2f3a2e]/5 text-[#2f3a2e]"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#2f3a2e]"
            />
            <span>
              Je confirme avoir bien reçu {priceFormatted}
              {method === "CARD" ? " — le terminal affiche « APPROUVÉ »." : " en espèces."}
            </span>
          </label>
        </div>
      )}
    </ConfirmDialog>
  );
}
