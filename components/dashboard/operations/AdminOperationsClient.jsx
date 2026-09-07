"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Package, CalendarDays, GraduationCap } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { InvoiceRowActions } from "@/components/dashboard/operations/InvoiceRowActions";
import { TransactionDetailDrawer } from "@/components/dashboard/operations/TransactionDetailDrawer";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import {
  TYPE_FILTERS,
  TYPE_LABELS,
  PAYMENT_EVENT_FILTERS,
  PAYMENT_EVENT_LABELS,
  LIFECYCLE_STATUS_FILTERS,
  LIFECYCLE_STATUS_LABELS,
} from "@/lib/dashboard/operation-filters";

const TABS = [
  { key: "transactions", label: "Transactions", icon: CreditCard },
  { key: "orders", label: "Commandes", icon: Package },
  { key: "workshops", label: "Ateliers & événements", icon: CalendarDays },
  { key: "formations", label: "Formations", icon: GraduationCap },
];

const money = (value) =>
  new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value ?? 0));

const date = (value) =>
  value
    ? new Date(value).toLocaleDateString("fr-BE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Brussels",
      })
    : "—";

const paymentSource = (payment) => {
  if (payment?.order) return `Commande n°${payment.order.orderNumber}`;
  if (payment?.workshopReservation) return `Atelier : ${payment.workshopReservation.session.workshop.title}`;
  if (payment?.formationReservation) return `Formation : ${payment.formationReservation.session.formation.title}`;
  if (payment?.appointment) return "Rendez-vous";
  return "—";
};

const paymentCustomer = (payment) =>
  payment?.order?.user ??
  payment?.workshopReservation?.customer ??
  payment?.formationReservation?.customer ??
  payment?.appointment?.user ??
  null;

// "Pas encore émise" implies pending — true for a customer who will get one
// once the payment settles, false for a particulier, who never does (see
// hasInvoiceableVatIdentity server-side). Conflating the two read as a
// standing error: the invoice looked perpetually "about to arrive".
function InvoiceStatus({ invoice, customerInvoiceEligible }) {
  const router = useRouter();
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  if (invoice) {
    const creditNotes = invoice.creditNotes ?? [];
    const creditedTotal = creditNotes.reduce((total, note) => total + Number(note.totalInclVat ?? 0), 0);
    const remainingToCredit = Math.max(0, Number(invoice.totalInclVat ?? 0) - creditedTotal);
    return (
      <div>
        <span className="font-medium text-gray-700">{invoice.number}</span>
        {invoice.emailSentAt ? (
          <span className="mt-1 block text-xs text-emerald-700">E-mail envoyé le {date(invoice.emailSentAt)}</span>
        ) : invoice.billitSentAt ? (
          <span className="mt-1 block text-xs text-blue-700">Créée dans Billit — à finaliser</span>
        ) : (
          <span className="mt-1 block text-xs text-amber-700">Non envoyée</span>
        )}
        {invoice.customerType === "B2B" && (
          <button
            type="button"
            onClick={() => setDeliveryOpen(true)}
            className="mt-2 inline-flex rounded-lg border border-[#2f3a2e] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#2f3a2e] hover:bg-[#f4f7f3]"
          >
            {invoice.emailSentAt || invoice.billitSentAt ? "Gérer l'envoi" : "Envoyer la facture"}
          </button>
        )}
        {creditNotes.length > 0 && (
          <span className="mt-1 block text-xs text-violet-700">
            Total notes de crédit : {money(creditedTotal)} — reste à créditer : {money(remainingToCredit)}
          </span>
        )}
        <DocumentDeliveryDialog
          open={deliveryOpen}
          onClose={() => setDeliveryOpen(false)}
          document={invoice}
          invoice={invoice}
          onDelivered={() => router.refresh()}
        />
      </div>
    );
  }
  if (customerInvoiceEligible) return <span className="text-xs text-gray-400">Pas encore émise</span>;
  return <span className="text-xs text-gray-400">Aucune (particulier)</span>;
}

function Badge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
      {children}
    </span>
  );
}

/**
 * Flattens the four polymorphic row shapes the unified query can return
 * (ORDER/WORKSHOP/FORMATION are entity-grained; APPOINTMENT stays
 * event-grained, one row per payment event, exactly as before unification —
 * see admin-operations.js's module doc comment) into one shape the table
 * renders generically. Mirrors TransactionDetailDrawer.jsx's describeSource,
 * one level up (a list row, not a single transaction's detail).
 */
