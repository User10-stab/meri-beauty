"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Send, Eye, Loader2, FilePlus2 } from "lucide-react";
import { sendInvoiceByEmail } from "@/actions/invoices/send-invoice-email";
import { sendInvoiceToBillit } from "@/actions/invoices/send-invoice-billit";
import { sendCreditNoteByEmail } from "@/actions/invoices/send-credit-note-email";
import { sendCreditNoteToBillit } from "@/actions/invoices/send-credit-note-billit";
import { isBelgianVatNumber } from "@/lib/billit";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog";

// One labelled button per decision, not a strip of unlabelled 32px icons.
// The documents themselves live in the Détail box; the sends live behind
// Envoyer; Rembourser is the only destructive one and the only red one.
const BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40";

const RED_BUTTON = `${BUTTON} border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700`;

// Inside the Envoyer box: one full-width button per delivery channel.
const SEND_BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-lg border border-transparent bg-[#2f3a2e] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3d4e3b] disabled:cursor-not-allowed disabled:opacity-40";
const BILLIT_BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

/**
 * One credit note's own action strip: e-mail and Billit — same two delivery
 * channels the invoice above it gets, rendered inside the Envoyer box.
 * Downloading it lives in the Détail box instead — this strip only sends.
 * Billit eligibility is read off the row's `invoice` since CreditNote
 * carries no customer snapshot of its own.
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
    <div className="rounded-lg border border-red-100 bg-red-50/30 p-4">
      <p className="mb-3 text-[13px] font-semibold text-red-700">
        Note de crédit {note.number} <span className="font-normal text-red-600">({money(-note.totalInclVat)})</span>
      </p>

      <div className="space-y-3">
        <div>
          <p className={`mb-1.5 text-[12px] font-medium ${note.emailSentAt ? "text-emerald-700" : "text-amber-700"}`}>
            {note.emailSentAt
              ? `NC ${note.number} · e-mail envoyé le ${new Date(note.emailSentAt).toLocaleDateString("fr-BE")}`
              : `NC ${note.number} · non envoyée par e-mail`}
          </p>
          <button
            type="button"
            onClick={handleSendEmail}
            disabled={sending}
            className={SEND_BUTTON}
            title={`Envoyer la note de crédit ${note.number} par e-mail au client`}
            aria-label="Envoyer la note de crédit par e-mail"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            Envoyer par e-mail
          </button>
        </div>

        <div>
          <p className={`mb-1.5 text-[12px] font-medium ${note.billitSentAt ? "text-blue-700" : "text-amber-700"}`}>
            {note.billitSentAt ? `NC ${note.number} · créée dans Billit — à finaliser` : `NC ${note.number} · non envoyée via Billit`}
          </p>
          <button
            type="button"
            onClick={() => setConfirmingBillit(true)}
            disabled={Boolean(billitBlockedReason) || sendingBillit}
            className={BILLIT_BUTTON}
            title={
              billitBlockedReason ??
              (note.billitSentAt
                ? `Déjà envoyée à Billit le ${new Date(note.billitSentAt).toLocaleDateString("fr-BE")} — cliquer pour renvoyer`
                : `Envoyer la note de crédit ${note.number} vers Billit (Peppol)`)
            }
            aria-label="Envoyer la note de crédit via Billit"
          >
            {sendingBillit ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            Envoyer via Billit (Peppol)
          </button>
          {billitBlockedReason && <p className="mt-1.5 text-[12px] text-amber-700">{billitBlockedReason}</p>}
        </div>
      </div>

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
    </div>
  );
}

/**
 * Shell only — the invoice card and every CreditNoteActions strip are
 * passed in as children from InvoiceRowActions, which is what keeps every
 * pinned string (aria-labels, disabled expressions, the CreditNoteActions
 * call site) inside this one file's own contract-tested source.
 *
 * Reuses the non-portal modal shell CancelAndRefundDialog already proved
 * works from inside AdminOperationsClient's `overflow-x-auto` table wrapper.
 */
function SendDocumentsDialog({ open, invoiceNumber, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-documents-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#2f3a2e]/10">
            <Send className="text-[#2f3a2e]" size={20} />
          </div>
          <div>
            <h2 id="send-documents-title" className="text-base font-semibold text-gray-900">
              Envoyer les documents
            </h2>
            <p className="mt-1 text-[13px] text-gray-500">
              Facture {invoiceNumber} et ses notes de crédit. Chaque envoi est indépendant : l&apos;e-mail atteint
              directement le client, Billit dépose le document sur le réseau Peppol.
            </p>
          </div>
        </div>

        <div className="space-y-5">{children}</div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The per-row action strip: see the transaction, send its documents, and —
 * where applicable — cancel and refund it.
 *
 * @param {{ invoice: {id: string, number: string, billitSentAt?: string|Date|null, customerType?: string, customerVatNumber?: string|null}|null, creditNote?: {id: string, number: string, totalInclVat: number}|null, creditNotes?: Array<{id: string, number: string, totalInclVat: number}>|null, transaction?: {id: string, transactionType: string, hasInvoice: boolean}, orderId?: string|null, paymentId?: string|null, remainingRefundable?: number|null, onOpenDetail?: () => void }} props
 */
export function InvoiceRowActions({ invoice, creditNote = null, creditNotes = null, transaction = null, orderId = null, paymentId = null, remainingRefundable = null, onOpenDetail }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [sendingBillit, setSendingBillit] = useState(false);
  const [confirmingBillit, setConfirmingBillit] = useState(false);
  const [cancelRefundOpen, setCancelRefundOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  // Operations treats the invoice as the document boundary. The overview's
  // canonical row receives all existing notes for that invoice, while the
  // legacy singular prop remains supported for other callers.
  const notes = creditNotes ?? (creditNote ? [creditNote] : []);
  const creditNotesTotal = notes.reduce((sum, note) => sum + Number(note.totalInclVat ?? 0), 0);
  const invoiceFullyCredited = Boolean(invoice) && creditNotesTotal + 0.01 >= Number(invoice.totalInclVat ?? 0);

  // The action is keyed on the PAYMENT, not on the invoice — that is the
  // change of meaning. It is no longer "produce a document for this
  // invoice" (which a B2C sale with no invoice could never do, and which
  // left nine payments in the dev database credited but never refunded);
  // it is "unwind this sale", which every payment can be the subject of.
  //
  // A REFUND is evidence that money already moved; it must expose only its
  // document/detail actions, never offer a second cancellation/refund. A
  // visible DEPOSIT is a payment with no balance row yet, so it remains a
  // valid entry point for a deposit-only booking.
  const canCancelAndRefund =
    Boolean(paymentId) &&
    ["DEPOSIT", "FINAL_PAYMENT"].includes(transaction?.transactionType) &&
    !invoiceFullyCredited &&
    Number(remainingRefundable) > 0.01;

  const noInvoiceReason = invoice ? null : "Aucune facture émise pour ce paiement";

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
    <div className="flex items-center justify-end gap-2">
      {onOpenDetail && (
        <button
          type="button"
          onClick={onOpenDetail}
          className={BUTTON}
          title="Voir le détail, la facture, le ticket et les notes de crédit"
          aria-label="Voir le détail de la transaction"
        >
          <Eye size={15} /> Détail
        </button>
      )}

      <button
        type="button"
        onClick={() => setSendOpen(true)}
        disabled={!invoice}
        className={BUTTON}
        title={noInvoiceReason ?? `Envoyer la facture ${invoice.number} et ses notes de crédit`}
        aria-label="Envoyer les documents au client"
      >
        <Send size={15} /> Envoyer
      </button>

      {/* Annuler et rembourser. Never a document on its own: the dialog
          states every consequence — cancellation, credit, released seats or
          restored stock, the Stripe part, the part to hand over in person —
          before anything is committed. */}
      {canCancelAndRefund && (
        <button
          type="button"
          onClick={() => setCancelRefundOpen(true)}
          className={RED_BUTTON}
          title={`Annuler et rembourser ${Number(remainingRefundable).toLocaleString("fr-BE", { style: "currency", currency: "EUR" })}`}
          aria-label={`Annuler et rembourser ${Number(remainingRefundable).toLocaleString("fr-BE", { style: "currency", currency: "EUR" })}`}
        >
          <FilePlus2 size={15} /> Rembourser
        </button>
      )}

      <SendDocumentsDialog open={sendOpen && Boolean(invoice)} invoiceNumber={invoice?.number} onClose={() => setSendOpen(false)}>
        {invoice && (
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="mb-3 text-[13px] font-semibold text-gray-900">Facture {invoice.number}</p>

            <div className="space-y-3">
              <div>
                <p className={`mb-1.5 text-[12px] font-medium ${invoice.emailSentAt ? "text-emerald-700" : "text-amber-700"}`}>
                  {invoice.emailSentAt
                    ? `Envoyée par e-mail le ${new Date(invoice.emailSentAt).toLocaleDateString("fr-BE")}`
                    : "Jamais envoyée par e-mail"}
                </p>
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={!invoice || sending}
                  className={SEND_BUTTON}
                  title={noInvoiceReason ?? `Envoyer la facture ${invoice.number} par e-mail au client`}
                  aria-label="Envoyer la facture par e-mail"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                  Envoyer par e-mail
                </button>
              </div>

              <div>
                <p className={`mb-1.5 text-[12px] font-medium ${invoice.billitSentAt ? "text-blue-700" : "text-amber-700"}`}>
                  {invoice.billitSentAt
                    ? `Déposée dans Billit le ${new Date(invoice.billitSentAt).toLocaleDateString("fr-BE")} — à finaliser`
                    : "Jamais transmise via Billit"}
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmingBillit(true)}
                  disabled={!invoice || Boolean(billitBlockedReason) || sendingBillit}
                  className={BILLIT_BUTTON}
                  title={
                    noInvoiceReason ??
                    billitBlockedReason ??
                    (invoice.billitSentAt
                      ? `Déjà envoyée à Billit le ${new Date(invoice.billitSentAt).toLocaleDateString("fr-BE")} — cliquer pour renvoyer`
                      : `Envoyer la facture ${invoice.number} vers Billit (Peppol)`)
                  }
                  aria-label="Envoyer via Billit"
                >
                  {sendingBillit ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Envoyer via Billit (Peppol)
                </button>
                {billitBlockedReason && <p className="mt-1.5 text-[12px] text-amber-700">{billitBlockedReason}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Every historical note against the final invoice stays reachable.
            New manual corrections create only one; older invoices may still
            carry several legally numbered partial notes and must not hide them. */}
        {notes.map((note) => (
          <CreditNoteActions key={note.id} note={note} invoice={invoice} />
        ))}
      </SendDocumentsDialog>

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
