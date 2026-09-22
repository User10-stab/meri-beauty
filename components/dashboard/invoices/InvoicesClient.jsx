"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Eye, FileMinus, FilePlus2, FileSearch, HandCoins, Hourglass, Loader2, Mail, Receipt, RotateCcw, Search, Send } from "lucide-react";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { GenerateCreditNoteDialog } from "@/components/dashboard/operations/GenerateCreditNoteDialog";
import { SettleManualInvoiceDialog } from "@/components/dashboard/invoices/SettleManualInvoiceDialog";
import { CreditStaffRentDialog } from "@/components/dashboard/invoices/CreditStaffRentDialog";
import { INVOICE_SOURCE_LABELS } from "@/lib/invoices/list-filters";
import { pendingPaymentState } from "@/lib/invoices/pending-rows";
import { settleManualInvoice } from "@/actions/invoices/manual-invoice";
import { acceptAwaitedTransfer } from "@/actions/payments/awaited-transfer";
import { acceptStaffRentPayment, getStaffRentIssueDraft, issueStaffRentInvoice } from "@/actions/invoices/staff-rent";

/**
 * Factures — every issued invoice in one list with Voir / E-mail / Peppol.
 * A credit note is not a row of its own: once generated, its Voir / E-mail /
 * Peppol buttons take the place of the "Note de crédit" button. Sending
 * reuses the Opérations delivery card and the credit note reuses its
 * "Générer une note de crédit" flow. No delete, on purpose: see
 * actions/dashboard/invoices.js.
 *
 * What is still owed lives in this same table rather than in panels above it
 * (user's call, 2026-09-21): the « Paiement » column says waiting or late, and
 * one tick accepts the money — same row, same place as the send buttons. A
 * pending row whose invoice already exists (a rent invoiced before the
 * payment-first rule) is drawn on that invoice's own row, not twice.
 */

const euro = (value) => new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-BE", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Brussels" }) : "—";

const formatDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-BE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" })
    : "—";

const DELIVERY_OPTIONS = [
  ["ALL", "Tous les envois"],
  ["UNSENT", "Jamais envoyées"],
  ["SENT", "Envoyées"],
  ["PEPPOL_PENDING", "Peppol à envoyer"],
  ["CREDITED", "Avec note de crédit"],
];
const SOURCE_OPTIONS = [["ALL", "Toutes origines"], ...Object.entries(INVOICE_SOURCE_LABELS)];

const inputClass =
  "rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white";

function StatCard({ label, value, tone = "text-dark dark:text-white", onClick, active }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left dark:bg-gray-dark ${
        active ? "border-[#2f3a2e] ring-1 ring-[#2f3a2e]" : "border-stroke dark:border-dark-3"
      } ${onClick ? "transition hover:border-[#2f3a2e]" : ""}`}
    >
      <p className="text-xs font-medium text-gray-500 dark:text-dark-6">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone}`}>{value}</p>
    </Tag>
  );
}

