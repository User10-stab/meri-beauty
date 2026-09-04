"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Send, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";
import { sendCreditNoteByEmail } from "@/actions/invoices/send-credit-note-email";
import { sendCreditNoteToBillit } from "@/actions/invoices/send-credit-note-billit";
import { isBelgianVatNumber } from "@/lib/billit";

/**
 * The one explicit delivery choice used throughout Operations. Nothing is
 * sent from a compact table row: the administrator first sees this card and
 * deliberately chooses e-mail or the Belgian Billit/Peppol handoff.
 */
export function DocumentDeliveryDialog({ open, onClose, document: documentRecord, invoice, kind = "INVOICE", onDelivered }) {
  const closeRef = useRef(null);
  const [sending, setSending] = useState(false);
  const [confirmingBillit, setConfirmingBillit] = useState(false);

  const isCreditNote = kind === "CREDIT_NOTE";
  const label = isCreditNote ? "note de crédit" : "facture";
  const number = documentRecord?.number ?? "";
  const canUseBillit = invoice?.customerType === "B2B" && isBelgianVatNumber(invoice?.customerVatNumber);

  useEffect(() => {
    if (!open) {
      setConfirmingBillit(false);
      return;
    }
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open || !documentRecord || typeof documentRecord.id !== "string") return null;

  async function deliver(channel) {
    if (sending) return;
    setSending(true);
    const result = await (isCreditNote
        ? channel === "EMAIL"
        ? sendCreditNoteByEmail(documentRecord.id)
        : sendCreditNoteToBillit(documentRecord.id)
      : channel === "EMAIL"
        ? sendInvoiceByEmail(documentRecord.id)
        : sendInvoiceToBillit(documentRecord.id));
    setSending(false);
    setConfirmingBillit(false);
    if (result.success) {
      toast.success(result.message);
      onDelivered?.();
      onClose();
    } else toast.error(result.message);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && !sending && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Livraison B2B</p>
            <h2 id="delivery-title" className="mt-1 text-lg font-semibold text-gray-900">
              Envoyer la {label} {number}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Choisissez un seul mode de livraison. Aucun envoi ne démarre avant votre choix.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Fermer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={() => deliver("EMAIL")}
            disabled={sending}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-4 text-left transition-colors hover:border-[#2f3a2e] hover:bg-[#f4f7f3] disabled:opacity-50"
          >
            {sending ? <Loader2 size={19} className="animate-spin text-[#2f3a2e]" /> : <Mail size={19} className="text-[#2f3a2e]" />}
            <span>
              <span className="block font-semibold text-gray-900">Envoyer par e-mail</span>
              <span className="mt-0.5 block text-xs text-gray-500">Le document PDF est envoyé à l'adresse de facturation.</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmingBillit(true)}
            disabled={!canUseBillit || sending}
            title={canUseBillit ? "Créer dans Billit pour une livraison Peppol belge" : "Billit / Peppol est réservé aux clients B2B avec TVA belge."}
            className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-4 text-left transition-colors hover:border-[#2f3a2e] hover:bg-[#f4f7f3] disabled:opacity-50"
          >
            <Send size={19} className="text-[#2f3a2e]" />
            <span>
              <span className="block font-semibold text-gray-900">Créer dans Billit / Peppol</span>
              <span className="mt-0.5 block text-xs text-gray-500">
                Disponible uniquement pour une TVA belge; finalisez ensuite l'envoi Peppol dans Billit.
              </span>
            </span>
          </button>
        </div>

        {confirmingBillit && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">Créer dans Billit ?</p>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              Vérifiez le client et la TVA. L'envoi Peppol est ensuite finalisé manuellement dans Billit.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingBillit(false)}
                disabled={sending}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-amber-100 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => deliver("BILLIT")}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f3a2e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1f291f] disabled:opacity-50"
              >
                {sending && <Loader2 size={13} className="animate-spin" />} Créer dans Billit
              </button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
