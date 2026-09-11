"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Receipt, FileText, FileMinus, FilePlus2, Loader2, Mail, AlertTriangle, QrCode } from "lucide-react";
import { getTransactionDetail } from "@/actions/dashboard/admin-operations";
import { issueMissingRefundDocument, sendB2CRefundConfirmation } from "@/actions/dashboard/cancel-and-refund";
import { sendTicketByEmail } from "@/actions/payments/send-ticket-email";
import { sendCheckInEmail } from "@/actions/payments/send-checkin-email";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog";
import { GenerateCreditNoteDialog } from "@/components/dashboard/operations/GenerateCreditNoteDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { collectibleBalance } from "@/lib/payments/collectible-balance";
import { performedByLabel } from "@/lib/dashboard/operation-filters";
import { SHIPPED_ORDER_STATUSES } from "@/lib/refunds/authorize";

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
      // null is a genuine self-service sale, not missing data — same
      // fallback AdminOperationsClient.jsx uses for the list row.
      performedByText: performedByLabel(payment.order.performedBy) ?? "Achat en ligne (client)",
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
      // Deliberately no performedByText — see admin-operations.js's own
      // comment on why ateliers/événements stay out of this attribution.
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
      performedByText: performedByLabel(r.performedBy),
    };
  }
  if (payment?.appointment) {
    return {
      kind: "Rendez-vous",
      title: dateTime(payment.appointment.date),
      status: payment.appointment.status,
      extra: null,
      customer: payment.appointment.user,
      performedByText: performedByLabel(payment.appointment.performedBy),
    };
  }
  return { kind: "—", title: "—", status: null, extra: null, customer: null };
}

