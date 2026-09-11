"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cancelAndRefund, previewCancelAndRefund } from "@/actions/dashboard/cancel-and-refund";

/**
 * "Générer note de crédit" — the one action that unblocks a COMPLETED or
 * shipped transaction. Deliberately just a thin, trigger-locked wrapper
 * around the same previewCancelAndRefund/cancelAndRefund actions "Annuler et
 * rembourser" already uses: no partial amount, no reissue math, no second
 * mode — it credits the whole remaining amount and cancels the item, exactly
 * like that flow does for anything not yet completed. The only difference is
 * the trigger (POST_COMPLETION_CORRECTION), which is the one
 * lib/refunds/authorize.js lets through the COMPLETED/shipped guards.
 *
 * On success the caller (TransactionDetailDrawer) is handed back to open the
 * same delivery card already used for invoices, so the resulting credit note
 * can go out by e-mail, Peppyrus, or both in one motion.
 */

const TRIGGER = "POST_COMPLETION_CORRECTION";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const METHOD_LABEL = Object.freeze({
  CASH: "espèces",
  CARD: "carte — terminal en boutique",
  ONLINE: "carte en ligne",
});

function Row({ label, value, tone = "default" }) {
  const toneClass =
    tone === "danger" ? "text-red-700"
    : tone === "warn" ? "text-amber-700"
    : tone === "ok" ? "text-emerald-700"
    : "text-gray-900";
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={`text-[13px] font-semibold text-right ${toneClass}`}>{value}</span>
    </div>
  );
}

export function GenerateCreditNoteDialog({ open, paymentId, onClose, onGenerated }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await previewCancelAndRefund({ paymentId, trigger: TRIGGER, reason });
    setLoading(false);
    if (result.success) setPreview(result.data);
    else {
      setPreview(null);
      toast.error(result.message);
    }
  }, [paymentId, reason]);

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId]);

  useEffect(() => {
    if (!open) {
      setReason("");
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const reasonTooShort = reason.trim().length < 10;
  const blocked = Boolean(preview?.blockedReason);
  const canConfirm = Boolean(preview) && !blocked && !reasonTooShort && !submitting && !loading;

  async function handleConfirm() {
    if (!canConfirm) return;
    setSubmitting(true);
    const result = await cancelAndRefund({ paymentId, trigger: TRIGGER, reason: reason.trim() });
    setSubmitting(false);
    if (result.success) {
      toast.success(result.message);
      onClose();
      onGenerated?.(result.data);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="generate-credit-note-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="text-amber-700" size={20} />
          </div>
          <div>
            <h2 id="generate-credit-note-title" className="text-base font-semibold text-gray-900">
              Générer une note de crédit
            </h2>
            <p className="mt-1 text-[13px] text-gray-500">
              Pour une prestation ou commande déjà terminée/expédiée dont le prix ou la facture était erroné.
              Crédite le montant intégral et annule l&apos;élément — vous pourrez ensuite l&apos;envoyer par
              e-mail, Peppyrus, ou les deux.
            </p>
          </div>
        </div>

        {loading && !preview ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={16} /> Calcul des conséquences…
          </div>
        ) : preview ? (
          <>
            <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-200 px-3 py-1">
              <Row label="Élément concerné" value={preview.itemLabel} />
              <Row label="Statut actuel" value={preview.currentStatus ?? "—"} />
              <Row label="Statut après opération" value="Annulé" tone="danger" />
              <Row label="Total encaissé" value={money(preview.totalCollected)} />
              <Row label="Montant total crédité" value={money(preview.creditedTotal)} tone="danger" />
              <Row
                label="Document"
                value={
                  preview.documentKind === "CREDIT_NOTE"
                    ? `note de crédit (facture ${preview.invoiceNumber})`
                    : "aucun document financier (client B2C sans facture)"
                }
              />
              {preview.releasedSeats > 0 && <Row label="Places libérées" value={`${preview.releasedSeats}`} tone="ok" />}
              {preview.restoredStockLines > 0 && (
                <Row label="Lignes remises en stock" value={`${preview.restoredStockLines}`} tone="ok" />
              )}
              <Row
                label="À rembourser dans Stripe (manuellement)"
                value={preview.automaticTotal > 0 ? money(preview.automaticTotal) : "aucun"}
                tone={preview.automaticTotal > 0 ? "warn" : "default"}
              />
              <Row
                label="À rendre en main propre"
                value={
                  preview.manualTotal > 0
                    ? preview.manualLegs.map((leg) => `${money(leg.amount)} en ${METHOD_LABEL[leg.method] ?? leg.method}`).join(" · ")
                    : "aucun"
                }
                tone={preview.manualTotal > 0 ? "warn" : "default"}
              />
            </div>

            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <strong>Cette action ne rembourse rien.</strong> Elle annule l&apos;élément et prépare la note de
              crédit. Le remboursement reste à effectuer : dans Stripe pour la partie en ligne, en main propre
              pour le reste — il apparaîtra sur le tableau des remboursements tant qu&apos;il n&apos;est pas fait.
            </p>

            <label className="mb-1.5 block text-[13px] font-medium text-gray-700" htmlFor="credit-note-reason">
              Motif (obligatoire)
            </label>
            <textarea
              id="credit-note-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Expliquez l'erreur constatée — au moins 10 caractères."
              className="mb-1 w-full rounded-lg border border-gray-300 p-2 text-[13px] focus:border-gray-900 focus:outline-none"
            />
            <p className={`mb-4 text-[12px] ${reasonTooShort ? "text-amber-700" : "text-gray-400"}`}>
              {reasonTooShort ? `Encore ${10 - reason.trim().length} caractère(s).` : "Motif enregistré dans l'audit."}
            </p>

            {blocked && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                {preview.blockedReason}
              </p>
            )}
          </>
        ) : (
          <p className="py-6 text-sm text-gray-500">Impossible de calculer les conséquences.</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-300 px-4 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            Générer la note de crédit
          </button>
        </div>
      </div>
    </div>
  );
}
