"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileMinus, FileText, Mail, Receipt, X } from "lucide-react";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";

/**
 * The reservation views do not have a transaction drawer. Keep their ticket
 * and accounting documents available behind one calm, explicit entry point.
 */
export function OperationDocumentsDialog({ open, onClose, invoice, creditNotes = [], paymentId, onDelivered }) {
  const closeRef = useRef(null);
  const [deliveryDocument, setDeliveryDocument] = useState(null);

  useEffect(() => {
    if (!open) {
      setDeliveryDocument(null);
      return;
    }
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const hasDocuments = Boolean(invoice) || creditNotes.length > 0 || Boolean(paymentId);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="operation-documents-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#52664e]">Opération</p>
            <h2 id="operation-documents-title" className="mt-1 text-lg font-semibold text-gray-900">Documents</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">Consultez un document ou choisissez son mode de livraison.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer" className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>

        {hasDocuments ? (
          <div className="mt-5 space-y-3">
            {invoice && (
              <div className="rounded-xl border border-gray-200 p-4">
                <p className="font-semibold text-gray-900">Facture {invoice.number}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                    <FileText size={14} /> Ouvrir le PDF
                  </a>
                  {invoice.customerType === "B2B" && (
                    <button type="button" onClick={() => setDeliveryDocument({ kind: "INVOICE", document: invoice })} className="inline-flex items-center gap-1.5 rounded-lg border border-[#2f3a2e] px-3 py-2 text-xs font-semibold text-[#2f3a2e] hover:bg-[#f4f7f3]">
                      <Mail size={14} /> Envoyer la facture
                    </button>
                  )}
                </div>
              </div>
            )}

            {creditNotes.map((note) => (
              <div key={note.id} className="rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                <p className="font-semibold text-violet-950">Note de crédit {note.number}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href={`/api/credit-notes/${note.id}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-100">
                    <FileMinus size={14} /> Ouvrir le PDF
                  </a>
                  {invoice?.customerType === "B2B" && (
                    <button type="button" onClick={() => setDeliveryDocument({ kind: "CREDIT_NOTE", document: note })} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-100">
                      <Mail size={14} /> Envoyer la note
                    </button>
                  )}
                </div>
              </div>
            ))}

            {paymentId && (
              <a href={`/api/payments/${paymentId}/ticket`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <Receipt size={18} className="text-[#2f3a2e]" /> Ouvrir le ticket de caisse
              </a>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">Aucun document n'est disponible pour cette opération.</p>
        )}
      </section>
      <DocumentDeliveryDialog
        open={Boolean(deliveryDocument)}
        onClose={() => setDeliveryDocument(null)}
        document={deliveryDocument?.document ?? null}
        invoice={invoice}
        kind={deliveryDocument?.kind ?? "INVOICE"}
        onDelivered={onDelivered}
      />
    </div>,
    document.body,
  );
}
