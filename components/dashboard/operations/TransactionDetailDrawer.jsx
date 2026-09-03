"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Receipt, FileText, FileMinus, FilePlus2, Loader2 } from "lucide-react";
import { getTransactionDetail } from "@/actions/dashboard/admin-operations";
import { issueMissingRefundDocument } from "@/actions/dashboard/cancel-and-refund";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("fr-BE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "—";

function SectionTitle({ children }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h4 className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-gray-500">{children}</h4>
      <div className="flex-1 border-t border-gray-100" />
    </div>
  );
}

function Row({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

/** The four polymorphic Payment sources, flattened into one shape. */
function describeSource(payment) {
  if (payment?.order) {
    return {
      kind: "Commande boutique",
      title: `n°${payment.order.orderNumber}`,
      status: payment.order.status,
      extra: payment.order.fulfilmentMode,
      customer: payment.order.user,
    };
  }
  if (payment?.workshopReservation) {
    const r = payment.workshopReservation;
    return {
      kind: r.session.workshop.type === "EVENT" ? "Événement" : "Atelier",
      title: r.session.workshop.title,
      status: r.status,
      extra: `${r.seatsCount} place(s) · session du ${dateTime(r.session.startDate)}`,
      customer: r.customer,
    };
  }
  if (payment?.formationReservation) {
    const r = payment.formationReservation;
    return {
      kind: "Formation",
      title: r.session.formation.title,
      status: r.status,
      extra: `${r.seatsCount} place(s) · session du ${dateTime(r.session.startDate)}`,
      customer: r.customer,
    };
  }
  if (payment?.appointment) {
    return {
      kind: "Rendez-vous",
      title: dateTime(payment.appointment.date),
      status: payment.appointment.status,
      extra: null,
      customer: payment.appointment.user,
    };
  }
  return { kind: "—", title: "—", status: null, extra: null, customer: null };
}

/**
 * @param {{ transactionId: string|null, onClose: () => void }} props
 */
export function TransactionDetailDrawer({ transactionId, onClose }) {
  const closeBtnRef = useRef(null);
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatingNote, setGeneratingNote] = useState(false);
  const [confirmingNote, setConfirmingNote] = useState(false);

  useEffect(() => {
    if (!transactionId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getTransactionDetail(transactionId).then((result) => {
      if (cancelled) return;
      if (result.success) setDetail(result.data);
      else setError(result.message);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  async function handleGenerateCreditNote() {
    if (!transactionId || generatingNote) return;
    setGeneratingNote(true);
    const result = await issueMissingRefundDocument(transactionId);
    setGeneratingNote(false);
    setConfirmingNote(false);
    if (result.success) {
      toast.success(result.message);
      const refreshed = await getTransactionDetail(transactionId);
      if (refreshed.success) setDetail(refreshed.data);
    } else {
      toast.error(result.message);
    }
  }

  useEffect(() => {
    if (!transactionId) return;
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [transactionId]);

  useEffect(() => {
    if (!transactionId) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [transactionId, onClose]);

  useEffect(() => {
    document.body.style.overflow = transactionId ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [transactionId]);

  if (!transactionId) return null;

  const payment = detail?.payment;
  const source = describeSource(payment);
  const invoice = payment?.invoice;
  const creditNote = detail?.creditNote ?? null;
  const siblings = (payment?.transactions ?? []).filter((t) => !t.isDeleted);
  const isRefund = detail?.transactionType === "REFUND";
  const signedMoney = (value, refund) => `${refund ? "−" : ""}${money(value)}`;
  const canGenerateNote = isRefund && Boolean(invoice) && !creditNote;
  const refundReceipt = detail?.settledRefundLeg?.refundOperation ?? null;
  const canGenerateB2CReceipt = isRefund && !invoice && !refundReceipt;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Détail de la transaction"
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                isRefund ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              <Receipt size={17} />
            </div>
            <div className="min-w-0">
              <h2 className={`truncate text-base font-semibold leading-tight ${isRefund ? "text-red-600" : "text-gray-900"}`}>
                {detail ? signedMoney(detail.amount, isRefund) : "Chargement…"}
              </h2>
              {detail && <span className="text-xs text-gray-400">{dateTime(detail.paidAt)}</span>}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {isLoading && <p className="text-sm text-gray-500">Chargement…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {detail && (
            <>
              <div>
                <SectionTitle>Transaction</SectionTitle>
                <Row label="Montant" value={signedMoney(detail.amount, isRefund)} />
                <Row label="Type" value={detail.transactionType} />
                <Row label="Méthode" value={detail.method} />
                <Row label="Payée le" value={dateTime(detail.paidAt)} />
                <Row label="Référence Stripe (PI)" value={detail.stripePaymentIntentId} />
                <Row label="Session Stripe" value={detail.stripeCheckoutSessionId} />
                <Row label="Référence manuelle" value={detail.manualReference} />
                {/* Cash-drawer trail — only ever set on a CASH sale at the till. */}
                <Row label="Reçu en espèces" value={detail.cashReceived != null ? money(detail.cashReceived) : null} />
                <Row label="Monnaie rendue" value={detail.changeGiven != null ? money(detail.changeGiven) : null} />
                <Row
                  label="Session de caisse"
                  value={detail.cashSession ? `Ouverte le ${dateTime(detail.cashSession.openedAt)}` : null}
                />
              </div>

              <div>
                <SectionTitle>Origine</SectionTitle>
                <Row label="Type" value={source.kind} />
                <Row label="Référence" value={source.title} />
                <Row label="Statut" value={source.status} />
                <Row label="Détail" value={source.extra} />
                <Row label="Client" value={source.customer?.fullName} />
                <Row label="E-mail" value={source.customer?.email} />
              </div>

              <div>
                <SectionTitle>Paiement</SectionTitle>
                <Row label="Statut" value={payment?.status} />
                <Row label="Type" value={payment?.paymentType} />
                <Row label="Montant total" value={payment ? money(payment.totalAmount) : null} />
                <Row label="Déjà réglé" value={payment ? money(payment.paidAmount) : null} />
                <Row label="Solde restant" value={payment ? money(payment.remainingAmount) : null} />
              </div>

              {siblings.length > 1 && (
                <div>
                  {/* An acompte and its balance are two rows against one
                      Payment — showing only the opened one would misstate
                      what the customer actually paid. */}
                  <SectionTitle>Toutes les transactions de ce paiement</SectionTitle>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {siblings.map((t) => (
                      <li
                        key={t.id}
                        className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                          t.id === detail.id ? "bg-emerald-50/60" : ""
                        }`}
                      >
                        <span className="text-gray-600">
                          {dateTime(t.paidAt)} · {t.transactionType} · {t.method}
                        </span>
                        <span className={`font-medium ${t.transactionType === "REFUND" ? "text-red-600" : "text-gray-900"}`}>
                          {signedMoney(t.amount, t.transactionType === "REFUND")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {payment?.order && (
                <div>
                  <SectionTitle>Reçu / ticket de caisse</SectionTitle>
                  <a
                    href={`/api/orders/${payment.order.id}/ticket`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <Receipt size={15} />
                    Ouvrir le reçu déjà envoyé au client
                  </a>
                </div>
              )}

              <div>
                <SectionTitle>Facture</SectionTitle>
                {invoice ? (
                  <>
                    <Row label="Numéro" value={invoice.number} />
                    <Row label="Émise le" value={dateTime(invoice.issuedAt)} />
                    <Row label="Total HT" value={money(invoice.subtotalExclVat)} />
                    <Row label={`TVA (${Number(invoice.vatRate)} %)`} value={money(invoice.vatAmount)} />
                    <Row label="Total TTC" value={money(invoice.totalInclVat)} />
                    <Row label="Régime TVA" value={invoice.vatTreatment} />
                    <a
                      href={`/api/invoices/${invoice.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <FileText size={15} />
                      Ouvrir la facture PDF
                    </a>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">
                    Aucune facture n&apos;a encore été émise pour ce paiement.
                  </p>
                )}
              </div>

              {(creditNote || canGenerateNote) && (
                <div>
                  <SectionTitle>Note de crédit</SectionTitle>
                  {creditNote ? (
                    <div className="space-y-3 rounded-lg border border-gray-100 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">
                          {creditNote.number} · {dateTime(creditNote.issuedAt)}
                          {creditNote.reason && <span className="block text-xs text-gray-400">{creditNote.reason}</span>}
                        </span>
                        <span className="font-medium text-red-600">{money(-creditNote.totalInclVat)}</span>
                      </div>
                      <a
                        href={`/api/credit-notes/${creditNote.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                      >
                        <FileMinus size={16} /> Télécharger la note de crédit
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5 text-sm">
                      <span className="text-gray-500">Aucune note de crédit pour ce remboursement.</span>
                      <button
                        type="button"
                        onClick={() => setConfirmingNote(true)}
                        disabled={generatingNote}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {generatingNote ? <Loader2 size={12} className="animate-spin" /> : <FilePlus2 size={12} />} Générer
                      </button>
                    </div>
                  )}
                </div>
              )}

              {refundReceipt?.refundReceiptNumber && (
                <div>
                  <SectionTitle>Justificatif de remboursement</SectionTitle>
                  <a
                    href={`/api/refund-receipts/${refundReceipt.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    <FileMinus size={15} /> Télécharger le justificatif {refundReceipt.refundReceiptNumber}
                  </a>
                </div>
              )}

              {canGenerateB2CReceipt && (
                <div>
                  <SectionTitle>Justificatif de remboursement</SectionTitle>
                  <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-2.5 text-sm">
                    <span className="text-gray-500">Ce remboursement B2C existe déjà, mais son justificatif manque.</span>
                    <button
                      type="button"
                      onClick={() => setConfirmingNote(true)}
                      disabled={generatingNote}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {generatingNote ? <Loader2 size={12} className="animate-spin" /> : <FilePlus2 size={12} />} Générer et envoyer
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {(canGenerateNote || canGenerateB2CReceipt) && (
            <ConfirmDialog
              open={confirmingNote}
              title={canGenerateB2CReceipt ? "Créer le justificatif manquant ?" : "Émettre la note de crédit manquante ?"}
              message={canGenerateB2CReceipt ? "Ce remboursement B2C a déjà eu lieu. Cette action ne rembourse rien de plus : elle crée le justificatif numéroté et l'envoie au client." : "Ce remboursement a déjà eu lieu mais n'a jamais reçu son document comptable. La note de crédit ne rembourse rien de plus — elle documente l'argent déjà rendu. Elle porte un numéro légal, séquentiel et définitif."}
              confirmLabel="Générer"
              cancelLabel="Annuler"
              loading={generatingNote}
              onConfirm={handleGenerateCreditNote}
              onCancel={() => setConfirmingNote(false)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
