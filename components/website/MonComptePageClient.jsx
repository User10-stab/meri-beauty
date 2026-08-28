"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Package, Sparkles, GraduationCap, Loader2, FileDown, ExternalLink, Truck, AlertTriangle } from "lucide-react";
import { cancelMyOrder } from "@/actions/boutique/orders";
import { submitReservationCancellationRequest } from "@/actions/reservations/cancellation-request";
import { MONDIAL_RELAY_TRACKING_URL } from "@/lib/mondial-relay-tracking";

const CUSTOMER_CANCELLABLE_STATUSES = ["PENDING_PAYMENT", "PENDING_PICKUP"];

const ORDER_STATUS_LABELS = {
  PENDING_PAYMENT: "Paiement en attente",
  PENDING_PICKUP: "En attente de retrait",
  PAID: "Payée",
  PROCESSING: "En préparation",
  READY_FOR_PICKUP: "Prête pour retrait",
  SHIPPED: "Expédiée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  EXPIRED: "Expirée",
};

const RESERVATION_STATUS_LABELS = {
  PENDING_DEPOSIT: "Acompte en attente",
  CONFIRMED: "Confirmée",
  CANCELLED: "Annulée",
  COMPLETED: "Terminée",
  NO_SHOW: "Absent(e)",
};

const STATUS_STYLE = {
  PENDING_PAYMENT: "bg-gray-100 text-gray-600 border-gray-200",
  PENDING_DEPOSIT: "bg-gray-100 text-gray-600 border-gray-200",
  PENDING_PICKUP: "bg-amber-50 text-amber-700 border-amber-100",
  PAID: "bg-blue-50 text-blue-700 border-blue-100",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-100",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-700 border-emerald-100",
  SHIPPED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  EXPIRED: "bg-red-50 text-red-600 border-red-100",
  NO_SHOW: "bg-red-50 text-red-600 border-red-100",
};