function describeUnifiedRow(row) {
  if (row.sourceType === "ORDER") {
    return {
      dateLabel: date(row.createdAt),
      kind: "Commande",
      title: `n°${row.orderNumber}`,
      href: `/dashboard/boutique/orders/${row.id}`,
      detail: `${row.fulfilmentMode} · ${row._count.items} article(s)`,
      lifecycleStatus: row.status,
      customer: row.user,
      customerFallback: "Client de passage",
      totalAmount: row.totalAmount,
      isRefundEvent: false,
    };
  }
  if (row.sourceType === "WORKSHOP" || row.sourceType === "FORMATION") {
    const item = row.sourceType === "WORKSHOP" ? row.session.workshop : row.session.formation;
    const kind =
      row.sourceType === "WORKSHOP"
        ? item.type === "EVENT" ? "Événement" : "Atelier"
        : `Formation ${(TYPE_LABELS[item.type] ?? "").toLowerCase()}`.trim();
    return {
      dateLabel: date(row.session.startDate),
      kind,
      title: item.title,
      href: null,
      detail: `${row.seatsCount} place(s) · session du ${date(row.session.startDate)}`,
      lifecycleStatus: row.status,
      customer: row.customer,
      customerFallback: "—",
      totalAmount: row.totalPrice,
      isRefundEvent: false,
    };
  }
  // APPOINTMENT: not part of the entity-grained merge — this row IS a
  // Transaction, same shape the old Transactions tab rendered.
  const customer = paymentCustomer(row.payment);
  return {
    dateLabel: date(row.paidAt),
    kind: "Rendez-vous",
    title: paymentSource(row.payment),
    href: null,
    detail: row.method,
    lifecycleStatus: null,
    customer,
    customerFallback: "—",
    totalAmount: row.amount,
    isRefundEvent: row.transactionType === "REFUND",
  };
}

// The "Voir / gérer" drawer opens on a Transaction id. Entity-grained rows
// only have one once a real payment event exists (latestTransactionId);
// an appointment row already IS that transaction.
function latestTransaction(row) {
  if (row.sourceType === "APPOINTMENT") {
    return { id: row.id, transactionType: row.transactionType };
  }
  if (!row.latestTransactionId) return null;
  return { id: row.latestTransactionId, transactionType: row.latestTransactionType };
}

function paymentSummary(row) {
  const status = row.payment?.status ?? "—";
  const refunded = Number(row.refundState?.totalRefunded ?? 0);
  if (refunded > 0.01) {
    return (
      <>
        {status}
        <span className="mt-1 block text-red-600">− {money(refunded)} remboursé</span>
      </>
    );
  }
  return status;
}

