"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Mail, Send, Eye, Loader2, FileMinus, FilePlus2, Receipt } from "lucide-react";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";
import { sendCreditNoteByEmail } from "@/actions/invoices/send-credit-note-email";
import { sendCreditNoteToBillit } from "@/actions/invoices/send-credit-note-billit";
import { isBelgianVatNumber } from "@/lib/billit";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog";

const BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40";

const RED_BUTTON = `${BUTTON} border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700`;

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

/**
 * One credit note's own action strip: download, e-mail, Billit — same three
 * actions the invoice above it gets. E-mail and Billit are independent
 * delivery choices; Billit eligibility is read off the row's `invoice`
 * since CreditNote carries no customer snapshot of its own.
 */
function CreditNoteActions({ note, invoice }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sendingBillit, setSendingBillit] = useState(false);
  const [confirmingBillit, setConfirmingBillit] = useState(false);

  const isBelgianB2B = Boolean(invoice) && invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber);
  const billitBlockedReason = isBelgianB2B
    ? null
    : invoice?.customerType !== "B2B"
    ? "Facture B2C — Billit est réservé aux clients B2B."
    : "Client sans numéro de TVA belge (BE…) — envoi Billit indisponible.";

  async function handleSendEmail() {
    if (sending) return;
    setSending(true);
    const result = await sendCreditNoteByEmail(note.id);
    setSending(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    }
    else toast.error(result.message);
  }

  async function handleSendBillit() {
    if (sendingBillit) return;
    setSendingBillit(true);
    const result = await sendCreditNoteToBillit(note.id);
    setSendingBillit(false);
    setConfirmingBillit(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    }
    else toast.error(result.message);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1.5">
        <a
          href={`/api/credit-notes/${note.id}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className={RED_BUTTON}
          title={`Télécharger la note de crédit ${note.number} (${money(-note.totalInclVat)})`}
          aria-label={`Télécharger la note de crédit ${note.number}`}
        >
          <FileMinus size={15} />
        </a>

        <button
          type="button"
          onClick={handleSendEmail}
          disabled={sending}
          className={RED_BUTTON}
          title={`Envoyer la note de crédit ${note.number} par e-mail au client`}
          aria-label="Envoyer la note de crédit par e-mail"
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
        </button>

        <button
          type="button"
          onClick={() => setConfirmingBillit(true)}
          disabled={Boolean(billitBlockedReason) || sendingBillit}
          className={RED_BUTTON}
          title={
            billitBlockedReason ??
            (note.billitSentAt
              ? `Déjà envoyée à Billit le ${new Date(note.billitSentAt).toLocaleDateString("fr-BE")} — cliquer pour renvoyer`
              : `Envoyer la note de crédit ${note.number} vers Billit (Peppol)`)
          }
          aria-label="Envoyer la note de crédit via Billit"
        >
          {sendingBillit ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </span>

      <span className={`text-[11px] ${note.emailSentAt ? "text-emerald-700" : note.billitSentAt ? "text-blue-700" : "text-amber-700"}`}>
        {note.emailSentAt
          ? `NC ${note.number} · e-mail envoyé le ${new Date(note.emailSentAt).toLocaleDateString("fr-BE")}`
          : note.billitSentAt
          ? `NC ${note.number} · créée dans Billit — à finaliser`
          : `NC ${note.number} · non envoyée`}
      </span>

      <ConfirmDialog
        open={confirmingBillit}
        title={`Envoyer la note de crédit ${note.number} vers Billit ?`}
        message={`Vérifiez ces informations avant l'envoi Peppol — une fois transmise, elle ne peut plus être rappelée. Client : ${invoice?.customerName ?? "—"} · TVA : ${invoice?.customerVatNumber ?? "—"}.`}
        confirmLabel="Vérifié, envoyer"
        cancelLabel="Annuler"
        loading={sendingBillit}
        onConfirm={handleSendBillit}
        onCancel={() => setConfirmingBillit(false)}
      />
    </span>
  );
}