const FULFILMENT_LABELS = {
  PICKUP_PREPAID: "Retrait en boutique — payé en ligne",
  PICKUP_ON_SITE: "Retrait en boutique — à payer sur place",
  SHIPPING_PREPAID: "Livraison en point relais",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(Number(n));
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function StatusBadge({ status, labels }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function InvoiceLink({ invoice }) {
  if (!invoice) return null;
  return (
    <a
      href={`/api/invoices/${invoice.id}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/60 hover:text-gold"
    >
      <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      Facture {invoice.number}
    </a>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink/15 bg-white/50 py-16 text-center">
      <Icon className="h-8 w-8 text-ink/25" strokeWidth={1.5} />
      <p className="text-sm text-ink/45">{text}</p>
    </div>
  );
}

function OrderCard({ order }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canCancel = CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelMyOrder(order.id);
    if (result.success) {
      toast.success("Commande annulée.");
      router.refresh();
    } else {
      toast.error(result.message);
      setCancelling(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">Commande #{order.orderNumber}</p>
          <p className="mt-0.5 text-xs text-ink/45">{formatDate(order.createdAt)} · {FULFILMENT_LABELS[order.fulfilmentMode] ?? order.fulfilmentMode}</p>
        </div>
        <StatusBadge status={order.status} labels={ORDER_STATUS_LABELS} />
      </div>

      <ul className="mt-4 space-y-1 border-t border-ink/8 pt-3 text-[13px] text-ink/65">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{item.productName}{item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity}</span>
            <span className="shrink-0 font-medium text-ink">{formatPrice(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-ink/8 pt-3">
        {order.pickupCode && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status) ? (
          <span className="text-[11px] text-ink/45">Code de retrait : <span className="font-mono font-semibold text-ink/70">{order.pickupCode}</span></span>
        ) : (
          <InvoiceLink invoice={order.payment?.invoice} />
        )}
        <span className="text-sm font-bold text-gold">{formatPrice(order.totalAmount)}</span>
      </div>

      {order.pickupQr && order.pickupCode && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-gold/20 bg-cream/60 px-4 py-5 text-center sm:flex-row sm:text-left">
          {/* Generated from the persistent pickup code on each profile visit. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={order.pickupQr}
            alt={`QR code de retrait de la commande ${order.orderNumber}`}
            width={160}
            height={160}
            className="h-40 w-40 shrink-0 rounded-lg bg-white p-1"
          />
          <div>
            <p className="text-sm font-bold text-ink">Votre QR code de retrait</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/55">
              Présentez ce QR code en boutique pour récupérer votre commande.
            </p>
            <p className="mt-2 font-mono text-lg font-bold tracking-widest text-ink">{order.pickupCode}</p>
          </div>
        </div>
      )}

      {order.fulfilmentMode === "SHIPPING_PREPAID" && order.trackingCode && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cream px-3 py-2.5 text-xs text-ink/65">
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
            Suivi : <strong className="font-mono text-ink">{order.trackingCode}</strong>
          </span>
          <a
            href={MONDIAL_RELAY_TRACKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-ink hover:text-gold"
          >
            Suivre le colis <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </a>
        </div>
      )}

      {canCancel && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-ink/8 pt-3">
          {confirming ? (
            <>
              <span className="text-xs text-ink/50">Confirmer l&apos;annulation ?</span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={cancelling}
                className="text-xs font-semibold text-ink/50 hover:text-ink"
              >
                Non
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {cancelling && <Loader2 className="h-3 w-3 animate-spin" />}
                Oui, annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs font-semibold text-red-600 hover:text-red-700"
            >
              Annuler la commande
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const REQUESTABLE_RESERVATION_STATUSES = new Set(["PENDING_DEPOSIT", "CONFIRMED"]);

/**
 * Neither ateliers nor formations allow self-cancellation — the 50% deposit
 * is non-refundable and exceptions are decided case by case. Before this
 * block existed the customer saw no cancel control and no explanation at
 * all, so the only route out was an untracked phone call.
 */
function ReservationCancellationRequest({ reservation, kind }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const request = reservation.cancellationRequest;

  if (!REQUESTABLE_RESERVATION_STATUSES.has(reservation.status)) return null;

  async function handleSubmit() {
    setSubmitting(true);
    const result = await submitReservationCancellationRequest({
      kind: kind === "workshop" ? "WORKSHOP" : "FORMATION",
      reservationId: reservation.id,
      reason,
    });
    if (result.success) {
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.message ?? "Impossible d'envoyer votre demande.");
    }
    setSubmitting(false);
  }

  return (
    <div className="mt-3 border-t border-ink/8 pt-3 text-[12px] text-ink/45">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.75} />
        <p>
          L&apos;annulation en ligne n&apos;est pas possible et l&apos;acompte reste acquis, sauf annulation
          exceptionnelle approuvée par l&apos;équipe.
        </p>
      </div>

      {request?.status === "PENDING" ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          Votre demande est en attente d&apos;une décision de l&apos;équipe. Aucun remboursement n&apos;est engagé avant son accord.
        </p>
      ) : request?.status === "REJECTED" ? (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">
          Votre demande exceptionnelle a été refusée. La réservation et l&apos;acompte restent inchangés.
          {request.decisionNote ? ` Message de l'équipe : ${request.decisionNote}` : ""}
        </p>
      ) : request?.status === "APPROVED" ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">
          Votre demande a été acceptée — la réservation est annulée et le remboursement est en cours.
        </p>
      ) : open ? (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-amber-900">
            Expliquez votre situation. Cette demande n&apos;annule pas la réservation et ne garantit pas un remboursement.
          </p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder="Ex. maladie soudaine, avec toute information utile pour l'équipe"
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-amber-500"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="text-xs font-semibold text-ink/55 hover:text-ink"
            >
              Retour
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || reason.trim().length < 10}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              Envoyer la demande
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-semibold text-primary hover:underline"
        >
          Demander une annulation exceptionnelle
        </button>
      )}
    </div>
  );
}

/**
 * The customer's entry ticket. Only rendered for CONFIRMED reservations —
 * getMyOrderHistory nulls the code out for every other status, so there is
 * nothing to show on a cancelled or already-honoured booking.
 *
 * The readable code sits under the QR on purpose: an atelier can run in a
 * basement with no signal, and staff must still be able to type it in.
 */
