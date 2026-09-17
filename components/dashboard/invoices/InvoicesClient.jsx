"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, FileMinus, FilePlus2, Mail, RotateCcw, Search, Send } from "lucide-react";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { GenerateCreditNoteDialog } from "@/components/dashboard/operations/GenerateCreditNoteDialog";
import { INVOICE_SOURCE_LABELS } from "@/lib/invoices/list-filters";

/**
 * Factures — every issued invoice in one list with Voir / E-mail / Peppol.
 * A credit note is not a row of its own: once generated, its Voir / E-mail /
 * Peppol buttons take the place of the "Note de crédit" button. Sending
 * reuses the Opérations delivery card and the credit note reuses its
 * "Générer une note de crédit" flow. No delete, on purpose: see
 * actions/dashboard/invoices.js.
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

const actionButton =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";

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
      <a href={pdfHref} target="_blank" rel="noopener noreferrer" className={`${actionButton} ${tone}`}>
        <Eye size={13} /> Voir
      </a>
      <button type="button" onClick={() => onSend("EMAIL")} className={`${actionButton} ${tone}`}>
        <Mail size={13} /> E-mail
      </button>
      {peppolApplicable && (
        <button type="button" onClick={() => onSend("PEPPYRUS")} className={`${actionButton} ${tone}`}>
          <Send size={13} /> Peppol
        </button>
      )}
    </>
  );
}

export function InvoicesClient({ data }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { filters, rows, pagination, stats } = data;

  const [draft, setDraft] = useState(filters);
  const [delivery, setDelivery] = useState(null); // { kind, document, invoice, channel }
  const [creditNoteFor, setCreditNoteFor] = useState(null); // invoice row

  useEffect(() => setDraft(filters), [filters]);

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
              <th className="px-4 py-3">Envoi</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                  Aucune facture ne correspond à ces filtres.
                </td>
              </tr>
            )}
            {rows.map((invoice) => {
              const noteCount = invoice.creditNotes.length;
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
                      <DeliveryCell doc={invoice} peppolApplicable={invoice.peppolApplicable} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5 whitespace-nowrap">
                        <DocumentActions
                          pdfHref={`/api/invoices/${invoice.id}/pdf`}
                          peppolApplicable={invoice.peppolApplicable}
                          onSend={(channel) => setDelivery({ kind: "INVOICE", document: invoice, invoice, channel })}
                          tone="border-[#2f3a2e] text-[#2f3a2e] hover:bg-[#f4f7f3]"
                        />
                        {noteCount === 0 && (
                          <button
                            type="button"
                            onClick={() => setCreditNoteFor(invoice)}
                            disabled={!invoice.canGenerateCreditNote}
                            title={invoice.canGenerateCreditNote ? "Générer une note de crédit" : invoice.creditNoteBlockedReason ?? undefined}
                            className={`${actionButton} border-amber-300 text-amber-800 hover:bg-amber-50`}
                          >
                            <FilePlus2 size={13} /> Note de crédit
                          </button>
                        )}
                      </div>
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