function DeliveryBadge({ label, sentAt, icon: Icon }) {
  return sentAt ? (
    <span
      title={`Envoyé le ${formatDateTime(sentAt)}`}
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    >
      <Icon size={11} /> {label} · {formatDate(sentAt)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-dark-2 dark:text-dark-6">
      <Icon size={11} /> {label} · non envoyé
    </span>
  );
}

function DeliveryCell({ doc, peppolApplicable }) {
  const never = !doc.emailSentAt && !doc.peppyrusSentAt;
  return (
    <div className="flex flex-col items-start gap-1">
      {never && (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          Jamais envoyée
        </span>
      )}
      <DeliveryBadge label="E-mail" sentAt={doc.emailSentAt} icon={Mail} />
      {peppolApplicable && <DeliveryBadge label="Peppol" sentAt={doc.peppyrusSentAt} icon={Send} />}
    </div>
  );
}

// Icon-only, so the pinned Actions column stays narrow enough not to cover
// the columns scrolling beneath it (user's call, 2026-09-21). Every button
// carries its name as a tooltip (title) and for screen readers (aria-label).
const actionButton =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-40";
const ICON = 15;

// The table scrolls sideways on a laptop; the buttons must not scroll away
// with it. The column stays pinned to the right edge, opaque (each cell sets
// its row's background), with a soft edge over whatever scrolls beneath.
const stickyActions = "sticky right-0 z-10 border-l border-stroke shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)] dark:border-dark-3";

/** What « Aperçu » previews: the pending row's own accept target. */
function previewHref(pending) {
  const { kind, rentId, orderId, paymentId } = pending.accept;
  const id = kind === "RENT" ? rentId : kind === "MANUAL_SALE" ? orderId : kind === "TRANSFER" ? paymentId : null;
  return id ? `/api/invoices/preview?kind=${kind}&id=${encodeURIComponent(id)}` : null;
}

/**
 * The same buttons for an invoice and for its credit note: Voir (opens the
 * PDF in a new tab — saving it from there, never a forced download),
 * E-mail, and Peppol (Belgian B2B only — the rule the server enforces). Each
 * send button opens the shared delivery card with its own channel
 * pre-ticked; the card's confirm step still gates the send.
 */
function DocumentActions({ pdfHref, peppolApplicable, onSend, tone }) {
  return (
    <>
      <a href={pdfHref} target="_blank" rel="noopener noreferrer" title="Voir le PDF" aria-label="Voir le PDF" className={`${actionButton} ${tone}`}>
        <Eye size={ICON} />
      </a>
      <button type="button" onClick={() => onSend("EMAIL")} title="Envoyer par e-mail" aria-label="Envoyer par e-mail" className={`${actionButton} ${tone}`}>
        <Mail size={ICON} />
      </button>
      {peppolApplicable && (
        <button type="button" onClick={() => onSend("PEPPYRUS")} title="Envoyer via Peppol" aria-label="Envoyer via Peppol" className={`${actionButton} ${tone}`}>
          <Send size={ICON} />
        </button>
      )}
    </>
  );
}

const OPEN_PAYMENT = ["PENDING", "PARTIALLY_PAID"];

/**
 * The « Paiement » column. Paid only once the money is recorded (« Accepter »,
 * a checkout, the till) — never because the invoice was issued or sent: a rent
 * invoice goes out before it is paid, and reads « En attente » until then.
 */
function PaymentCell({ pending, invoice = null }) {
  if (!pending && OPEN_PAYMENT.includes(invoice?.paymentStatus)) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
        <Hourglass size={11} /> En attente
      </span>
    );
  }
  if (!pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <Check size={11} /> Payé
      </span>
    );
  }
  const { late, dueDate } = pendingPaymentState(pending);
  return (
    <div className="flex flex-col items-start gap-1">
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          late ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
        }`}
      >
        <Hourglass size={11} /> {late ? "En retard" : "En attente"}
      </span>
      {dueDate && <span className="text-[11px] text-gray-400">Échéance {formatDate(dueDate)}</span>}
      <span className="text-[11px] font-semibold text-gray-600 dark:text-dark-6">Reste {euro(pending.remainingAmount)}</span>
    </div>
  );
}

/**
 * The tick that accepts the money, and — for a manual sale only, which can
 * also be paid in cash, by card or in several times — the dialog that does
 * anything other than "the whole balance arrived by transfer".
 */
function PendingActions({ pending, busy, onAccept, onSettle, onIssue }) {
  // A row already invoiced has its own « Voir »; the others show, before the
  // tick, the invoice they would get — or why there would be none.
  const preview = pending.invoiceNumber ? null : previewHref(pending);
  // A rent recorded without its invoice (the automatic issue was refused, or
  // it predates rents being invoiced up front) can be invoiced before payment.
  const canIssue = pending.accept.kind === "RENT";
  return (
    <>
      {preview && (
        <a
          href={preview}
          target="_blank"
          rel="noopener noreferrer"
          title="Aperçu de la facture, avec son numéro prévu — rien n'est émis"
          aria-label="Aperçu de la facture"
          className={`${actionButton} border-[#2f3a2e] text-[#2f3a2e] hover:bg-[#f4f7f3]`}
        >
          <FileSearch size={ICON} />
        </a>
      )}
      {canIssue && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onIssue(pending)}
          title="Émettre et envoyer la facture : choisissez d'abord l'envoi (e-mail, Peppol). Le paiement reste en attente jusqu'à « Accepter »"
          aria-label="Émettre la facture"
          className={`${actionButton} border-[#2f3a2e] bg-[#2f3a2e] text-white hover:bg-[#1f291f]`}
        >
          <Receipt size={ICON} />
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onAccept(pending)}
        title="Accepter : le paiement est arrivé — l'argent est enregistré pour le salon"
        aria-label="Accepter le paiement"
        className={`${actionButton} border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700`}
      >
        {busy ? <Loader2 size={ICON} className="animate-spin" /> : <Check size={ICON} strokeWidth={2.5} />}
      </button>
      {pending.settleOrderId && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSettle(pending)}
          title="Encaisser autrement : espèces, carte ou acompte"
          aria-label="Encaisser autrement"
          className={`${actionButton} border-sky-300 text-sky-800 hover:bg-sky-50`}
        >
          <HandCoins size={ICON} />
        </button>
      )}
    </>
  );
}

