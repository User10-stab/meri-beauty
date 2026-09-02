"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cancelAndRefund, previewCancelAndRefund } from "@/actions/dashboard/cancel-and-refund";

/**
 * The confirmation step for "Annuler et générer la note de crédit".
 *
 * Its whole job is to state the consequences BEFORE the admin commits, in
 * the terms the handoff requires: what is affected, its current status, the
 * amount credited, the seats or stock released, what Stripe refunds
 * automatically, what has to be handed over physically, and the fact that
 * the customer hears nothing until the money has actually landed.
 *
 * It renders its own shell rather than reusing ConfirmDialog, which is
 * fixed at max-w-md — too narrow to lay this out without the figures
 * wrapping into an unreadable column, and figures that are hard to read are
 * figures an admin approves without reading.
 */

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const METHOD_LABEL = Object.freeze({
  CASH: "espèces",
  CARD: "carte — terminal en boutique",
  ONLINE: "carte en ligne",
});

const TRIGGERS = Object.freeze([
  {
    value: "SALON_CANCELLATION",
    label: "Annulation par le salon",
    hint: "Le salon annule de sa propre initiative. Aucune demande client n'est requise, mais le motif l'est.",
  },
  {
    value: "CUSTOMER_REQUEST_APPROVED",
    label: "Demande du client approuvée",
    hint: "Nécessite une demande écrite du client déjà approuvée par un OWNER ou un ADMIN.",
  },
  {
    value: "NO_SHOW_EXCEPTION",
    label: "Exception — absence (no-show)",
    hint: "Conserve le statut NO_SHOW et n'enregistre qu'une correction financière. Motif obligatoire, audit renforcé.",
  },
]);

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

