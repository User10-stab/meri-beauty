"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Mail, Send, Eye, Loader2, FileMinus, FilePlus2, Receipt } from "lucide-react";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";
import { issueCreditNoteForTransaction } from "@/actions/dashboard/admin-operations";
import { isBelgianVatNumber } from "@/lib/billit";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

/**
 * The per-row action strip: see the transaction, download the invoice, e-mail
 * it, and hand it to Billit.
 *
 * Every action is disabled rather than hidden when there is no invoice — a
 * payment can legitimately have none yet (a deposit taken before settlement),
 * and a row whose buttons simply vanish reads as a rendering bug. The title
 * says why instead.
 *
 * @param {{ invoice: {id: string, number: string, billitSentAt?: string|Date|null, customerType?: string, customerVatNumber?: string|null}|null, creditNote?: {id: string, number: string, totalInclVat: number}|null, transaction?: {id: string, transactionType: string, hasInvoice: boolean}, orderId?: string|null, onOpenDetail?: () => void }} props
 */
export function InvoiceRowActions({ invoice, creditNote = null, transaction = null, orderId = null, onOpenDetail }) {
  const [sending, setSending] = useState(false);
  const [sendingBillit, setSendingBillit] = useState(false);
  const [confirmingBillit, setConfirmingBillit] = useState(false);
  const [generatingNote, setGeneratingNote] = useState(false);
  const [confirmingNote, setConfirmingNote] = useState(false);

  // A credit note only ever corrects an invoice, so any transaction row that
  // already carries one is eligible — a refund, but also a deposit or final
  // payment staff need to correct by hand (a price adjustment, a partial
  // discount granted after the fact). One row, one credit note: once it has
  // one, the button gives way to the download link above.
  const canGenerateNote = Boolean(transaction) && transaction.hasInvoice && !creditNote;

  async function handleGenerateCreditNote() {
    if (!transaction || generatingNote) return;
    setGeneratingNote(true);
    const result = await issueCreditNoteForTransaction(transaction.id);
    setGeneratingNote(false);
    setConfirmingNote(false);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  const noInvoiceReason = invoice ? null : "Aucune facture émise pour ce paiement";

  // A Belgian company invoice must travel over Peppol, never as an ad-hoc
  // PDF e-mail (Belgium's 2026 structured e-invoicing mandate) — mirrors the
  // hard server-side refusal in actions/invoices/send-invoice-email.js so
  // the button reads as blocked rather than merely failing after the click.
  const isBelgianB2B = Boolean(invoice) && invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber);
  const emailBlockedReason = isBelgianB2B ? "Facture B2B belge — l'envoi doit passer par Billit/Peppol, pas par e-mail direct." : null;

  // Mirrors the server-side guard in actions/invoices/send-invoice-billit.js
  // — Billit here is Peppol e-invoicing for Belgian companies only, so a
  // B2C sale or a foreign VAT number is refused rather than left to fail
  // after the click.
  const billitBlockedReason = !invoice
    ? null
    : invoice.customerType !== "B2B"
    ? "Facture B2C — Billit est réservé aux clients B2B."
    : !isBelgianVatNumber(invoice.customerVatNumber)
    ? "Client sans numéro de TVA belge (BE…) — envoi Billit indisponible."
    : null;

  async function handleSendEmail() {
    if (!invoice || sending || emailBlockedReason) return;
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
    setConfirmingBillit(false);
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

      {/* The reçu/ticket sent to the customer at the till — re-renders on
          demand from the order (see app/api/orders/[id]/ticket), so this
          works even when the sale never got an Invoice at all (a B2C
          till sale, or one still pending its Peppol facture). Only a
          boutique Order has this document; an appointment/atelier/formation
          payment has none, so this stays disabled rather than hidden. */}
      {orderId ? (
        <a
          href={`/api/orders/${orderId}/ticket`}
          target="_blank"
          rel="noopener noreferrer"
          className={BUTTON}
          title="Télécharger le reçu / ticket de caisse déjà envoyé au client"
          aria-label="Télécharger le reçu / ticket de caisse"
        >
          <Receipt size={15} />
        </a>
      ) : (
        <span className={BUTTON} title="Pas de ticket — ce paiement n'est pas une commande boutique" aria-disabled="true">
          <Receipt size={15} />
        </span>
      )}

      <button
        type="button"
        onClick={handleSendEmail}
        disabled={!invoice || sending || Boolean(emailBlockedReason)}
        className={BUTTON}
        title={noInvoiceReason ?? emailBlockedReason ?? `Envoyer la facture ${invoice.number} par e-mail au client`}
        aria-label="Envoyer la facture par e-mail"
      >
        {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
      </button>

      <button
        type="button"
        onClick={() => setConfirmingBillit(true)}
        disabled={!invoice || Boolean(billitBlockedReason) || sendingBillit}
        className={BUTTON}
        title={
          noInvoiceReason ??
          billitBlockedReason ??
          (invoice.billitSentAt
            ? `Déjà envoyée à Billit le ${new Date(invoice.billitSentAt).toLocaleDateString("fr-BE")} — cliquer pour renvoyer`
            : `Envoyer la facture ${invoice.number} vers Billit (Peppol)`)
        }
        aria-label="Envoyer via Billit"
      >
        {sendingBillit ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
      </button>

      {invoice && (
        <ConfirmDialog
          open={confirmingBillit}
          title={`Envoyer la facture ${invoice.number} vers Billit ?`}
          message={`Vérifiez ces informations avant l'envoi Peppol — une fois transmise, elle ne peut plus être rappelée. Client : ${invoice.customerName ?? "—"} · TVA : ${invoice.customerVatNumber ?? "—"}.`}
          confirmLabel="Vérifié, envoyer"
          cancelLabel="Annuler"
          loading={sendingBillit}
          onConfirm={handleSendBillit}
          onCancel={() => setConfirmingBillit(false)}
        />
      )}

      {/* This row's own credit note — the one that funds this specific
          refund, not just any note issued against the invoice at some
          point. A refund row is otherwise a dead end: staff could see money
          left but never open the document that justifies it. */}
      {creditNote && (
        <a
          href={`/api/credit-notes/${creditNote.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${BUTTON} border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700`}
          title={`Télécharger la note de crédit ${creditNote.number} (${money(-creditNote.totalInclVat)})`}
          aria-label={`Télécharger la note de crédit ${creditNote.number}`}
        >
          <FileMinus size={15} />
        </a>
      )}

      {/* Covers both a refund that never got one automatically (done by hand
          from the Stripe Dashboard, or recorded before this link existed) and
          a manual correction on any other invoiced transaction. */}
      {canGenerateNote && (
        <button
          type="button"
          onClick={() => setConfirmingNote(true)}
          disabled={generatingNote}
          className={`${BUTTON} border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700`}
          title="Générer une note de crédit pour cette transaction"
          aria-label="Générer une note de crédit"
        >
          {generatingNote ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />}
        </button>
      )}

      {canGenerateNote && (
        <ConfirmDialog
          open={confirmingNote}
          title="Générer une note de crédit ?"
          message="Ce document porte un numéro légal, séquentiel et définitif — une fois émis, il ne peut plus être annulé ni modifié."
          confirmLabel="Générer"
          cancelLabel="Annuler"
          loading={generatingNote}
          onConfirm={handleGenerateCreditNote}
          onCancel={() => setConfirmingNote(false)}
        />
      )}
    </div>
  );
}