function UnifiedOperationsTable({ rows, onOpenDetail }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Date</TableHead>
          <TableHead>Origine</TableHead>
          <TableHead>Détail</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>N° TVA</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>Paiement</TableHead>
          <TableHead>Facture</TableHead>
          <TableHead className="text-right">Montant</TableHead>
          <TableHead className="pr-6 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const described = describeUnifiedRow(row);
          const customer = described.customer;
          const invoice = row.payment?.invoice ?? null;
          // The invoice freezes the VAT number at issue time (Belgian
          // invoicing rules require a snapshot, not a live join) — prefer it
          // once it exists, and fall back to the customer's current profile
          // for a row that hasn't been invoiced yet.
          const vatNumber = invoice?.customerVatNumber ?? customer?.vatNumber ?? null;
          const transaction = latestTransaction(row);
          return (
            <TableRow key={row.id}>
              <TableCell className="pl-6">{described.dateLabel}</TableCell>
              <TableCell>
                {described.href ? (
                  <Link href={described.href} className="font-medium text-[#2f3a2e] hover:underline">
                    {described.kind} {described.title}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-900">
                    {described.kind} — {described.title}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-xs text-gray-500">{described.detail}</TableCell>
              <TableCell>
                {customer?.fullName ?? described.customerFallback}
                <span className="block text-xs text-gray-400">{customer?.email ?? ""}</span>
              </TableCell>
              <TableCell>
                {vatNumber ? (
                  <span className="font-medium text-gray-700">{vatNumber}</span>
                ) : (
                  <span className="text-xs text-gray-400">Particulier</span>
                )}
              </TableCell>
              <TableCell>
                {described.lifecycleStatus ? (
                  <Badge>{LIFECYCLE_STATUS_LABELS[described.lifecycleStatus] ?? described.lifecycleStatus}</Badge>
                ) : (
                  <Badge>{PAYMENT_EVENT_LABELS[row.transactionType] ?? row.transactionType}</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-gray-500">{paymentSummary(row)}</TableCell>
              <TableCell>
                <InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />
              </TableCell>
              <TableCell className={`text-right font-medium ${described.isRefundEvent ? "text-red-600" : ""}`}>
                {described.isRefundEvent ? "−" : ""}
                {money(described.totalAmount)}
              </TableCell>
              <TableCell className="pr-6">
                <InvoiceRowActions
                  invoice={invoice}
                  creditNotes={invoice?.creditNotes ?? []}
                  transaction={transaction ? { ...transaction, hasInvoice: Boolean(invoice) } : null}
                  paymentId={row.payment?.id ?? null}
                  remainingRefundable={row.refundState?.remainingRefundable ?? null}
                  onOpenDetail={transaction ? () => onOpenDetail(transaction.id) : undefined}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * One filter axis rendered as a row of pill links — "Tous" plus one pill per
 * whitelisted value for the current tab. A `<Link>`, not a client-side
 * toggle: the filter has to survive a page reload / a bookmarked URL / the
 * back button exactly like the tab and the page number already do.
 */
function FilterPills({ label, options, labels, active, buildHref }) {
  if (!options?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 text-xs">
      <span className="font-medium text-gray-400">{label}</span>
      <Link
        href={buildHref("ALL")}
        className={`rounded-full px-2.5 py-1 font-medium ${
          active === "ALL" ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
        }`}
      >
        Tous
      </Link>
      {options.map((value) => (
        <Link
          key={value}
          href={buildHref(value)}
          className={`rounded-full px-2.5 py-1 font-medium ${
            active === value ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-600 hover:bg-gray-100"
          }`}
        >
          {labels[value] ?? value}
        </Link>
      ))}
    </div>
  );
}

export function AdminOperationsClient({ result }) {
  const {
    tab = "transactions",
    data = [],
    page = 1,
    pageSize = 30,
    totalCount = 0,
    type = "ALL",
    lifecycleStatus = "ALL",
    paymentEvent = "ALL",
  } = result ?? {};
  const [detailId, setDetailId] = useState(null);

  const hasPrevious = page > 1;
  const hasNext = page * pageSize < totalCount;

  // "Commandes / Ateliers & événements / Formations" are presets — a
  // sourceTypes restriction over the SAME unified query (see
  // OPERATION_PRESETS) — not separate queries, so every row on every tab
  // gets the same columns and the same Actions capability. Switching tab
  // resets every filter: "Atelier" isn't a meaningful value once you're
  // looking at Commandes, and carrying it over silently would make the next
  // tab look empty for no visible reason.
  function href({
    nextTab = tab,
    nextPage = 1,
    nextType = tab === nextTab ? type : "ALL",
    nextLifecycleStatus = tab === nextTab ? lifecycleStatus : "ALL",
    nextPaymentEvent = tab === nextTab ? paymentEvent : "ALL",
  } = {}) {
    const search = new URLSearchParams({ tab: nextTab, page: String(nextPage) });
    if (nextType !== "ALL") search.set("type", nextType);
    if (nextLifecycleStatus !== "ALL") search.set("lifecycleStatus", nextLifecycleStatus);
    if (nextPaymentEvent !== "ALL") search.set("paymentEvent", nextPaymentEvent);
    return `/dashboard/operations?${search.toString()}`;
  }

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-wrap gap-2 border-b border-stroke px-4 py-3">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={href({ nextTab: key })}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === key ? "bg-[#2f3a2e] text-white" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Icon size={15} />
            {label}
          </Link>
        ))}
      </div>

      {/* Three independent axes now that the tabs share one query: "type"
          still only matters for atelier/événement and formation
          privée/publique; "payment event" (acompte/solde/remboursement) is
          meaningful on every row everywhere, unlike the old status slot that
          only existed on the Transactions tab; "status" is each source's own
          lifecycle (a merged list when nothing restricts sourceType). None
          renders when it has nothing to offer on the current tab. */}
      <FilterPills
        label="Type"
        options={TYPE_FILTERS[tab]}
        labels={TYPE_LABELS}
        active={type}
        buildHref={(value) => href({ nextType: value })}
      />
      <FilterPills
        label="Type de paiement"
        options={PAYMENT_EVENT_FILTERS}
        labels={PAYMENT_EVENT_LABELS}
        active={paymentEvent}
        buildHref={(value) => href({ nextPaymentEvent: value })}
      />
      <FilterPills
        label="Statut"
        options={LIFECYCLE_STATUS_FILTERS[tab === "transactions" ? "all" : tab]}
        labels={LIFECYCLE_STATUS_LABELS}
        active={lifecycleStatus}
        buildHref={(value) => href({ nextLifecycleStatus: value })}
      />

      <div className="border-b border-t border-stroke px-6 py-3 text-sm text-gray-500">
        {totalCount} élément{totalCount > 1 ? "s" : ""} · page {page}
      </div>

      {/* Wide now that every source's columns are merged into one table —
          it scrolls inside its own container rather than pushing the
          dashboard sideways. */}
      <div className="overflow-x-auto">
        {data.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">Aucune donnée dans cette catégorie.</div>
        ) : (
          <UnifiedOperationsTable rows={data} onOpenDetail={setDetailId} />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-stroke px-6 py-4 text-sm">
        <Link
          href={href({ nextPage: page - 1 })}
          aria-disabled={!hasPrevious}
          className={!hasPrevious ? "pointer-events-none text-gray-300" : "font-medium text-[#2f3a2e] hover:underline"}
        >
          Précédent
        </Link>
        <Link
          href={href({ nextPage: page + 1 })}
          aria-disabled={!hasNext}
          className={!hasNext ? "pointer-events-none text-gray-300" : "font-medium text-[#2f3a2e] hover:underline"}
        >
          Suivant
        </Link>
      </div>

      <TransactionDetailDrawer transactionId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
