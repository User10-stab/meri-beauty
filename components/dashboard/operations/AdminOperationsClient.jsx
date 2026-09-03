"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, Package, CalendarDays, GraduationCap } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { InvoiceRowActions } from "@/components/dashboard/operations/InvoiceRowActions";
import { TransactionDetailDrawer } from "@/components/dashboard/operations/TransactionDetailDrawer";
import { TYPE_FILTERS, TYPE_LABELS, STATUS_FILTERS, STATUS_LABELS } from "@/lib/dashboard/operation-filters";

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
        {creditNotes.length > 0 && (
          <span className="mt-1 block text-xs text-violet-700">
            Total notes de crédit : {money(creditedTotal)} — reste à créditer : {money(remainingToCredit)}
          </span>
        )}
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

function Transactions({ rows, onOpenDetail }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Date</TableHead>
          <TableHead>Origine</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>N° TVA</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Facture</TableHead>
          <TableHead className="text-right">Montant</TableHead>
          <TableHead className="pr-6 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const customer = paymentCustomer(row.payment);
          const invoice = row.payment?.invoice ?? null;
          // The invoice freezes the VAT number at issue time (Belgian
          // invoicing rules require a snapshot, not a live join) — prefer it
          // once it exists, and fall back to the customer's current profile
          // for a transaction that hasn't been invoiced yet.
          const vatNumber = invoice?.customerVatNumber ?? customer?.vatNumber ?? null;
          // A refund is money leaving, not coming in — Transaction.amount is
          // always stored as a positive magnitude (the codebase-wide
          // convention: callers sum REFUND rows and subtract), so the sign
          // has to be flipped here, at display time, rather than in storage.
          const isRefund = row.transactionType === "REFUND";
          return (
            <TableRow key={row.id}>
              <TableCell className="pl-6">{date(row.paidAt)}</TableCell>
              <TableCell>{paymentSource(row.payment)}</TableCell>
              <TableCell>
                {customer?.fullName ?? "—"}
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
                <Badge>{STATUS_LABELS[row.transactionType] ?? row.transactionType}</Badge>
                <span className="mt-1 block text-xs text-gray-400">{row.method}</span>
              </TableCell>
              <TableCell>
                <InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />
              </TableCell>
              <TableCell className={`text-right font-medium ${isRefund ? "text-red-600" : ""}`}>
                {isRefund ? "−" : ""}
                {money(row.amount)}
              </TableCell>
              <TableCell className="pr-6">
                <InvoiceRowActions
                  invoice={invoice}
                  creditNotes={invoice?.creditNotes ?? []}
                  transaction={{ id: row.id, transactionType: row.transactionType, hasInvoice: Boolean(invoice) }}
                  orderId={row.payment?.order?.id ?? null}
                  paymentId={row.payment?.id ?? null}
                  remainingRefundable={row.refundState?.remainingRefundable ?? null}
                  onOpenDetail={() => onOpenDetail(row.id)}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Orders({ rows }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Commande</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Retrait / livraison</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>Paiement</TableHead>
          <TableHead className="pr-6 text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="pl-6">
              <Link
                href={`/dashboard/boutique/orders/${row.id}`}
                className="font-medium text-[#2f3a2e] hover:underline"
              >
                n°{row.orderNumber}
              </Link>
              <span className="block text-xs text-gray-400">
                {date(row.createdAt)} · {row._count.items} article(s)
              </span>
            </TableCell>
            <TableCell>
              {row.user?.fullName ?? "Client de passage"}
              <span className="block text-xs text-gray-400">{row.user?.email ?? "—"}</span>
            </TableCell>
            <TableCell>{row.fulfilmentMode}</TableCell>
            <TableCell>
              <Badge>{STATUS_LABELS[row.status] ?? row.status}</Badge>
            </TableCell>
            <TableCell>{row.payment?.status ?? "En attente"}</TableCell>
            <TableCell className="pr-6 text-right font-medium">{money(row.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Reservations({ rows, kind }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{kind === "workshops" ? "Atelier / événement" : "Formation"}</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Places</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>Facture</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="pr-6 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const item = kind === "workshops" ? row.session.workshop : row.session.formation;
          const invoice = row.payment?.invoice ?? null;
          return (
            <TableRow key={row.id}>
              <TableCell className="pl-6 font-medium">
                {item.title}
                <span className="mt-1 block">
                  <Badge>{TYPE_LABELS[item.type] ?? item.type}</Badge>
                </span>
              </TableCell>
              <TableCell>
                {row.customer.fullName}
                <span className="block text-xs text-gray-400">{row.customer.email}</span>
              </TableCell>
              <TableCell>{date(row.session.startDate)}</TableCell>
              <TableCell>{row.seatsCount}</TableCell>
              <TableCell>
                <Badge>{STATUS_LABELS[row.status] ?? row.status}</Badge>
                <span className="mt-1 block text-xs text-gray-400">
                  {row.payment?.status ?? "Paiement en attente"}
                </span>
              </TableCell>
              <TableCell>
                <InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />
              </TableCell>
              <TableCell className="text-right font-medium">{money(row.totalPrice)}</TableCell>
              <TableCell className="pr-6">
                <InvoiceRowActions invoice={invoice} creditNotes={invoice?.creditNotes ?? []} paymentId={row.payment?.id ?? null} />
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
    status = "ALL",
  } = result ?? {};
  const [detailId, setDetailId] = useState(null);

  const hasPrevious = page > 1;
  const hasNext = page * pageSize < totalCount;

  // Switching tab resets both filters — "Atelier" isn't a meaningful value
  // once you're looking at Commandes, and carrying it over silently would
  // make the next tab look empty for no visible reason.
  function href({ nextTab = tab, nextPage = 1, nextType = tab === nextTab ? type : "ALL", nextStatus = tab === nextTab ? status : "ALL" } = {}) {
    const search = new URLSearchParams({ tab: nextTab, page: String(nextPage) });
    if (nextType !== "ALL") search.set("type", nextType);
    if (nextStatus !== "ALL") search.set("status", nextStatus);
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

      {/* Only the "type" axis distinguishes rows that otherwise look
          identical until read closely — atelier vs. événement, formation
          publique vs. privée. Status is the second, universally useful cut
          (e.g. isolating annulées). Neither renders on a tab with nothing to
          filter (Commandes has no type filter — its own status list already
          does the same job the other tabs split into two). */}
      <FilterPills
        label="Type"
        options={TYPE_FILTERS[tab]}
        labels={TYPE_LABELS}
        active={type}
        buildHref={(value) => href({ nextType: value })}
      />
      <FilterPills
        label={tab === "transactions" ? "Type de paiement" : "Statut"}
        options={STATUS_FILTERS[tab]}
        labels={STATUS_LABELS}
        active={status}
        buildHref={(value) => href({ nextStatus: value })}
      />

      <div className="border-b border-t border-stroke px-6 py-3 text-sm text-gray-500">
        {totalCount} élément{totalCount > 1 ? "s" : ""} · page {page}
      </div>

      {/* Wide now that the actions column exists — the table scrolls inside
          its own container rather than pushing the dashboard sideways. */}
      <div className="overflow-x-auto">
        {data.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">Aucune donnée dans cette catégorie.</div>
        ) : tab === "transactions" ? (
          <Transactions rows={data} onOpenDetail={setDetailId} />
        ) : tab === "orders" ? (
          <Orders rows={data} />
        ) : (
          <Reservations rows={data} kind={tab} />
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