export function InvoicesClient({ data, pendingRows = [] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, rows, pagination, stats } = data;

  const [draft, setDraft] = useState(filters);
  const [delivery, setDelivery] = useState(null); // { kind, document, invoice, channel }
  const [creditNoteFor, setCreditNoteFor] = useState(null); // invoice row
  const [acceptingKey, setAcceptingKey] = useState(null);
  const [settling, setSettling] = useState(null); // manual sale, richer settlement
  const [issuedInvoice, setIssuedInvoice] = useState(null); // « proposer l'envoi »
  const [rentCreditFor, setRentCreditFor] = useState(null); // rent invoice row
  const [rentToIssue, setRentToIssue] = useState(null); // { rentId, draft } — issued only once the send is confirmed

  useEffect(() => setDraft(filters), [filters]);

  // A pending row whose invoice is on screen is drawn on that row; the others
  // get one of their own above the list, so nothing owed is ever unreachable
  // behind a filter or a page.
  const shownNumbers = new Set(rows.map((invoice) => invoice.number));
  const pendingByNumber = new Map(
    pendingRows.filter((row) => row.invoiceNumber && shownNumbers.has(row.invoiceNumber)).map((row) => [row.invoiceNumber, row])
  );
  const looseRows = pendingRows.filter((row) => !row.invoiceNumber || !shownNumbers.has(row.invoiceNumber));

  /** One tick, whatever the row is: the whole balance, received by transfer. */
  /**
   * « Émettre la facture » on a rent: nothing is issued yet. The send card
   * opens on a draft first; the invoice gets its number and goes out only
   * once the channels are chosen and confirmed. Its payment stays pending.
   */
  async function issueRent(row) {
    if (acceptingKey) return;
    setAcceptingKey(row.key);
    const result = await getStaffRentIssueDraft({ rentId: row.accept.rentId });
    setAcceptingKey(null);
    if (!result?.success) {
      toast.error(result?.message ?? "Facture non émise.");
      return;
    }
    setRentToIssue({ rentId: row.accept.rentId, draft: result.data.draft });
  }

  async function issueRentNow() {
    const result = await issueStaffRentInvoice({ rentId: rentToIssue.rentId });
    return { success: Boolean(result?.success), message: result?.message, invoice: result?.data?.invoice ?? null };
  }

  async function acceptPending(row) {
    if (acceptingKey) return;
    setAcceptingKey(row.key);
    const { kind } = row.accept;
    const result =
      kind === "RENT" || kind === "LEGACY_INVOICE"
        ? await acceptStaffRentPayment(row.accept)
        : kind === "TRANSFER"
          ? await acceptAwaitedTransfer({ paymentId: row.accept.paymentId })
          : await settleManualInvoice({ orderId: row.accept.orderId, method: "TRANSFER" });
    setAcceptingKey(null);
    if (!result?.success) {
      toast.error(result?.message ?? "Paiement non enregistré.");
      return;
    }
    toast.success(result.message);
    if (result.data?.invoice) setIssuedInvoice(result.data.invoice);
    router.refresh();
  }

  function navigate(next) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "" || value === "ALL" || (key === "page" && Number(value) === 1)) params.delete(key);
      else params.set(key, String(value));
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function applyFilters(event) {
    event?.preventDefault();
    navigate({ ...draft, page: 1 });
  }

  function resetFilters() {
    router.push(pathname);
  }

  const hasActiveFilters =
    filters.q || filters.from || filters.to || [filters.delivery, filters.source].some((v) => v !== "ALL");

  return (
    <div className="space-y-5">
      {/* ── Synthèse ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={hasActiveFilters ? "Factures (filtrées)" : "Factures"} value={stats.count} />
        <StatCard label="Total TTC" value={euro(stats.totalInclVat)} />
        <StatCard
          label="Jamais envoyées"
          value={stats.unsent}
          tone={stats.unsent ? "text-amber-700 dark:text-amber-400" : "text-dark dark:text-white"}
          onClick={() => navigate({ delivery: filters.delivery === "UNSENT" ? "ALL" : "UNSENT", page: 1 })}
          active={filters.delivery === "UNSENT"}
        />
        <StatCard
          label="Peppol à envoyer (B2B belge)"
          value={stats.peppolPending}
          tone={stats.peppolPending ? "text-amber-700 dark:text-amber-400" : "text-dark dark:text-white"}
          onClick={() => navigate({ delivery: filters.delivery === "PEPPOL_PENDING" ? "ALL" : "PEPPOL_PENDING", page: 1 })}
          active={filters.delivery === "PEPPOL_PENDING"}
        />
      </div>

      {/* ── Filtres ──────────────────────────────────────────────────── */}
      <form
        onSubmit={applyFilters}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-gray-dark"
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-gray-500">
          Recherche
          <span className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              placeholder="N°, client, e-mail, TVA…"
              className={`${inputClass} w-full pl-9`}
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Envoi
          <select value={draft.delivery} onChange={(e) => setDraft((d) => ({ ...d, delivery: e.target.value }))} className={inputClass}>
            {DELIVERY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Origine
          <select value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} className={inputClass}>
            {SOURCE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Du
          <input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500">
          Au
          <input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className={inputClass} />
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1f291f]">
            Filtrer
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 rounded-lg border border-stroke px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-dark-3 dark:text-dark-6"
            >
              <RotateCcw size={14} /> Réinitialiser
            </button>
          )}
        </div>
      </form>

      {/* ── Tableau ──────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-stroke bg-white dark:border-dark-3 dark:bg-gray-dark">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-stroke text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-dark-3 dark:text-dark-6">
              <th className="px-4 py-3">N°</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Origine</th>
              <th className="px-4 py-3 text-right">Montant</th>
              <th className="px-4 py-3">Paiement</th>
              <th className="px-4 py-3">Envoi</th>
              <th className={`${stickyActions} bg-white px-4 py-3 text-right dark:bg-gray-dark`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Owed, not invoiced yet — no number, nothing to send. */}
            {looseRows.map((pending) => (
              <tr key={pending.key} className="border-b border-stroke bg-amber-50/40 align-top dark:border-dark-3 dark:bg-amber-900/10">
                <td className="px-4 py-3">
                  <p className="font-semibold text-dark dark:text-white">{pending.label}</p>
                  <p className="text-xs text-gray-400">Pas encore facturé</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-dark-6">{formatDate(pending.createdAt)}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-dark dark:text-white">{pending.customerName}</p>
                  <p className="text-xs text-gray-500">{pending.customerEmail || "— pas d'e-mail"}</p>
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-dark-6">
                  {pending.origin}
                  {pending.summary && (
                    <p className="max-w-xs truncate text-xs text-gray-400" title={pending.summary}>
                      {pending.summary}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <p className="font-semibold text-dark dark:text-white">{euro(pending.remainingAmount)}</p>
                  {pending.totalAmount != null && pending.paidAmount > 0 && (
                    <p className="text-xs text-gray-400">sur {euro(pending.totalAmount)} TTC</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <PaymentCell pending={pending} />
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">—</td>
                <td className={`${stickyActions} bg-amber-50 px-4 py-3 dark:bg-[#2a2415]`}>
                  <div className="flex justify-end gap-1.5 whitespace-nowrap">
                    <PendingActions pending={pending} busy={acceptingKey === pending.key} onAccept={acceptPending} onSettle={setSettling} onIssue={issueRent} />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && looseRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-500">
                  Aucune facture ne correspond à ces filtres.
                </td>
              </tr>
            )}
            {rows.map((invoice) => {
              const noteCount = invoice.creditNotes.length;
              const pending = pendingByNumber.get(invoice.number) ?? null;
              return (
                <Fragment key={invoice.id}>
                  <tr className="border-b border-stroke align-top last:border-0 hover:bg-gray-50/60 dark:border-dark-3 dark:hover:bg-dark-2/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-dark dark:text-white">{invoice.number}</p>
                      {invoice.supersededAt && (
                        <span
                          title={invoice.supersededReason ?? undefined}
                          className="mt-1 inline-flex rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600"
                        >
                          Remplacée
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-dark-6">
                      {formatDate(invoice.issuedAt)}
                      {invoice.dueDate && <p className="text-xs text-gray-400">Échéance {formatDate(invoice.dueDate)}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-dark dark:text-white">{invoice.customerLegalName || invoice.customerName}</p>
                      <p className="text-xs text-gray-500">{invoice.customerEmail || "— pas d'e-mail"}</p>
                      {invoice.customerVatNumber && <p className="mt-1 text-[11px] text-gray-500">TVA {invoice.customerVatNumber}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-dark-6">
                      {INVOICE_SOURCE_LABELS[invoice.source] ?? invoice.source}
                      {invoice.itemRef && <p className="text-xs text-gray-400">{invoice.itemRef}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <p className="font-semibold text-dark dark:text-white">{euro(invoice.totalInclVat)}</p>
                      <p className="text-xs text-gray-400">
                        {euro(invoice.subtotalExclVat)} HT · TVA {invoice.vatRate}%
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <PaymentCell pending={pending} invoice={invoice} />
                    </td>
                    <td className="px-4 py-3">
                      <DeliveryCell doc={invoice} peppolApplicable={invoice.peppolApplicable} />
                    </td>
                    <td className={`${stickyActions} bg-white px-4 py-3 dark:bg-gray-dark`}>
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        {pending && (
                          <PendingActions pending={pending} busy={acceptingKey === pending.key} onAccept={acceptPending} onSettle={setSettling} onIssue={issueRent} />
                        )}
                        <DocumentActions
                          pdfHref={`/api/invoices/${invoice.id}/pdf`}
                          peppolApplicable={invoice.peppolApplicable}
                          onSend={(channel) => setDelivery({ kind: "INVOICE", document: invoice, invoice, channel })}
                          tone="border-[#2f3a2e] text-[#2f3a2e] hover:bg-[#f4f7f3]"
                        />
                        {noteCount === 0 && (
                          <button
                            type="button"
                            // A rent invoice has no sale to cancel: its own dialog.
                            onClick={() => (invoice.source === "STAFF_CONTRACT" ? setRentCreditFor(invoice) : setCreditNoteFor(invoice))}
                            disabled={!invoice.canGenerateCreditNote}
                            title={invoice.canGenerateCreditNote ? "Générer une note de crédit" : invoice.creditNoteBlockedReason ?? undefined}
                            aria-label="Générer une note de crédit"
                            className={`${actionButton} border-amber-300 text-amber-800 hover:bg-amber-50`}
                          >
                            <FilePlus2 size={ICON} />
                          </button>
                        )}
                      </div>
                      {noteCount > 0 && invoice.source === "STAFF_CONTRACT" && invoice.canGenerateCreditNote && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setRentCreditFor(invoice)}
                            title="Nouvelle note de crédit sur ce loyer"
                            aria-label="Nouvelle note de crédit"
                            className={`${actionButton} border-amber-300 text-amber-800 hover:bg-amber-50`}
                          >
                            <FilePlus2 size={ICON} />
                          </button>
                        </div>
                      )}
                      {invoice.creditNotes.map((note) => (
                        <div key={note.id} className="mt-2 flex flex-col items-end gap-1">
                          <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold text-violet-800" title={note.reason ?? undefined}>
                            <FileMinus size={12} /> {note.number} · −{euro(note.totalInclVat)}
                          </span>
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <DocumentActions
                              pdfHref={`/api/credit-notes/${note.id}/pdf`}
                              peppolApplicable={invoice.peppolApplicable}
                              onSend={(channel) => setDelivery({ kind: "CREDIT_NOTE", document: note, invoice, channel })}
                              tone="border-violet-200 bg-white text-violet-900 hover:bg-violet-100"
                            />
                          </div>
                        </div>
                      ))}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {pagination.pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-dark-6">
          <span>
            Page {pagination.page} / {pagination.pageCount} · {pagination.total} factures
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => navigate({ page: pagination.page - 1 })}
              className="inline-flex items-center gap-1 rounded-lg border border-stroke px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-dark-3"
            >
              <ChevronLeft size={14} /> Précédente
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.pageCount}
              onClick={() => navigate({ page: pagination.page + 1 })}
              className="inline-flex items-center gap-1 rounded-lg border border-stroke px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-dark-3"
            >
              Suivante <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      <DocumentDeliveryDialog
        open={Boolean(delivery)}
        onClose={() => setDelivery(null)}
        document={delivery?.document ?? null}
        invoice={delivery?.invoice ?? null}
        kind={delivery?.kind ?? "INVOICE"}
        initialChannel={delivery?.channel ?? null}
        onDelivered={() => router.refresh()}
      />

      {/* A manual sale settled any other way: cash, card, or an acompte. */}
      <SettleManualInvoiceDialog sale={settling} onClose={() => setSettling(null)} onInvoiceIssued={setIssuedInvoice} />

      {/* The invoice the accepted payment just issued — offer to send it. */}
      <DocumentDeliveryDialog
        open={Boolean(issuedInvoice)}
        onClose={() => setIssuedInvoice(null)}
        document={issuedInvoice}
        invoice={issuedInvoice}
        kind="INVOICE"
      />

      {/* « Émettre la facture » on a rent: choose the channels, then issue + send. */}
      <DocumentDeliveryDialog
        open={Boolean(rentToIssue)}
        onClose={() => setRentToIssue(null)}
        document={rentToIssue?.draft ?? null}
        invoice={rentToIssue?.draft ?? null}
        kind="INVOICE"
        issue={issueRentNow}
        onIssued={() => router.refresh()}
        onDelivered={() => router.refresh()}
      />

      <CreditStaffRentDialog invoice={rentCreditFor} onClose={() => setRentCreditFor(null)} />

      {creditNoteFor && (
        <GenerateCreditNoteDialog
          open={Boolean(creditNoteFor)}
          paymentId={creditNoteFor.paymentId}
          onClose={() => setCreditNoteFor(null)}
          // The dialog refreshes the page itself: the row then shows the new
          // note's Voir / E-mail / Peppol in place of this button.
        />
      )}

    </div>
  );
}
