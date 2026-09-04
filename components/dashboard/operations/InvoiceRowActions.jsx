"use client";

import { useState } from "react";
import { Eye, FilePlus2, FolderOpen } from "lucide-react";
import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog";
import { OperationDocumentsDialog } from "@/components/dashboard/operations/OperationDocumentsDialog";

/**
 * A table row is for scanning, not operating. Document delivery lives beside
 * its status and consequential work opens its own card; this component keeps
 * the final column to one contextual entry point.
 */
export function InvoiceRowActions({ invoice = null, creditNote = null, creditNotes = null, transaction = null, paymentId = null, remainingRefundable = null, onOpenDetail }) {
  const [cancelRefundOpen, setCancelRefundOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const notes = creditNotes ?? (creditNote ? [creditNote] : []);
  const creditNotesTotal = notes.reduce((sum, note) => sum + Number(note.totalInclVat ?? 0), 0);
  const invoiceFullyCredited = Boolean(invoice) && creditNotesTotal + 0.01 >= Number(invoice.totalInclVat ?? 0);
  const canCancelAndRefund =
    Boolean(paymentId) &&
    ["DEPOSIT", "FINAL_PAYMENT"].includes(transaction?.transactionType) &&
    !invoiceFullyCredited &&
    Number(remainingRefundable) > 0.01;

  const canManageDocuments = Boolean(invoice) || notes.length > 0 || Boolean(paymentId);

  if (!onOpenDetail && !canCancelAndRefund && !canManageDocuments) return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className="flex justify-end">
      {onOpenDetail ? (
        <button
          type="button"
          onClick={onOpenDetail}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-[#2f3a2e] hover:bg-[#f4f7f3] hover:text-[#2f3a2e]"
        >
          <Eye size={14} /> Voir / gérer
        </button>
      ) : canManageDocuments ? (
        <button
          type="button"
          onClick={() => setDocumentsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-[#2f3a2e] hover:bg-[#f4f7f3] hover:text-[#2f3a2e]"
        >
          <FolderOpen size={14} /> Gérer les documents
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setCancelRefundOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
        >
          <FilePlus2 size={14} /> Gérer l'annulation
        </button>
      )}

      {canCancelAndRefund && (
        <CancelAndRefundDialog
          open={cancelRefundOpen}
          paymentId={paymentId}
          onClose={() => setCancelRefundOpen(false)}
        />
      )}
      <OperationDocumentsDialog
        open={documentsOpen}
        onClose={() => setDocumentsOpen(false)}
        invoice={invoice}
        creditNotes={notes}
        paymentId={paymentId}
      />
    </div>
  );
}