/**
 * The per-row action strip: see the transaction, download the invoice, e-mail
 * it, and hand it to Billit.
 *
 * Every action is disabled rather than hidden when there is no invoice — a
 * payment can legitimately have none yet (a deposit taken before settlement),
 * and a row whose buttons simply vanish reads as a rendering bug. The title
 * says why instead.
 *
 * @param {{ invoice: {id: string, number: string, billitSentAt?: string|Date|null, customerType?: string, customerVatNumber?: string|null}|null, creditNote?: {id: string, number: string, totalInclVat: number}|null, creditNotes?: Array<{id: string, number: string, totalInclVat: number}>|null, transaction?: {id: string, transactionType: string, hasInvoice: boolean}, orderId?: string|null, paymentId?: string|null, onOpenDetail?: () => void }} props
 */
export function InvoiceRowActions({ invoice, creditNote = null, creditNotes = null, transaction = null, orderId = null, paymentId = null, onOpenDetail }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sendingBillit, setSendingBillit] = useState(false);
  const [confirmingBillit, setConfirmingBillit] = useState(false);
  const [cancelRefundOpen, setCancelRefundOpen] = useState(false);

  // Operations treats the invoice as the document boundary. The overview's
  // canonical row receives all existing notes for that invoice, while the
  // legacy singular prop remains supported for other callers.
  const notes = creditNotes ?? (creditNote ? [creditNote] : []);

  // The action is keyed on the PAYMENT, not on the invoice — that is the
  // change of meaning. It is no longer "produce a document for this
  // invoice" (which a B2C sale with no invoice could never do, and which
  // left nine payments in the dev database credited but never refunded);
  // it is "unwind this sale", which every payment can be the subject of.
  //
  // Still hidden on a deposit row: once a balance exists, the FINAL_PAYMENT
  // row is the single entry point for the whole payment, and offering the
  // same operation twice on one payment invites exactly the double-click
  // the partial unique index exists to catch.
  const canCancelAndRefund = Boolean(paymentId) && transaction?.transactionType !== "DEPOSIT";

  const noInvoiceReason = invoice ? null : "Aucune facture émise pour ce paiement";

  const isBelgianB2B = Boolean(invoice) && invoice.customerType === "B2B" && isBelgianVatNumber(invoice.customerVatNumber);

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
    if (!invoice || sending) return;
    setSending(true);
    const result = await sendInvoiceByEmail(invoice.id);
    setSending(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    }
    else toast.error(result.message);
  }

  async function handleSendBillit() {
    if (!invoice || sendingBillit) return;
    setSendingBillit(true);
    const result = await sendInvoiceToBillit(invoice.id);
    setSendingBillit(false);
    setConfirmingBillit(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    }
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

      {/* The reçu/ticket sent to the customer — re-rendered on demand rather
          than stored. A boutique Order keeps its own route (real line
          items, works even with no Invoice yet — a B2C till sale). Every
          other payment kind (rendez-vous/atelier/événement/formation) is
          keyed on the Payment itself, not the Invoice — a particulier never
          gets an Invoice at all (see hasInvoiceableVatIdentity), and that
          must never mean "no ticket either". See app/api/payments/[id]/ticket. */}
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
      ) : paymentId ? (
        <a
          href={`/api/payments/${paymentId}/ticket`}
          target="_blank"
          rel="noopener noreferrer"
          className={BUTTON}
          title="Télécharger le ticket de caisse"
          aria-label="Télécharger le ticket de caisse"
        >
          <Receipt size={15} />
        </a>
      ) : (
        <span className={BUTTON} title="Aucun ticket disponible pour ce paiement" aria-disabled="true">
          <Receipt size={15} />
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

      {/* Every historical note against the final invoice stays reachable.
          New manual corrections create only one; older invoices may still
          carry several legally numbered partial notes and must not hide them. */}
      {notes.map((note) => (
        <CreditNoteActions key={note.id} note={note} invoice={invoice} />
      ))}

      {/* Annuler et rembourser. Never a document on its own: the dialog
          states every consequence — cancellation, credit, released seats or
          restored stock, the Stripe part, the part to hand over in person —
          before anything is committed. */}
      {canCancelAndRefund && (
        <button
          type="button"
          onClick={() => setCancelRefundOpen(true)}
          className={`${BUTTON} border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700`}
          title="Annuler et générer la note de crédit"
          aria-label="Annuler et générer la note de crédit"
        >
          <FilePlus2 size={15} />
        </button>
      )}

      {canCancelAndRefund && (
        <CancelAndRefundDialog
          open={cancelRefundOpen}
          paymentId={paymentId}
          onClose={() => setCancelRefundOpen(false)}
        />
      )}
    </div>
  );
}