function amountStillDue(payment, sourceStatus) {
  if (!payment) return null;
  return collectibleBalance({
    remainingAmount: payment.remainingAmount,
    paymentStatus: payment.status,
    lifecycleStatus: sourceStatus,
  });
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
  const [sendingB2CConfirmation, setSendingB2CConfirmation] = useState(false);
  const [sendingTicket, setSendingTicket] = useState(false);
  const [sendingCheckIn, setSendingCheckIn] = useState(false);
  const [deliveryDocument, setDeliveryDocument] = useState(null);
  const [cancelRefundOpen, setCancelRefundOpen] = useState(false);
  const [generateCreditNoteOpen, setGenerateCreditNoteOpen] = useState(false);

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

  async function refreshDetail() {
    if (!transactionId) return;
    const refreshed = await getTransactionDetail(transactionId);
    if (refreshed.success) setDetail(refreshed.data);
  }

  // After "Générer note de crédit" succeeds, go straight to the same
  // delivery card an invoice already uses (e-mail / Peppyrus / both) — the
  // whole point of the button per the handoff was "generate, then send",
  // not a second trip back into this drawer to find the note.
  //
  // The credit note comes from the action's own result, not from refetching
  // this transaction's detail: it belongs to the newly created REFUND
  // transaction, not the DEPOSIT/FINAL_PAYMENT one this drawer is open on,
  // so `refreshed.data.creditNote` would always be empty here.
  async function handleCreditNoteGenerated(result) {
    if (transactionId) {
      const refreshed = await getTransactionDetail(transactionId);
      if (refreshed.success) setDetail(refreshed.data);
    }
    if (result?.creditNote) {
      setDeliveryDocument({ kind: "CREDIT_NOTE", document: result.creditNote });
    }
  }

  // Payment-scoped on purpose (no transactionId): the client is owed the whole
  // prestation, and for a booking discounted to a zero balance this drawer is
  // the only place the send can happen at all — that settlement creates no
  // Transaction, so it never reaches the Livre de caisse's own button.
  async function handleSendTicket() {
    const paymentId = detail?.payment?.id;
    if (!paymentId || sendingTicket) return;
    setSendingTicket(true);
    const result = await sendTicketByEmail(paymentId);
    setSendingTicket(false);
    if (result.success) {
      toast.success(result.message);
      await refreshDetail();
    } else toast.error(result.message);
  }

  async function handleSendCheckIn() {
    const paymentId = detail?.payment?.id;
    if (!paymentId || sendingCheckIn) return;
    setSendingCheckIn(true);
    const result = await sendCheckInEmail(paymentId);
    setSendingCheckIn(false);
    if (result.success) toast.success(result.message);
    else toast.error(result.message);
  }

  async function handleSendB2CConfirmation() {
    const operationId = detail?.settledRefundLeg?.refundOperation?.id;
    if (!operationId || sendingB2CConfirmation) return;
    setSendingB2CConfirmation(true);
    const result = await sendB2CRefundConfirmation(operationId);
    setSendingB2CConfirmation(false);
    if (result.success) {
      toast.success(result.message);
      await refreshDetail();
    } else toast.error(result.message);
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
  // Both timestamps are ISO strings off the server action; getTransactionDetail
  // only looks the adjustment up when a ticket was actually sent, so a null
  // here means "never repriced" or "never sent" — neither is stale.
  const ticketIsStale =
    Boolean(payment?.ticketEmailedAt) &&
    Boolean(detail?.lastPriceAdjustedAt) &&
    new Date(detail.lastPriceAdjustedAt) > new Date(payment.ticketEmailedAt);
  const signedMoney = (value, refund) => `${refund ? "−" : ""}${money(value)}`;
  // A credit note is written against the REFUND row, so the cancelled sale's
  // own transaction carries none — which is exactly the row an admin opens
  // after cancelling. Fall back to every note standing against this payment's
  // invoice so the document is reachable (download / send) from either side.
  const creditNotes = creditNote ? [creditNote] : (invoice?.creditNotes ?? []);
  // The third way to mint a note (issueMissingRefundDocument, for a refund
  // that moved money but never got its paperwork). Tested against the whole
  // list, not just this row's own note, so an invoice that already carries
  // one is never offered a second.
  const canGenerateNote = isRefund && Boolean(invoice) && creditNotes.length === 0;
  const refundOperation = detail?.settledRefundLeg?.refundOperation ?? null;
  const hasB2CCustomer = isRefund && refundOperation?.status === "COMPLETED" && !creditNote && !invoice;
  // A cancellation already opened on this payment means both buttons below
  // are spent: openRefundOperation resumes that operation rather than
  // creating a second one, so clicking again issues no new credit note and
  // just reports "opération déjà reprise". Only the in-flight statuses
  // count, so a settled partial return still leaves the rest refundable —
  // and an item cancelled through some other screen with no operation at all
  // still offers the reprise these buttons exist for.
  const refundInFlight = (payment?.refundOperations ?? []).length > 0;
  // Mirrors InvoiceRowActions.jsx's formula for the Transactions-tab row,
  // plus the guard above. The row component's own cancel button sits in its
  // `!onOpenDetail` branch, which AdminOperationsClient never reaches for a
  // row that has a transaction — this drawer is the live surface.
  const canCancelAndRefund =
    Boolean(payment?.id) &&
    ["DEPOSIT", "FINAL_PAYMENT"].includes(detail?.transactionType) &&
    !detail?.refundState?.fullyCredited &&
    Number(detail?.refundState?.remainingRefundable) > 0.01 &&
    !refundInFlight;
  // "Générer note de crédit" only ever succeeds through authorize.js's one
  // exception for POST_COMPLETION_CORRECTION — a COMPLETED appointment/
  // reservation, or a COMPLETED/SHIPPED order. Offering it on anything still
  // active (CONFIRMED, PENDING…) used to be possible: the click would reach
  // the server and get refused with REQUEST_REQUIRED — "le client doit
  // d'abord envoyer une demande écrite" — a written-customer-request message
  // that makes no sense for a price correction, because that denial exists
  // for a completely different situation. Mirrored here so the button is
  // simply absent until the item is actually eligible; "Annuler et
  // rembourser" (already offered whenever canCancelAndRefund is true) is the
  // correct action for anything still active.
  const isPostCompletionEligible = payment?.order
    ? SHIPPED_ORDER_STATUSES.has(source.status)
    : source.status === "COMPLETED";
  // Deliberately not gated on remainingRefundable/fullyCredited beyond that
  // — those describe whether the OTHER button applies, not this one.
  // refundInFlight still applies: cancelUnderlyingItem sets every source's
  // status to CANCELLED, and clicking again past that point only resumes the
  // existing operation (no second credit note), which reads to an admin as
  // the button silently doing nothing.
  const canGenerateCreditNote =
    Boolean(payment?.id) &&
    ["DEPOSIT", "FINAL_PAYMENT"].includes(detail?.transactionType) &&
    isPostCompletionEligible &&
    !refundInFlight;

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
                <Row label="Réalisé par" value={source.performedByText} />
              </div>

              <div>
                <SectionTitle>Paiement</SectionTitle>
                <Row label="Statut" value={payment?.status} />
                <Row label="Type" value={payment?.paymentType} />
                <Row label="Montant total" value={payment ? money(payment.totalAmount) : null} />
                <Row label="Déjà réglé" value={payment ? money(payment.paidAmount) : null} />
                <Row label="Solde restant" value={payment ? money(amountStillDue(payment, source.status)) : null} />
                <div className="mt-3 flex flex-wrap gap-2">
                  {canCancelAndRefund && (
                    <button
                      type="button"
                      onClick={() => setCancelRefundOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      <AlertTriangle size={14} /> Annuler et rembourser
                    </button>
                  )}
                  {canGenerateCreditNote && (
                    <button
                      type="button"
                      onClick={() => setGenerateCreditNoteOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                    >
                      <FilePlus2 size={14} /> Générer note de crédit
                    </button>
                  )}
                </div>
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

              {payment?.id && (
                <div>
                  <SectionTitle>Reçu / ticket de caisse</SectionTitle>
                  {/* A boutique order's ticket has no permission gate (its own
                      route stays open to every dashboard role); a reservation's
                      ticket needs the same SEND_TICKET_EMAIL permission to open
                      as it does to e-mail — the route itself now enforces this,
                      this just avoids offering a link that would 403. */}
                  {(payment.order || detail.canSendTicketEmail) && (
                    <a
                      href={payment.order ? `/api/orders/${payment.order.id}/ticket` : `/api/payments/${payment.id}/ticket`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Receipt size={15} />
                      Ouvrir le reçu
                    </a>
                  )}
                  {/* No auto-send exists any more; ticketEmailedAt is set
                      only by the manual, permission-gated action in
                      actions/payments/send-ticket-email.js — this line is
                      what makes that visible to admins on this same
                      transaction, independent of who sent it. */}
                  {!payment.order && (
                    <>
                      {detail.canSendTicketEmail && (
                        <button
                          type="button"
                          onClick={handleSendTicket}
                          disabled={sendingTicket}
                          className="ml-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {sendingTicket ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                          {ticketIsStale ? "Renvoyer le ticket corrigé" : "Envoyer par e-mail"}
                        </button>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        {payment.ticketEmailedAt
                          ? `Ticket envoyé au client le ${dateTime(payment.ticketEmailedAt)}.`
                          : "Ticket jamais envoyé par e-mail au client."}
                      </p>
                      {/* ticketEmailedAt says only *that* a ticket went out,
                          never for which total. A counter adjustment after the
                          send leaves the client holding a receipt for a price
                          that no longer exists, and nothing else in the app
                          would ever surface that. */}
                      {ticketIsStale && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <AlertTriangle size={14} className="mt-px shrink-0" />
                          <span>
                            Le prix a été ajusté le {dateTime(detail.lastPriceAdjustedAt)}, après cet envoi : le client
                            détient un reçu obsolète.
                          </span>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {detail.checkIn && (
                <div>
                  <SectionTitle>{detail.checkIn.kind === "ORDER_PICKUP" ? "QR code de retrait" : "Billet / QR code d'accès"}</SectionTitle>
                  <div className="flex items-start gap-4 rounded-lg border border-gray-100 p-4">
                    {detail.checkIn.qr ? (
                      <img
                        src={detail.checkIn.qr}
                        alt="QR code envoyé au client"
                        className="h-24 w-24 flex-shrink-0 rounded-md border border-gray-100 bg-white"
                      />
                    ) : (
                      <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-md border border-gray-100 bg-gray-50 text-gray-300">
                        <QrCode size={28} />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="font-mono text-base font-bold tracking-widest text-gray-900">{detail.checkIn.code}</p>
                      {detail.checkIn.seatsLabel && <p className="text-xs text-gray-500">{detail.checkIn.seatsLabel}</p>}
                      <p className={detail.checkIn.usedAt ? "text-xs font-medium text-emerald-700" : "text-xs text-gray-500"}>
                        {detail.checkIn.usedAt
                          ? `${detail.checkIn.kind === "ORDER_PICKUP" ? "Retiré" : "Scanné"} le ${dateTime(detail.checkIn.usedAt)}.`
                          : "Pas encore scanné."}
                      </p>
                      {detail.checkIn.kind !== "ORDER_PICKUP" && detail.canSendTicketEmail && (
                        <button
                          type="button"
                          onClick={handleSendCheckIn}
                          disabled={sendingCheckIn}
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {sendingCheckIn ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
                          Renvoyer par e-mail
                        </button>
                      )}
                    </div>
                  </div>
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
                    {invoice.customerType === "B2B" && (
                      <button
                        type="button"
                        onClick={() => setDeliveryDocument({ kind: "INVOICE", document: invoice })}
                        className="mt-3 ml-2 inline-flex items-center gap-2 rounded-lg border border-[#2f3a2e] bg-white px-3 py-2 text-sm font-semibold text-[#2f3a2e] hover:bg-[#f4f7f3]"
                      >
                        <Mail size={15} /> {invoice.emailSentAt || invoice.peppyrusSentAt ? "Gérer l'envoi" : "Envoyer la facture"}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">
                    Aucune facture n&apos;a encore été émise pour ce paiement.
                  </p>
                )}
              </div>

              {(creditNotes.length > 0 || canGenerateNote) && (
                <div>
                  <SectionTitle>Note de crédit</SectionTitle>
                  {creditNotes.length > 0 ? (
                    <div className="space-y-3">
                      {creditNotes.map((note) => (
                        <div key={note.id} className="space-y-3 rounded-lg border border-gray-100 px-4 py-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">
                              {note.number} · {dateTime(note.issuedAt)}
                              {note.reason && <span className="block text-xs text-gray-400">{note.reason}</span>}
                            </span>
                            <span className="font-medium text-red-600">{money(-note.totalInclVat)}</span>
                          </div>
                          <a
                            href={`/api/credit-notes/${note.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                          >
                            <FileMinus size={16} /> Télécharger la note de crédit
                          </a>
                          {invoice?.customerType === "B2B" && (
                            <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                              <p className="font-medium text-amber-900">Livraison B2B</p>
                              <p className="mt-1 text-xs leading-5 text-amber-800">
                                Ouvrez la carte de livraison pour choisir l'e-mail ou l'envoi Peppol (Peppyrus).
                              </p>
                              <button
                                type="button"
                                onClick={() => setDeliveryDocument({ kind: "CREDIT_NOTE", document: note })}
                                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                              >
                                <Mail size={13} />
                                {note.emailSentAt || note.peppyrusSentAt ? "Gérer l'envoi" : "Envoyer la note de crédit"}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
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

              {hasB2CCustomer && (
                <div>
                  <SectionTitle>Communication client</SectionTitle>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm">
                    <p className="font-medium text-emerald-900">Remboursement confirmé</p>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">
                      Aucun document n'est joint. L'e-mail est envoyé uniquement si vous le choisissez.
                    </p>
                    <button
                      type="button"
                      onClick={handleSendB2CConfirmation}
                      disabled={Boolean(refundOperation?.customerNotifiedAt) || sendingB2CConfirmation}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {sendingB2CConfirmation ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                      {refundOperation?.customerNotifiedAt ? "Confirmation déjà envoyée" : "Envoyer la confirmation"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {canGenerateNote && (
            <ConfirmDialog
              open={confirmingNote}
              title="Émettre la note de crédit manquante ?"
              message="Ce remboursement a déjà eu lieu mais n'a jamais reçu son document comptable. La note de crédit ne rembourse rien de plus — elle documente l'argent déjà rendu. Elle porte un numéro légal, séquentiel et définitif."
              confirmLabel="Générer"
              cancelLabel="Annuler"
              loading={generatingNote}
              onConfirm={handleGenerateCreditNote}
              onCancel={() => setConfirmingNote(false)}
            />
          )}
          <DocumentDeliveryDialog
            open={Boolean(deliveryDocument)}
            onClose={() => setDeliveryDocument(null)}
            document={deliveryDocument?.document ?? null}
            invoice={invoice}
            kind={deliveryDocument?.kind ?? "INVOICE"}
            onDelivered={refreshDetail}
          />
          {canCancelAndRefund && (
            <CancelAndRefundDialog
              open={cancelRefundOpen}
              paymentId={payment?.id}
              onClose={() => {
                setCancelRefundOpen(false);
                refreshDetail();
              }}
            />
          )}
          {canGenerateCreditNote && (
            <GenerateCreditNoteDialog
              open={generateCreditNoteOpen}
              paymentId={payment?.id}
              onClose={() => setGenerateCreditNoteOpen(false)}
              onGenerated={handleCreditNoteGenerated}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
