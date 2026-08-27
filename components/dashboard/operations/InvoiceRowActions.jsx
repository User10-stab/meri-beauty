"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Mail, Send, Eye, Loader2 } from "lucide-react";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";

const BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The per-row action strip: see the transaction, download the invoice, e-mail
 * it, and hand it to Billit.
 *
 * Every action is disabled rather than hidden when there is no invoice — a
 * payment can legitimately have none yet (a deposit taken before settlement),
 * and a row whose buttons simply vanish reads as a rendering bug. The title
 * says why instead.
 *
 * @param {{ invoice: {id: string, number: string, billitSentAt?: string|Date|null}|null, onOpenDetail?: () => void }} props
 */
export function InvoiceRowActions({ invoice, onOpenDetail }) {
  const [sending, setSending] = useState(false);
  const [sendingBillit, setSendingBillit] = useState(false);

  const noInvoiceReason = invoice ? null : "Aucune facture émise pour ce paiement";

  async function handleSendEmail() {
    if (!invoice || sending) return;
    setSending(true);
    const result = await sendInvoiceByEmail(invoice.id);
    setSending(false);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  async function handleSendBillit() {
    if (!invoice || sendingBillit) return;
    setSendingBillit(true);
    const result = await sendInvoiceToBillit(invoice.id);
    setSendingBillit(false);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {onOpenDetail && (
        <button type="button" onClick={onOpenDetail} className={BUTTON} title="Voir le détail de la transaction" aria-label="Voir le détail de la transaction">
          <Eye size={15} />
        </button>
      )}

      {invoice ? (
        <a
          href={`/api/invoices/${invoice.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={BUTTON}
          title={`Télécharger la facture ${invoice.number}`}
          aria-label={`Télécharger la facture ${invoice.number}`}
        >
          <Download size={15} />
        </a>
      ) : (
        <span className={BUTTON} title={noInvoiceReason} aria-disabled="true">
          <Download size={15} />
        </span>
      )}

      <button
        type="button"
        onClick={handleSendEmail}
        disabled={!invoice || sending}
        className={BUTTON}
        title={noInvoiceReason ?? `Envoyer la facture ${invoice.number} par e-mail au client`}
        aria-label="Envoyer la facture par e-mail"
      >
        {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
      </button>

      <button
        type="button"
        onClick={handleSendBillit}
        disabled={!invoice || sendingBillit}
        className={BUTTON}
        title={
          noInvoiceReason ??
          (invoice.billitSentAt
            ? `Déjà envoyée à Billit le ${new Date(invoice.billitSentAt).toLocaleDateString("fr-BE")} — cliquer pour renvoyer`
            : `Envoyer la facture ${invoice.number} vers Billit (Peppol)`)
        }
        aria-label="Envoyer via Billit"
      >
        {sendingBillit ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
      </button>
    </div>
  );
}
