"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, CreditCard, Package, CalendarDays, GraduationCap, X, Eye } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { InvoiceRowActions } from "@/components/dashboard/operations/InvoiceRowActions";
import { TransactionDetailDrawer } from "@/components/dashboard/operations/TransactionDetailDrawer";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";
import { CancelAndRefundDialog } from "@/components/dashboard/operations/CancelAndRefundDialog";
import { getTransferDetail } from "@/actions/dashboard/admin-operations";
import { collectibleBalance } from "@/lib/payments/collectible-balance";
import {
  TYPE_FILTERS,
  TYPE_LABELS,
  PAYMENT_EVENT_FILTERS,
  PAYMENT_EVENT_LABELS,
  LIFECYCLE_STATUS_FILTERS,
  LIFECYCLE_STATUS_LABELS,
  performedByLabel,
  PAYMENT_STATUS_LABELS,
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

const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("fr-BE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Brussels",
      })
    : "—";

function transferPriceImpact(row) {
  if (row.priceDecision === "KEEP_CURRENT_PRICE" && row.waivedAmount > 0.01) {
    return `${money(row.waivedAmount)} offert par le salon`;
  }
  if (row.finalTotal > row.previousTotal + 0.01) {
    return `${money(row.finalTotal - row.previousTotal)} ajouté au solde`;
  }
  if (row.finalTotal < row.previousTotal - 0.01) {
    return `${money(row.previousTotal - row.finalTotal)} retiré du solde`;
  }
  return "Prix inchangé";
}

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
        ) : invoice.peppyrusSentAt ? (
          <span className="mt-1 block text-xs text-emerald-700">Envoyée via Peppol le {date(invoice.peppyrusSentAt)}</span>
        ) : (
          <span className="mt-1 block text-xs text-amber-700">Non envoyée</span>
        )}
        {invoice.customerType === "B2B" && (
          <button
            type="button"
            onClick={() => setDeliveryOpen(true)}
            className="mt-2 inline-flex rounded-lg border border-[#2f3a2e] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#2f3a2e] hover:bg-[#f4f7f3]"
          >
            {invoice.emailSentAt || invoice.peppyrusSentAt ? "Gérer l'envoi" : "Envoyer la facture"}
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
 * Flattens the polymorphic row shapes the unified query can return
 * (ORDER/WORKSHOP/FORMATION are entity-grained; APPOINTMENT stays
 * event-grained, one row per payment event, exactly as before unification —
 * see admin-operations.js's module doc comment) into one shape the table
 * renders generically. Mirrors TransactionDetailDrawer.jsx's describeSource,
 * one level up (a list row, not a single transaction's detail).
 */
function describeUnifiedRow(row) {
  if (row.sourceType === "TRANSFER") {
    const by = row.actorName ? ` · par ${row.actorName}` : "";
    const why = row.reason ? ` · Motif : ${row.reason}` : "";
    const oldDate = row.previousSessionDate ? date(row.previousSessionDate) : "date inconnue";
    const newDate = row.newSessionDate ? date(row.newSessionDate) : "date inconnue";
    return {
      dateLabel: date(row.transferredAt),
      kind: "Transfert de réservation",
      title: `${row.previousActivityTitle} → ${row.newActivityTitle}`,
      href: null,
      detail: `${oldDate} → ${newDate} · ${transferPriceImpact(row)}${why}${by}`,
      lifecycleStatus: row.status,
      customer: row.customer,
      customerFallback: "—",
      totalAmount: 0,
      amountLabel: "—",
      amountNote: "Aucun mouvement financier",
      isRefundEvent: false,
    };
  }
  if (row.sourceType === "ADJUSTMENT") {
    // A price changed at the counter. Every other row here is anchored to
    // money that moved; this one is money the salon decided *not* to take —
    // writing off a balance on a booking that had already paid its deposit,
    // for instance. It used to exist only in the audit log, so the one screen
    // anyone reconciles against never showed it.
    //
    // Not a refund, and deliberately not styled as one: nothing leaves the
    // till, so isRefundEvent stays false. The amount is the signed difference,
    // which is what the event is actually worth; the before → after pair sits
    // in the detail line so the figure can be checked rather than trusted.
    const money = (value) =>
      new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
    const by = row.actorName ? ` · par ${row.actorName}` : "";
    const why = row.reason ? ` · ${row.reason}` : "";
    return {
      dateLabel: date(row.adjustedAt),
      kind: "Ajustement de prix",
      title: `${row.bookingKind} — ${row.bookingTitle}`,
      href: null,
      detail: `${money(row.previousTotal)} → ${money(row.finalTotal)}${why}${by}`,
      lifecycleStatus: row.status,
      customer: row.customer,
      customerFallback: "—",
      totalAmount: row.delta,
      isRefundEvent: false,
    };
  }
  if (row.sourceType === "ORDER") {
    // performedBy is null (not undefined) for a genuine self-service
    // order — worth its own explicit label rather than looking like the
    // attribution was simply never loaded.
    const performed = performedByLabel(row.performedBy) ?? "Achat en ligne (client)";
    return {
      dateLabel: date(row.latestTransactionAt ?? row.createdAt),
      kind: "Commande",
      title: `n°${row.orderNumber}`,
      href: `/dashboard/boutique/orders/${row.id}`,
      detail: `${row.fulfilmentMode} · ${row._count.items} article(s) · ${performed}`,
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
    // Same animator→staff-account bridge as formations (see
    // resolveStaffByEmails in admin-operations.js) — null only when the
    // session has no animator, or the animator isn't a real staff account.
    const performed = performedByLabel(row.performedBy);
    return {
      dateLabel: date(row.latestTransactionAt ?? row.createdAt),
      kind,
      title: item.title,
      href: null,
      detail: `${row.seatsCount} place(s) · session du ${date(row.session.startDate)}${performed ? ` · ${performed}` : ""}`,
      lifecycleStatus: row.status,
      customer: row.customer,
      customerFallback: "—",
      totalAmount: row.totalPrice,
      isRefundEvent: false,
    };
  }
  if (row.sourceType === "APPOINTMENT") {
    // APPOINTMENT: not part of the entity-grained merge — this row IS a
    // Transaction, same shape the old Transactions tab rendered.
    const customer = paymentCustomer(row.payment);
    const performed = performedByLabel(row.performedBy);
    return {
      dateLabel: date(row.paidAt),
      kind: "Rendez-vous",
      title: paymentSource(row.payment) ?? "Paiement",
      href: null,
      detail: `${PAYMENT_EVENT_LABELS[row.transactionType] ?? row.transactionType ?? "Opération"} · ${row.method ?? "—"}${performed ? ` · ${performed}` : ""}`,
      lifecycleStatus: row.payment?.appointment?.status ?? null,
      customer,
      customerFallback: "—",
      totalAmount: row.amount,
      isRefundEvent: row.transactionType === "REFUND",
    };
  }

  if (row.sourceType === "STAFF_RENT") {
    // A staff member's rent: the transfer « Accepter » recorded (or the
    // refund a credit note recorded) — the salon's own income.
    const invoice = row.payment?.invoice ?? null;
    const reference = row.manualReference ? ` · réf. ${row.manualReference}` : "";
    const due = invoice?.dueDate ? ` · échéance ${date(invoice.dueDate)}` : "";
    return {
      dateLabel: date(row.paidAt),
      kind: "Loyer staff",
      title: invoice?.number ?? "Loyer",
      href: invoice?.number ? `/dashboard/factures?q=${encodeURIComponent(invoice.number)}` : "/dashboard/factures",
      detail: `${PAYMENT_EVENT_LABELS[row.transactionType] ?? row.transactionType} · Virement${reference}${due}`,
      lifecycleStatus: null,
      customer: row.staffMember,
      customerFallback: "—",
      totalAmount: row.amount,
      isRefundEvent: row.transactionType === "REFUND",
    };
  }

  // A stale browser can briefly receive a row type added by a newer server
  // during a deployment. Never render internal `undefined` values: keep the
  // row readable and tell the operator how to load its dedicated renderer.
  return {
    dateLabel: date(row.createdAt ?? row.paidAt),
    kind: "Opération",
    title: "Actualisation requise",
    href: null,
    detail: "Actualisez la page pour afficher le détail de cette opération.",
    lifecycleStatus: row.status ?? null,
    customer: row.customer ?? null,
    customerFallback: "Client non chargé",
    totalAmount: 0,
    amountLabel: "—",
    isRefundEvent: false,
  };
}

// The "Voir / gérer" drawer opens on a Transaction id. Entity-grained rows
// only have one once a real payment event exists (latestTransactionId);
// an appointment row already IS that transaction.
function latestTransaction(row) {
  if (row.operationOnly) return null;
  if (row.sourceType === "APPOINTMENT") {
    return { id: row.id, transactionType: row.transactionType };
  }
  if (!row.latestTransactionId) return null;
  return { id: row.latestTransactionId, transactionType: row.latestTransactionType };
}

/**
 * The row's payment state, in the salon's own language.
 *
 * Two things were wrong here. It rendered `row.payment.status` raw, so this
 * column showed "REFUNDED" and "PARTIALLY_REFUNDED" — Prisma enum values, in
 * English, in a French table — which reads as debug output rather than as a
 * status, and left the "Règlement" badges beside it looking like the only
 * statement of where the row stood.
 *
 * And it took the refunded total from `row.refundState.totalRefunded`, which
 * only the order/workshop/formation hydrators supply. Appointment rows carry
 * a different `refundState` (admin-operations.js builds them per transaction,
 * not per entity), so that read was permanently undefined for a rendez-vous
 * and the refund line silently never appeared on one. Summing the row's own
 * transactions works for every source.
 */
function paymentSummary(row) {
  const status = row.payment?.status;
  const label = status ? PAYMENT_STATUS_LABELS[status] ?? status : "—";

  const transactions = (row.payment?.transactions ?? []).filter((transaction) => !transaction.isDeleted);
  const refunded = transactions
    .filter((transaction) => transaction.transactionType === "REFUND")
    .reduce((total, transaction) => total + Number(transaction.amount ?? 0), 0);

  // Only when it adds something. On a fully refunded payment the status
  // already says "Remboursé" and repeating the figure underneath it is the
  // noise that made this column ambiguous in the first place.
  const worthShowing = refunded > 0.01 && status !== "REFUNDED";
  if (!worthShowing) return label;

  return (
    <>
      {label}
      <span className="mt-1 block text-red-600">− {money(refunded)} remboursé</span>
    </>
  );
}

/**
 * A payment status (PAID/PARTIALLY_PAID) answers whether money is still due,
 * but it does not tell the salon what the money on this row represents. Make
 * the installment history readable directly in the ledger: a booking can
 * carry an online deposit followed by an in-salon balance, while a normal
 * boutique sale has one full payment.
 */
function PaymentBreakdown({ row }) {
  const payment = row.payment;
  if (!payment) return <span className="text-xs text-gray-400">Aucun paiement</span>;

  const transactions = (payment.transactions ?? []).filter((transaction) => !transaction.isDeleted);
  const deposits = transactions.filter((transaction) => transaction.transactionType === "DEPOSIT");
  const finalPayments = transactions.filter((transaction) => transaction.transactionType === "FINAL_PAYMENT");
  const changeFees = finalPayments.filter((transaction) => ["SESSION_CHANGE_FEE", "SEATS_CHANGE_FEE"].includes(transaction.manualReference));
  const balances = finalPayments.filter((transaction) => !["SESSION_CHANGE_FEE", "SEATS_CHANGE_FEE"].includes(transaction.manualReference));
  const refunds = transactions.filter((transaction) => transaction.transactionType === "REFUND");
  const sum = (items) => items.reduce((total, item) => total + Number(item.amount ?? 0), 0);
  // Before the transaction marker existed, session/seat-change fees were
  // recorded as FINAL_PAYMENT rows. The reservation keeps their total, so
  // use it to separate that historical amount from the actual balance too.
  const taggedChangeFeeTotal = sum(changeFees);
  const historicalChangeFeeTotal = Math.max(0, Number(row.changeFeeAmount ?? 0) - taggedChangeFeeTotal);
  const balanceTotal = Math.max(0, sum(balances) - historicalChangeFeeTotal);
  const changeFeeTotal = taggedChangeFeeTotal + historicalChangeFeeTotal;
  const hasDeposit = deposits.length > 0;
  // remainingAmount is the original payment-plan balance. It deliberately
  // survives as an audit trail even after an operation is cancelled/refunded,
  // so it must not be presented to staff as money still owed in that state —
  // that rule lives in lib/payments/collectible-balance.js, shared with the
  // customer reservation list, the calendar drawer and the detail drawer.
  const outstandingBalance = collectibleBalance({
    remainingAmount: payment.remainingAmount,
    paymentStatus: payment.status,
    lifecycleStatus: row.status ?? payment.appointment?.status,
  });

  if (deposits.length === 0 && finalPayments.length === 0 && refunds.length === 0) {
    return outstandingBalance > 0.01 ? (
      <span className="text-xs font-medium text-amber-700">À encaisser : {money(outstandingBalance)}</span>
    ) : (
      <span className="text-xs text-gray-400">Aucun encaissement</span>
    );
  }

  // This column is a record of what money *moved*, not a status — which is
  // why a refunded row legitimately still shows what was collected: dropping
  // it would erase the fact that 45 € was ever taken, and the books need it.
  //
  // But a green "Paiement complet · 45,00 €" sitting beside a red
  // "Remboursé · 45,00 €" gives no clue that the two cancel out, and staff
  // read the pair as the row's state. So once nothing is left, the
  // collections are shown as spent rather than current, and the net is
  // stated outright.
  const collectedTotal = sum(deposits) + balanceTotal + changeFeeTotal;
  const refundedTotal = sum(refunds);
  const netCollected = collectedTotal - refundedTotal;
  const fullyRefunded = refundedTotal > 0.01 && netCollected <= 0.01;
  const spent = fullyRefunded ? "opacity-60 line-through decoration-1" : "";

  return (
    <div className="flex min-w-44 flex-col items-start gap-1">
      <div className="flex flex-wrap gap-1">
        {deposits.length > 0 && (
          <span className={`inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ${spent}`}>
            Acompte · {money(sum(deposits))}
          </span>
        )}
        {balanceTotal > 0.01 && (
          <span className={`inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ${spent}`}>
            {hasDeposit ? "Solde" : "Paiement complet"} · {money(balanceTotal)}
          </span>
        )}
        {changeFeeTotal > 0.01 && (
          <span className={`inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800 ${spent}`}>
            Frais de modification · {money(changeFeeTotal)}
          </span>
        )}
        {refunds.length > 0 && (
          <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
            Remboursé · {money(refundedTotal)}
          </span>
        )}
      </div>
      {fullyRefunded && (
        <span className="text-xs font-medium text-gray-500">Net encaissé : {money(0)}</span>
      )}
      {/* A partial refund is the case where the arithmetic is genuinely hard
          to do at a glance, so it is the one that most needs stating. */}
      {!fullyRefunded && refundedTotal > 0.01 && (
        <span className="text-xs font-medium text-gray-600">Net encaissé : {money(netCollected)}</span>
      )}
      {outstandingBalance > 0.01 && (
        <span className="text-xs font-medium text-amber-700">Solde à encaisser : {money(outstandingBalance)}</span>
      )}
    </div>
  );
}

function TransferDetailModal({ transfer, onClose }) {
  const router = useRouter();
  const [deliveryDocument, setDeliveryDocument] = useState(null);
  if (!transfer) return null;

  const replacement = transfer.invoiceReplacement;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgba(47,58,46,0.08)]">
              <ArrowRightLeft size={19} className="text-[#2f3a2e]" />
            </div>
            <div>
              <h2 id="transfer-detail-title" className="text-lg font-bold text-gray-900">Détail du transfert</h2>
              <p className="text-sm text-gray-500">{dateTime(transfer.transferredAt)}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Ancienne réservation</p>
            <p className="mt-2 font-semibold text-gray-900">{transfer.previousActivityTitle}</p>
            <p className="mt-1 text-sm text-gray-600">{dateTime(transfer.previousSessionDate)}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Nouvelle réservation</p>
            <p className="mt-2 font-semibold text-gray-900">{transfer.newActivityTitle}</p>
            <p className="mt-1 text-sm text-gray-600">{dateTime(transfer.newSessionDate)}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 rounded-xl border border-gray-200 p-4 sm:grid-cols-4">
          <div><p className="text-xs text-gray-500">Total</p><p className="mt-1 font-semibold">{money(transfer.finalTotal)}</p></div>
          <div><p className="text-xs text-gray-500">Déjà payé</p><p className="mt-1 font-semibold">{money(transfer.paidAmount)}</p></div>
          <div><p className="text-xs text-gray-500">Solde restant</p><p className="mt-1 font-semibold">{money(transfer.balanceDue)}</p></div>
          <div><p className="text-xs text-gray-500">Frais de transfert</p><p className="mt-1 font-semibold">{money(transfer.modificationFee)}</p></div>
        </div>

        <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4 text-sm">
          <p><span className="font-medium text-gray-700">Impact tarifaire :</span> {transferPriceImpact(transfer)}</p>
          <p><span className="font-medium text-gray-700">Motif :</span> {transfer.reason || "—"}</p>
          <p><span className="font-medium text-gray-700">Effectué par :</span> {transfer.actorName || "Administrateur"}</p>
          {replacement ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>
                  Ancienne facture n°{replacement.previousInvoice.number} annulée par la note de crédit n°
                  {replacement.creditNote.number}.
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/invoices/${replacement.previousInvoice.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Facture (PDF)
                  </a>
                  <a
                    href={`/api/credit-notes/${replacement.creditNote.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Note de crédit (PDF)
                  </a>
                  <button
                    type="button"
                    onClick={() => setDeliveryDocument({ kind: "CREDIT_NOTE", document: replacement.creditNote, invoice: replacement.previousInvoice })}
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    Envoyer la note de crédit
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                {replacement.newInvoice ? (
                  <>
                    <p>Nouvelle facture n°{replacement.newInvoice.number} émise.</p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/invoices/${replacement.newInvoice.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Facture (PDF)
                      </a>
                      <button
                        type="button"
                        onClick={() => setDeliveryDocument({ kind: "INVOICE", document: replacement.newInvoice, invoice: replacement.newInvoice })}
                        className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Envoyer la facture
                      </button>
                    </div>
                  </>
                ) : (
                  <p>Nouvelle facture en attente — sera émise à la clôture, une fois le solde encaissé.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="font-medium text-gray-600">Aucun encaissement ni remboursement n’a été déclenché par ce transfert.</p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white hover:bg-[#263025]">
            Fermer
          </button>
        </div>
      </div>
      <DocumentDeliveryDialog
        open={Boolean(deliveryDocument)}
        onClose={() => setDeliveryDocument(null)}
        document={deliveryDocument?.document ?? null}
        invoice={deliveryDocument?.invoice ?? null}
        kind={deliveryDocument?.kind ?? "INVOICE"}
        onDelivered={() => router.refresh()}
      />
    </div>
  );
}

/**
 * A Workshop/Formation row's link to "why did this change" — the transfer
 * that moved it here. Self-contained (own fetch, own modal instance) rather
 * than threaded through UnifiedOperationsTable's props: the transfer this
 * points at may not be one of the current page's own 30 hydrated rows (a
 * different tab, filter, or page of pagination), so it always fetches fresh
 * via getTransferDetail instead of assuming the data is already on hand —
 * same reasoning as InvoiceStatus owning its own DocumentDeliveryDialog above.
 */
function TransferCrossLink({ logId, transferredAt }) {
  const [transfer, setTransfer] = useState(null);
  const [loading, setLoading] = useState(false);
  if (!logId) return null;

  async function open() {
    if (loading) return;
    setLoading(true);
    const result = await getTransferDetail(logId);
    setLoading(false);
    if (result.success) setTransfer(result.data);
    else toast.error(result.message);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#2f3a2e] underline underline-offset-2 hover:text-[#1f291f] disabled:opacity-50"
      >
        <ArrowRightLeft size={11} /> Transférée le {date(transferredAt)}
      </button>
      <TransferDetailModal transfer={transfer} onClose={() => setTransfer(null)} />
    </>
  );
}

/**
 * `readOnly` is the /dashboard/mes-operations rendering: a practitioner
 * reading her own lines. The salon's document actions (the detail drawer,
 * InvoiceRowActions' send/credit-note) stay out of it — they are backed by
 * admin-only server actions and the documents they reach are the salon's,
 * not hers.
 *
 * One action is hers, and it is here: "Rembourser". Her sale was charged to
 * her own Stripe account, so she is the only one who can give that money
 * back — the admin is refused on it (lib/refunds/authorize.js). The dialog
 * previews the same guards and explains the refusal if the row is not
 * refundable.
 */
/**
 * Money actually collected and not already fully given back — the only rows
 * worth offering "Rembourser" on. A transfer line (operationOnly) moves no
 * money, and a refund line is the giving-back itself.
 */
function refundableByOwner(row) {
  if (row.operationOnly || !row.payment?.id) return false;
  if (row.transactionType === "REFUND") return false;
  // The server computes what is still refundable from the ledger
  // (summarizeRefundState); a status alone would offer the button on a
  // payment already given back.
  if (row.refundState) return Number(row.refundState.remainingRefundable ?? 0) > 0.01;
  return ["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"].includes(row.payment.status);
}

function UnifiedOperationsTable({ rows, onOpenDetail, onOpenPendingOrder, onOpenTransfer, onRefund, readOnly = false }) {
  return (
    <Table className="[&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-6 [&_th:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:last-child]:pr-6">
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Date</TableHead>
          <TableHead>Origine</TableHead>
          <TableHead>Détail</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>N° TVA</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>État paiement</TableHead>
          <TableHead>Règlement</TableHead>
          <TableHead>Facture</TableHead>
          <TableHead className="text-right">Montant</TableHead>
          {/* Pinned: with eleven columns the table always scrolls sideways on
              a laptop or a phone, and an action column parked off the right
              edge is an action nobody finds. It stays put over the scrolling
              content, hence its own opaque background. */}
          <TableHead className="sticky right-0 z-20 border-l border-stroke bg-white pr-6 text-right shadow-[-12px_0_14px_-12px_rgba(0,0,0,0.18)] dark:border-dark-3 dark:bg-gray-dark">
            Actions
          </TableHead>
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
            <TableRow key={row.id} className="group">
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
              <TableCell className="text-xs text-gray-500">
                {described.detail}
                {row.sourceType === "ORDER" && row.settledBySale && (
                  <Link
                    href={`/dashboard/boutique/orders/${row.settledBySale.id}`}
                    className="mt-1 block font-medium text-[#2f3a2e] underline underline-offset-2"
                  >
                    Encaissée en caisse — vente n°{row.settledBySale.orderNumber}
                  </Link>
                )}
                {row.sourceType === "ORDER" && row.settledOrder && (
                  <Link
                    href={`/dashboard/boutique/orders/${row.settledOrder.id}`}
                    className="mt-1 block font-medium text-[#2f3a2e] underline underline-offset-2"
                  >
                    Reprise de la commande n°{row.settledOrder.orderNumber}
                  </Link>
                )}
                <TransferCrossLink logId={row.lastTransferLogId} transferredAt={row.lastTransferredAt} />
              </TableCell>
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
                <PaymentBreakdown row={row} />
                {!row.operationOnly && (
                  <details className="mt-2 text-xs open:min-w-[220px]">
                    <summary className="cursor-pointer font-medium text-[#2f3a2e]">Historique des transactions</summary>
                    <ul className="mt-2 space-y-2">
                      {(row.payment?.transactions ?? []).filter((event) => !event.isDeleted).map((event) => {
                        const label = `${date(event.paidAt)} · ${PAYMENT_EVENT_LABELS[event.transactionType] ?? event.transactionType} · ${event.method === "CASH" ? "Espèces" : event.method === "CARD" ? "Carte" : event.method === "TRANSFER" ? "Virement" : "En ligne"} · ${event.transactionType === "REFUND" ? "−" : ""}${money(event.amount)}`;
                        return (
                          <li key={event.id}>
                            {readOnly || row.sourceType === "STAFF_RENT" ? (
                              <span className="text-left">{label}</span>
                            ) : (
                              <button type="button" onClick={() => onOpenDetail(event.id)} className="text-left underline underline-offset-2">
                                {label}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}
              </TableCell>
              <TableCell>
                {row.operationOnly ? <span className="text-xs text-gray-400">—</span> : <InvoiceStatus invoice={invoice} customerInvoiceEligible={row.customerInvoiceEligible} />}
              </TableCell>
              <TableCell className={`text-right font-medium ${described.isRefundEvent ? "text-red-600" : ""}`}>
                {described.amountLabel ?? `${described.isRefundEvent ? "−" : ""}${money(described.totalAmount)}`}
                {described.amountNote && <span className="block max-w-28 text-xs font-normal text-gray-400">{described.amountNote}</span>}
              </TableCell>
              <TableCell className="sticky right-0 z-10 border-l border-stroke bg-white pr-6 align-top shadow-[-12px_0_14px_-12px_rgba(0,0,0,0.18)] group-hover:bg-[#fafafa] dark:border-dark-3 dark:bg-gray-dark dark:group-hover:bg-dark-2">
                {readOnly ? (
                  refundableByOwner(row) ? (
                    <button
                      type="button"
                      onClick={() => onRefund(row.payment.id)}
                      className="whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Rembourser
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )
                ) : row.sourceType === "STAFF_RENT" ? (
                  // Sent, accepted and credited from the Factures page — the
                  // booking refund flows here know nothing about a rent.
                  <Link
                    href={describeUnifiedRow(row).href}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-[#2f3a2e] hover:bg-[#f4f7f3] hover:text-[#2f3a2e]"
                  >
                    <Eye size={14} /> Voir dans Factures
                  </Link>
                ) : row.operationOnly ? (
                  <button
                    type="button"
                    onClick={() => onOpenTransfer(row)}
                    className="whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-[#2f3a2e] hover:bg-gray-50"
                  >
                    Voir le détail
                  </button>
                ) : row.sourceType === "ORDER" && !transaction && !invoice ? (
                  // A boutique order nothing has been collected on yet — a
                  // pay-at-pickup order waiting for its customer. No
                  // Transaction means no "Voir / gérer", so this opens the
                  // same drawer on the order itself: details and pickup QR
                  // code, but no ticket until it is actually paid.
                  <button
                    type="button"
                    onClick={() => onOpenPendingOrder(row.id)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-[#2f3a2e] hover:bg-[#f4f7f3] hover:text-[#2f3a2e]"
                  >
                    <Eye size={14} /> Voir le détail
                  </button>
                ) : (
                  <InvoiceRowActions
                    invoice={invoice}
                    creditNotes={invoice?.creditNotes ?? []}
                    transaction={transaction ? { ...transaction, hasInvoice: Boolean(invoice) } : null}
                    paymentId={row.payment?.id ?? null}
                    paymentStatus={row.payment?.status ?? null}
                    remainingRefundable={row.refundState?.remainingRefundable ?? null}
                    refundInFlight={Boolean(row.refundInFlight)}
                    onOpenDetail={transaction ? () => onOpenDetail(transaction.id) : undefined}
                  />
                )}
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

/**
 * `basePath` is what makes /dashboard/mes-operations work off the same
 * component: read-only (the server forces the reader's own id whatever the
 * query string says), same table. Neither view has a staff filter.
 */
export function AdminOperationsClient({ result, basePath = "/dashboard/operations" }) {
  const {
    tab = "transactions",
    data = [],
    page = 1,
    pageSize = 30,
    totalCount = 0,
    type = "ALL",
    lifecycleStatus = "ALL",
    paymentEvent = "ALL",
    readOnly = false,
  } = result ?? {};
  const [detailId, setDetailId] = useState(null);
  const [pendingOrderId, setPendingOrderId] = useState(null);
  const [transferDetail, setTransferDetail] = useState(null);
  // Mes opérations only: the payment a practitioner is refunding.
  const [refundPaymentId, setRefundPaymentId] = useState(null);

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
    return `${basePath}?${search.toString()}`;
  }

  return (
    // Full-bleed on purpose: the dashboard shell pads <main>, and the ledger
    // is the widest thing in the app — those gutters are worth more as table
    // width than as framing. The negative margins mirror the shell's padding
    // scale exactly (p-3 / sm:p-4 / md:p-6 / 2xl:p-10), so the card lands on
    // the padding-box edge and never overflows.
    <div className="-mx-3 border-x-0 border-y border-stroke bg-white shadow-1 sm:-mx-4 md:-mx-6 2xl:-mx-10 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
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
          lifecycle. On Transactions (no sourceType restriction) that would be
          the Order and Reservation vocabularies mixed into one flat, mostly
          irrelevant-to-each-other pill row, so it's hidden there — pick
          Commandes / Ateliers & événements / Formations to filter by status.
          None renders when it has nothing to offer on the current tab. */}
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
        options={tab === "transactions" ? [] : LIFECYCLE_STATUS_FILTERS[tab]}
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
          <UnifiedOperationsTable
            rows={data}
            onOpenDetail={setDetailId}
            onOpenPendingOrder={setPendingOrderId}
            onOpenTransfer={setTransferDetail}
            onRefund={setRefundPaymentId}
            readOnly={readOnly}
          />
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
      <TransactionDetailDrawer orderId={pendingOrderId} onClose={() => setPendingOrderId(null)} />
      <TransferDetailModal transfer={transferDetail} onClose={() => setTransferDetail(null)} />
      <CancelAndRefundDialog
        open={Boolean(refundPaymentId)}
        paymentId={refundPaymentId}
        onClose={() => setRefundPaymentId(null)}
      />
    </div>
  );
}