function CheckInTicket({ reservation, typeLabel }) {
  if (!reservation.checkInQr || !reservation.checkInCode) return null;

  const seats = reservation.seatsCount;
  const checkedIn = reservation.checkedInSeats ?? 0;
  const fullyUsed = checkedIn >= seats;
  const balanceDue = Number(reservation.balanceDue);

  return (
    <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-gold/20 bg-cream/60 px-4 py-5 text-center sm:flex-row sm:text-left">
      {/* Regenerated from the persistent code on each visit, never stored. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={reservation.checkInQr}
        alt={`QR code d'entrée — ${typeLabel}`}
        width={160}
        height={160}
        className={`h-40 w-40 shrink-0 rounded-lg bg-white p-1 ${fullyUsed ? "opacity-40" : ""}`}
      />
      <div>
        <p className="text-sm font-bold text-ink">
          {fullyUsed ? "Billet déjà utilisé" : "Votre QR code d'entrée"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink/55">
          {fullyUsed
            ? `Vos ${seats} place${seats > 1 ? "s ont" : " a"} été pointée${seats > 1 ? "s" : ""} à l'entrée.`
            : "Présentez ce QR code à l'entrée. Il est vérifié auprès du salon, une capture d'écran ne le remplace pas."}
        </p>
        {!fullyUsed && checkedIn > 0 && (
          <p className="mt-1 text-xs font-semibold text-gold">
            {checkedIn} place{checkedIn > 1 ? "s" : ""} sur {seats} déjà pointée{checkedIn > 1 ? "s" : ""}.
          </p>
        )}
        {!fullyUsed && balanceDue > 0 && (
          <p className="mt-1 text-xs font-semibold text-ink/70">
            Solde de {formatPrice(balanceDue)} à régler sur place.
          </p>
        )}
        <p className="mt-2 font-mono text-lg font-bold tracking-widest text-ink">{reservation.checkInCode}</p>
      </div>
    </div>
  );
}

function ReservationCard({ reservation, kind }) {
  const item = kind === "workshop" ? reservation.session.workshop : reservation.session.formation;
  const typeLabel =
    kind === "workshop"
      ? item.type === "WORKSHOP" ? "Atelier" : "Événement"
      : item.type === "PRIVATE" ? "Formation privée" : "Formation groupe";

  return (
    <div className="flex gap-4 rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream">
        {item.cover ? (
          <img src={item.cover} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg font-bold text-gold/30">
            {typeLabel.charAt(0)}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gold">{typeLabel}</span>
            <p className="text-sm font-bold text-ink">{item.title}</p>
            <p className="mt-0.5 text-xs text-ink/45">{formatSessionDate(reservation.session.startDate)} · {reservation.seatsCount} place{reservation.seatsCount > 1 ? "s" : ""}</p>
          </div>
          <StatusBadge status={reservation.status} labels={RESERVATION_STATUS_LABELS} />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-ink/8 pt-3 text-[13px]">
          <span className="text-ink/50">
            {Number(reservation.balanceDue) > 0
              ? `Payé ${formatPrice(reservation.depositAmount)} · solde ${formatPrice(reservation.balanceDue)}`
              : "Payé intégralement"}
          </span>
          <span className="text-sm font-bold text-gold">{formatPrice(reservation.totalPrice)}</span>
        </div>

        <InvoiceLink invoice={reservation.payment?.invoice} />

        <CheckInTicket reservation={reservation} typeLabel={typeLabel} />

        <ReservationCancellationRequest reservation={reservation} kind={kind} />
      </div>
    </div>
  );
}

const TABS = [
  { key: "orders", label: "Commandes boutique", icon: Package },
  { key: "workshops", label: "Ateliers & Événements", icon: Sparkles },
  { key: "formations", label: "Formations", icon: GraduationCap },
];

export function MonComptePageClient({ orders, workshopReservations, formationReservations }) {
  const [activeTab, setActiveTab] = useState("orders");

  const counts = {
    orders: orders.length,
    workshops: workshopReservations.length,
    formations: formationReservations.length,
  };

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[1000px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Mon compte</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            Mes commandes &amp; réservations
          </h1>
        </div>
      </section>

      <section className="w-full bg-cream">
        <div className="mx-auto max-w-[1000px] px-6 py-12 md:px-10">
          <div className="mb-8 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                    selected
                      ? "border-gold bg-gold text-white shadow-sm"
                      : "border-ink/10 bg-white text-ink/60 hover:border-gold/40"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                  {tab.label}
                  <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20" : "bg-ink/5"}`}>
                    {counts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === "orders" && (
            orders.length === 0 ? (
              <EmptyState icon={Package} text="Vous n'avez pas encore passé de commande dans la boutique." />
            ) : (
              <div className="space-y-4">
                {orders.map((order) => <OrderCard key={order.id} order={order} />)}
              </div>
            )
          )}

          {activeTab === "workshops" && (
            workshopReservations.length === 0 ? (
              <EmptyState icon={Sparkles} text="Vous n'avez pas encore réservé d'atelier ou d'événement." />
            ) : (
              <div className="space-y-4">
                {workshopReservations.map((r) => <ReservationCard key={r.id} reservation={r} kind="workshop" />)}
              </div>
            )
          )}

          {activeTab === "formations" && (
            formationReservations.length === 0 ? (
              <EmptyState icon={GraduationCap} text="Vous n'avez pas encore réservé de formation." />
            ) : (
              <div className="space-y-4">
                {formationReservations.map((r) => <ReservationCard key={r.id} reservation={r} kind="formation" />)}
              </div>
            )
          )}
        </div>
      </section>
    </>
  );
}