export function CancelAndRefundDialog({ open, paymentId, onClose }) {
  const router = useRouter();
  const [trigger, setTrigger] = useState("SALON_CANCELLATION");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await previewCancelAndRefund({ paymentId, trigger, reason });
    setLoading(false);
    if (result.success) setPreview(result.data);
    else {
      setPreview(null);
      toast.error(result.message);
    }
  }, [paymentId, trigger, reason]);

  // Re-previews when the trigger changes, because the trigger decides
  // whether the item is cancelled at all (NO_SHOW keeps its status) and
  // therefore whether any seat is released. `reason` is deliberately NOT a
  // dependency: re-running a server action on every keystroke would be
  // wasteful, and its only effect on the preview is the empty-motive block,
  // which the local length check below already shows.
  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paymentId, trigger]);

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
    const result = await cancelAndRefund({ paymentId, trigger, reason: reason.trim() });
    setSubmitting(false);
    if (result.success) {
      toast.success(result.message);
      onClose();
      router.refresh();
    } else {
      toast.error(result.message);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-refund-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="text-red-600" size={20} />
          </div>
          <div>
            <h2 id="cancel-refund-title" className="text-base font-semibold text-gray-900">
              Annuler et générer la note de crédit
            </h2>
            <p className="mt-1 text-[13px] text-gray-500">
              Cette opération annule l&apos;élément, crédite la facture et rembourse le client. Elle est
              définitive.
            </p>
          </div>
        </div>

        {loading && !preview ? (
          <div className="flex items-center gap-2 py-8 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={16} /> Calcul des conséquences…
          </div>
        ) : preview ? (
          <>
            <fieldset className="mb-4">
              <legend className="mb-2 text-[13px] font-medium text-gray-700">Origine de la décision</legend>
              <div className="space-y-1.5">
                {TRIGGERS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-2.5 rounded-lg border p-2.5 ${
                      trigger === option.value ? "border-gray-900 bg-gray-50" : "border-gray-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="refund-trigger"
                      value={option.value}
                      checked={trigger === option.value}
                      onChange={() => setTrigger(option.value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[13px] font-medium text-gray-900">{option.label}</span>
                      <span className="block text-[12px] text-gray-500">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* The customer's own words, when the refund rests on their
                request. The handoff requires both this and the identity of
                the admin approving it to be visible at the moment of
                decision — not buried in a detail screen. */}
            {preview.customerRequest && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-[12px] font-medium text-blue-900">
                  Demande du client ({preview.customerRequest.status})
                  {preview.customerRequest.requestedBy ? ` — ${preview.customerRequest.requestedBy}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-blue-900">
                  {preview.customerRequest.message}
                </p>
                <p className="mt-2 text-[12px] text-blue-700">
                  Approbation enregistrée au nom de {preview.approvingAdmin ?? "—"}.
                </p>
              </div>
            )}

            <div className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-200 px-3 py-1">
              <Row label="Élément concerné" value={preview.itemLabel} />
              <Row label="Statut actuel" value={preview.currentStatus ?? "—"} />
              {preview.keepsHistoricalStatus && (
                <Row label="Statut après opération" value="inchangé (correction financière seule)" tone="warn" />
              )}
              <Row label="Total encaissé" value={money(preview.totalCollected)} />
              {preview.alreadyRefunded > 0 && (
                <Row label="Déjà remboursé" value={money(preview.alreadyRefunded)} tone="warn" />
              )}
              <Row label="Montant total crédité" value={money(preview.creditedTotal)} tone="danger" />
              <Row
                label="Document"
                value={
                  preview.alreadyFullyCredited
                    ? "facture déjà entièrement créditée — aucun nouveau document"
                    : preview.documentKind === "CREDIT_NOTE"
                      ? `note de crédit (facture ${preview.invoiceNumber})`
                      : "justificatif de remboursement (client B2C sans facture)"
                }
              />
              {preview.releasedSeats > 0 && (
                <Row label="Places libérées" value={`${preview.releasedSeats}`} tone="ok" />
              )}
              {preview.restoredStockLines > 0 && (
                <Row label="Lignes remises en stock" value={`${preview.restoredStockLines}`} tone="ok" />
              )}
              {/* Never "automatique". This application does not refund —
                  an admin does, by hand in Stripe. Saying otherwise here is
                  how someone ends up believing the money already left. */}
              <Row
                label="À rembourser dans Stripe (manuellement)"
                value={preview.automaticTotal > 0 ? money(preview.automaticTotal) : "aucun"}
                tone={preview.automaticTotal > 0 ? "warn" : "default"}
              />
              <Row
                label="À rendre en main propre"
                value={
                  preview.manualTotal > 0
                    ? preview.manualLegs
                        .map((leg) => `${money(leg.amount)} en ${METHOD_LABEL[leg.method] ?? leg.method}`)
                        .join(" · ")
                    : "aucun"
                }
                tone={preview.manualTotal > 0 ? "warn" : "default"}
              />
            </div>

            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              <strong>Cette action ne rembourse rien.</strong> Elle annule, libère et produit le document.
              Les remboursements restent à effectuer : dans Stripe pour la partie en ligne, en main propre
              pour le reste. Ils apparaîtront en haut de cette page tant qu&apos;ils ne sont pas faits, et
              le client ne sera informé qu&apos;une fois tout confirmé.
            </p>

            {preview.inFlightOperation && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Une opération de remboursement est déjà en cours sur ce paiement (
                {preview.inFlightOperation.status}). Confirmer la reprendra sans créer de second
                remboursement.
              </p>
            )}

            <label className="mb-1.5 block text-[13px] font-medium text-gray-700" htmlFor="refund-reason">
              Motif {trigger === "NO_SHOW_EXCEPTION" ? "(obligatoire, audité)" : "(obligatoire)"}
            </label>
            <textarea
              id="refund-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Expliquez la décision — au moins 10 caractères."
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
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Loader2 size={15} className="animate-spin" /> : null}
            Annuler et rembourser
          </button>
        </div>
      </div>
    </div>
  );
}
