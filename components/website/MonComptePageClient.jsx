"use client";

import { formatSessionDateRange } from "@/lib/formations/custom-date-availability";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useLocale } from "next-intl";
import { Package, Sparkles, GraduationCap, Loader2, FileDown, ExternalLink, Truck, AlertTriangle, Star } from "lucide-react";
import { cancelMyOrder, submitOrderCancellationRequest } from "@/actions/boutique/orders";
import { submitReservationCancellationRequest } from "@/actions/reservations/cancellation-request";
import { createWorkshopReservationReview, createFormationReservationReview } from "@/actions/review/review-actions";
import { REVIEW_COMMENT_MAX_LENGTH } from "@/lib/review-eligibility";
import { MONDIAL_RELAY_TRACKING_URL } from "@/lib/mondial-relay-tracking";
import { StarRatingInput, StaticStars } from "@/components/shared/StarRating";

const CUSTOMER_CANCELLABLE_STATUSES = ["PENDING_PICKUP"];
const CUSTOMER_CANCELLATION_REQUESTABLE_STATUSES = ["PAID", "PROCESSING", "READY_FOR_PICKUP"];

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
  SETTLED_AT_COUNTER: "Encaissée en caisse",
};

const STATUS_LABELS_EN = {
  PENDING_PAYMENT: "Payment pending", PENDING_PICKUP: "Awaiting pickup", PAID: "Paid", PROCESSING: "Preparing",
  READY_FOR_PICKUP: "Ready for pickup", SHIPPED: "Shipped", COMPLETED: "Completed", CANCELLED: "Cancelled",
  EXPIRED: "Expired", SETTLED_AT_COUNTER: "Paid at the counter", PENDING_DEPOSIT: "Deposit pending",
  CONFIRMED: "Confirmed", NO_SHOW: "No-show",
};
const STATUS_LABELS_NL = {
  PENDING_PAYMENT: "Betaling in afwachting", PENDING_PICKUP: "Wacht op afhaling", PAID: "Betaald", PROCESSING: "In voorbereiding",
  READY_FOR_PICKUP: "Klaar voor afhaling", SHIPPED: "Verzonden", COMPLETED: "Voltooid", CANCELLED: "Geannuleerd",
  EXPIRED: "Verlopen", SETTLED_AT_COUNTER: "Betaald aan de kassa", PENDING_DEPOSIT: "Voorschot in afwachting",
  CONFIRMED: "Bevestigd", NO_SHOW: "Niet komen opdagen",
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
  SETTLED_AT_COUNTER: "bg-emerald-50 text-emerald-700 border-emerald-100",
  NO_SHOW: "bg-red-50 text-red-600 border-red-100",
};

const FULFILMENT_LABELS = {
  PICKUP_PREPAID: "Retrait en boutique — payé en ligne",
  PICKUP_ON_SITE: "Retrait en boutique — à payer sur place",
  SHIPPING_PREPAID: "Livraison en point relais",
};

const RESERVATION_STATUS_LABELS_EN = {
  PENDING_DEPOSIT: "Deposit pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No-show",
};

const RESERVATION_STATUS_LABELS_NL = {
  PENDING_DEPOSIT: "Voorschot in afwachting",
  CONFIRMED: "Bevestigd",
  CANCELLED: "Geannuleerd",
  COMPLETED: "Voltooid",
  NO_SHOW: "Niet komen opdagen",
};

function copy(locale, fr, en, nl) {
  return locale === "nl" ? nl : locale === "en" ? en : fr;
}

function formatPrice(n, locale) {
  return new Intl.NumberFormat(locale === "nl" ? "nl-BE" : locale === "en" ? "en-GB" : "fr-BE", { style: "currency", currency: "EUR" }).format(Number(n));
}

function formatDate(date, locale) {
  return new Date(date).toLocaleDateString(locale === "nl" ? "nl-BE" : locale === "en" ? "en-GB" : "fr-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function formatSessionDate(date, endDate = null, customDateKeys = null, locale = "fr") {
  // A formation over several days: "du … au …, N journées".
  if (endDate) {
    const range = formatSessionDateRange({ startDate: date, endDate, customDateKeys });
    if (range.multiDay) return locale === "fr" ? `${range.days}, ${range.dayCount} journées` : `${range.days}, ${range.dayCount} ${copy(locale, "journées", "days", "dagen")}`;
  }
  return new Date(date).toLocaleDateString(locale === "nl" ? "nl-BE" : locale === "en" ? "en-GB" : "fr-BE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Brussels",
  });
}

function formatReviewDate(date, locale) {
  return new Date(date).toLocaleDateString(locale === "nl" ? "nl-BE" : locale === "en" ? "en-GB" : "fr-BE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
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
  const locale = useLocale();
  if (!invoice) return null;
  return (
    <a
      href={`/api/invoices/${invoice.id}/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/60 hover:text-gold"
    >
      <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      {copy(locale, "Facture", "Invoice", "Factuur")} {invoice.number}
    </a>
  );
}

function OrderTicketLink({ order }) {
  const locale = useLocale();
  if (!order?.payment?.transactions?.length) return null;
  return (
    <a
      href={`/api/orders/${order.id}/ticket`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink/60 hover:text-gold"
    >
      <FileDown className="h-3.5 w-3.5" strokeWidth={1.75} />
      {copy(locale, "Télécharger le ticket de caisse", "Download receipt", "Kassabon downloaden")}
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
  const locale = useLocale();
  const labels = locale === "nl" ? STATUS_LABELS_NL : locale === "en" ? STATUS_LABELS_EN : ORDER_STATUS_LABELS;
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requestingCancellation, setRequestingCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [submittingCancellationRequest, setSubmittingCancellationRequest] = useState(false);
  const canCancel = CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);
  const cancellationRequest = order.cancellationRequest ?? null;
  const canRequestCancellation =
    CUSTOMER_CANCELLATION_REQUESTABLE_STATUSES.includes(order.status) &&
    cancellationRequest?.status !== "PENDING" &&
    cancellationRequest?.status !== "APPROVED";

  async function handleCancel() {
    setCancelling(true);
    const result = await cancelMyOrder(order.id);
    if (result.success) {
      toast.success(copy(locale, "Commande annulée.", "Order cancelled.", "Bestelling geannuleerd."));
      router.refresh();
    } else {
      toast.error(result.message);
      setCancelling(false);
      setConfirming(false);
    }
  }

  async function handleCancellationRequest() {
    setSubmittingCancellationRequest(true);
    try {
      const result = await submitOrderCancellationRequest({ orderId: order.id, reason: cancellationReason });
      if (result.success) {
        toast.success(result.message);
        setRequestingCancellation(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } finally {
      setSubmittingCancellationRequest(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink/8 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* Two forms, never two numbers at once: once the sale is settled the
              ticket number is the customer's only reference, but an order
              awaiting payment at the counter has no ticket yet — it cannot be
              given one without burning a fiscal number if it is never collected. */}
          <p className="text-sm font-bold text-ink">
            {order.ticketNumber ? `Ticket ${order.ticketNumber}` : `${copy(locale, "Réservation n°", "Order no.", "Bestelling nr.")} ${order.orderNumber}`}
          </p>
          <p className="mt-0.5 text-xs text-ink/45">{formatDate(order.createdAt, locale)} · {copy(locale, FULFILMENT_LABELS[order.fulfilmentMode] ?? order.fulfilmentMode, order.fulfilmentMode === "PICKUP_PREPAID" ? "In-store pickup — paid online" : order.fulfilmentMode === "PICKUP_ON_SITE" ? "In-store pickup — pay on collection" : "Pickup point delivery", order.fulfilmentMode === "PICKUP_PREPAID" ? "Afhalen in de winkel — online betaald" : order.fulfilmentMode === "PICKUP_ON_SITE" ? "Afhalen in de winkel — betalen bij afhaling" : "Levering naar afhaalpunt")}</p>
        </div>
        <StatusBadge status={order.status} labels={labels} />
      </div>

      <ul className="mt-4 space-y-1 border-t border-ink/8 pt-3 text-[13px] text-ink/65">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{item.productName}{item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity}</span>
            <span className="shrink-0 font-medium text-ink">{formatPrice(item.unitPrice * item.quantity, locale)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink/8 pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {order.pickupCode && !["COMPLETED", "CANCELLED", "EXPIRED", "SETTLED_AT_COUNTER"].includes(order.status) && (
            <span className="text-[11px] text-ink/45">{copy(locale, "Code de retrait :", "Pickup code:", "Afhaalcode:")} <span className="font-mono font-semibold text-ink/70">{order.pickupCode}</span></span>
          )}
          <InvoiceLink invoice={order.payment?.invoice} />
          <OrderTicketLink order={order} />
        </div>
        <span className="text-sm font-bold text-gold">{formatPrice(order.totalAmount, locale)}</span>
      </div>

      {order.pickupQr && order.pickupCode && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-gold/20 bg-cream/60 px-4 py-5 text-center sm:flex-row sm:text-left">
          {/* Generated from the persistent pickup code on each profile visit. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={order.pickupQr}
              alt={`${copy(locale, "QR code de retrait de la réservation n°", "Pickup QR code for order no.", "Afhaal-QR-code voor bestelling nr.")} ${order.orderNumber}`}
            width={160}
            height={160}
            className="h-40 w-40 shrink-0 rounded-lg bg-white p-1"
          />
          <div>
            <p className="text-sm font-bold text-ink">{copy(locale, "Votre QR code de retrait", "Your pickup QR code", "Uw afhaal-QR-code")}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink/55">
              {copy(locale, "Présentez ce QR code en boutique pour récupérer votre commande.", "Show this QR code in store to collect your order.", "Toon deze QR-code in de winkel om uw bestelling af te halen.")}
            </p>
            <p className="mt-2 font-mono text-lg font-bold tracking-widest text-ink">{order.pickupCode}</p>
          </div>
        </div>
      )}

      {order.fulfilmentMode === "SHIPPING_PREPAID" && order.trackingCode && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-cream px-3 py-2.5 text-xs text-ink/65">
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5 text-gold" strokeWidth={1.75} />
            {copy(locale, "Suivi :", "Tracking:", "Volgcode:")} <strong className="font-mono text-ink">{order.trackingCode}</strong>
          </span>
          <a
            href={MONDIAL_RELAY_TRACKING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-ink hover:text-gold"
          >
            {copy(locale, "Suivre le colis", "Track parcel", "Pakket volgen")} <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          </a>
        </div>
      )}

      {order.status === "PENDING_PAYMENT" && (
        <p className="mt-3 border-t border-ink/8 pt-3 text-xs text-ink/50">
          {copy(locale, "Cette tentative de paiement sera automatiquement annulée si le paiement n'est pas finalisé.", "This payment attempt will be cancelled automatically if payment is not completed.", "Deze betaalpoging wordt automatisch geannuleerd als de betaling niet wordt afgerond.")}
        </p>
      )}

      {cancellationRequest?.status === "PENDING" && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {copy(locale, "Votre demande d'annulation est en cours d'examen. La commande et le paiement restent inchangés jusque-là.", "Your cancellation request is being reviewed. The order and payment remain unchanged in the meantime.", "Uw annuleringsaanvraag wordt beoordeeld. De bestelling en betaling blijven intussen ongewijzigd.")}
        </p>
      )}
      {cancellationRequest?.status === "REJECTED" && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {copy(locale, "Votre précédente demande a été refusée.", "Your previous request was declined.", "Uw vorige aanvraag is afgewezen.")}{cancellationRequest.decisionNote ? ` ${copy(locale, "Message de l'équipe :", "Team message:", "Bericht van het team:")} ${cancellationRequest.decisionNote}` : ""}
        </p>
      )}

      {canCancel && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-ink/8 pt-3">
          {confirming ? (
            <>
              <span className="text-xs text-ink/50">{copy(locale, "Confirmer l'annulation ?", "Confirm cancellation?", "Annulering bevestigen?")}</span>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={cancelling}
                className="text-xs font-semibold text-ink/50 hover:text-ink"
              >
                {copy(locale, "Non", "No", "Nee")}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {cancelling && <Loader2 className="h-3 w-3 animate-spin" />}
                {copy(locale, "Oui, annuler", "Yes, cancel", "Ja, annuleren")}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-xs font-semibold text-red-600 hover:text-red-700"
            >
              {copy(locale, "Annuler la commande", "Cancel order", "Bestelling annuleren")}
            </button>
          )}
        </div>
      )}

      {canRequestCancellation && (
        <div className="mt-3 border-t border-ink/8 pt-3">
          {requestingCancellation ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-xs text-amber-900">
                {copy(locale, "Votre demande sera examinée par l'équipe. Aucun remboursement n'est effectué avant son accord.", "Your request will be reviewed by the team. No refund is issued before approval.", "Uw aanvraag wordt door het team beoordeeld. Er wordt geen terugbetaling uitgevoerd vóór goedkeuring.")}
              </p>
              <textarea
                value={cancellationReason}
                onChange={(event) => setCancellationReason(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={copy(locale, "Expliquez brièvement votre demande", "Briefly explain your request", "Leg uw aanvraag kort uit")}
                className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-ink outline-none focus:border-gold"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRequestingCancellation(false)} disabled={submittingCancellationRequest} className="text-xs font-semibold text-ink/60">
                  {copy(locale, "Retour", "Back", "Terug")}
                </button>
                <button
                  type="button"
                  onClick={handleCancellationRequest}
                  disabled={submittingCancellationRequest || cancellationReason.trim().length < 10}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#2f3a2e] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {submittingCancellationRequest && <Loader2 className="h-3 w-3 animate-spin" />}
                  {copy(locale, "Envoyer la demande", "Send request", "Aanvraag verzenden")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setRequestingCancellation(true)} className="text-xs font-semibold text-red-600 hover:text-red-700">
              {copy(locale, "Demander l'annulation", "Request cancellation", "Annulering aanvragen")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// PENDING_DEPOSIT means no payment has been recorded yet, so there is no
// refund exception to request. A missed Stripe webhook must be reconciled
// first instead of letting an admin approve a refund against no local money.
const REQUESTABLE_RESERVATION_STATUSES = new Set(["CONFIRMED"]);

/**
 * Neither ateliers nor formations allow self-cancellation — the 50% deposit
 * is non-refundable and exceptions are decided case by case. Before this
 * block existed the customer saw no cancel control and no explanation at
 * all, so the only route out was an untracked phone call.
 */
function ReservationCancellationRequest({ reservation, kind }) {
  const locale = useLocale();
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
      toast.error(result.message ?? copy(locale, "Impossible d'envoyer votre demande.", "Unable to send your request.", "Uw aanvraag kon niet worden verzonden."));
    }
    setSubmitting(false);
  }

  return (
    <div className="mt-3 border-t border-ink/8 pt-3 text-[12px] text-ink/45">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" strokeWidth={1.75} />
        <p>
          {copy(locale, "L'annulation en ligne n'est pas possible et l'acompte reste acquis, sauf annulation exceptionnelle approuvée par l'équipe.", "Online cancellation is not available and the deposit is non-refundable unless the team approves an exceptional cancellation.", "Online annuleren is niet mogelijk en het voorschot wordt niet terugbetaald, tenzij het team een uitzonderlijke annulering goedkeurt.")}
        </p>
      </div>

      {request?.status === "PENDING" ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          {copy(locale, "Votre demande est en attente d'une décision de l'équipe. Aucun remboursement n'est engagé avant son accord.", "Your request is awaiting the team's decision. No refund will be issued before approval.", "Uw aanvraag wacht op een beslissing van het team. Er wordt geen terugbetaling uitgevoerd vóór goedkeuring.")}
        </p>
      ) : request?.status === "REJECTED" && !open ? (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700">
          <p>
            {copy(locale, "Votre demande exceptionnelle a été refusée. La réservation et l'acompte restent inchangés.", "Your exceptional request was declined. The reservation and deposit remain unchanged.", "Uw uitzonderlijke aanvraag is afgewezen. De reservering en het voorschot blijven ongewijzigd.")}
            {request.decisionNote ? ` ${copy(locale, "Message de l'équipe :", "Team message:", "Bericht van het team:")} ${request.decisionNote}` : ""}
          </p>
          <button
            type="button"
            onClick={() => {
              setReason("");
              setOpen(true);
            }}
            className="mt-2 font-semibold text-primary hover:underline"
          >
            {copy(locale, "Envoyer une nouvelle demande", "Send a new request", "Een nieuwe aanvraag verzenden")}
          </button>
        </div>
      ) : request?.status === "APPROVED" ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">
            {copy(locale, "Votre demande a été acceptée — la réservation est annulée et le remboursement est en cours.", "Your request was approved — the reservation is cancelled and the refund is being processed.", "Uw aanvraag is goedgekeurd — de reservering is geannuleerd en de terugbetaling wordt verwerkt.")}
        </p>
      ) : open ? (
        <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-amber-900">
            {copy(locale, "Expliquez votre situation. Cette demande n'annule pas la réservation et ne garantit pas un remboursement.", "Explain your situation. This request does not cancel the reservation or guarantee a refund.", "Licht uw situatie toe. Deze aanvraag annuleert de reservering niet en garandeert geen terugbetaling.")}
          </p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            placeholder={copy(locale, "Ex. maladie soudaine, avec toute information utile pour l'équipe", "E.g. sudden illness, with any relevant details", "Bijv. plotselinge ziekte, met alle relevante informatie")}
            className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-amber-500"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="text-xs font-semibold text-ink/55 hover:text-ink"
            >
              {copy(locale, "Retour", "Back", "Terug")}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || reason.trim().length < 10}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {copy(locale, "Envoyer la demande", "Send request", "Aanvraag verzenden")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-xs font-semibold text-primary hover:underline"
        >
          {copy(locale, "Demander une annulation exceptionnelle", "Request an exceptional cancellation", "Een uitzonderlijke annulering aanvragen")}
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
  const locale = useLocale();
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
        alt={`${copy(locale, "QR code d'entrée", "Entry QR code", "Toegangs-QR-code")} — ${typeLabel}`}
        width={160}
        height={160}
        className={`h-40 w-40 shrink-0 rounded-lg bg-white p-1 ${fullyUsed ? "opacity-40" : ""}`}
      />
      <div>
        <p className="text-sm font-bold text-ink">
          {fullyUsed ? copy(locale, "Billet déjà utilisé", "Ticket already used", "Ticket al gebruikt") : copy(locale, "Votre QR code d'entrée", "Your entry QR code", "Uw toegangs-QR-code")}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink/55">
          {fullyUsed
            ? copy(locale, `Vos ${seats} place${seats > 1 ? "s ont" : " a"} été pointée${seats > 1 ? "s" : ""} à l'entrée.`, `Your ${seats} seat${seats > 1 ? "s have" : " has"} been checked in.`, `${seats} plaats${seats > 1 ? "en zijn" : " is"} gecontroleerd.`)
            : copy(locale, "Présentez ce QR code à l'entrée. Il est vérifié auprès du salon, une capture d'écran ne le remplace pas.", "Show this QR code at the entrance. It is verified with the salon; a screenshot cannot be used instead.", "Toon deze QR-code bij de ingang. De code wordt bij het salon gecontroleerd; een screenshot is niet geldig.")}
        </p>
        {!fullyUsed && checkedIn > 0 && (
          <p className="mt-1 text-xs font-semibold text-gold">
            {copy(locale, `${checkedIn} place${checkedIn > 1 ? "s" : ""} sur ${seats} déjà pointée${checkedIn > 1 ? "s" : ""}.`, `${checkedIn} of ${seats} seat${seats > 1 ? "s" : ""} already checked in.`, `${checkedIn} van ${seats} plaats${seats > 1 ? "en" : ""} al ingecheckt.`)}
          </p>
        )}
        {!fullyUsed && balanceDue > 0 && (
          <p className="mt-1 text-xs font-semibold text-ink/70">
            {copy(locale, `Solde de ${formatPrice(balanceDue, locale)} à régler sur place.`, `Balance of ${formatPrice(balanceDue, locale)} due on site.`, `Nog ${formatPrice(balanceDue, locale)} te betalen ter plaatse.`)}
          </p>
        )}
        <p className="mt-2 font-mono text-lg font-bold tracking-widest text-ink">{reservation.checkInCode}</p>
      </div>
    </div>
  );
}

const RESERVATION_REVIEW_ACTIONS = {
  workshop: createWorkshopReservationReview,
  formation: createFormationReservationReview,
};

/**
 * Same modal as ProfilePageClient's appointment ReviewModal, pointed at a
 * workshop or formation reservation instead — copies its logic rather than
 * building a parallel review UI.
 */
function ReservationReviewModal({ target, onClose, onSaved }) {
  const locale = useLocale();
  const { reservation, kind, typeLabel, item } = target;
  const [rating, setRating] = useState(reservation.review?.rating ?? 0);
  const [comment, setComment] = useState(reservation.review?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});

    const submitReview = RESERVATION_REVIEW_ACTIONS[kind];
    const result = await submitReview({ reservationId: reservation.id, rating, comment });

    setSubmitting(false);

    if (result.success) {
      toast.success(result.message);
      onSaved({
        id: result.data.id,
        rating: result.data.rating,
        comment: result.data.comment,
        createdAt: result.data.createdAt,
      });
      return;
    }

    if (result.errors) {
      setErrors(result.errors);
    }
    toast.error(result.message);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg border border-neutral-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">{copy(locale, "Laisser un avis", "Leave a review", "Een beoordeling schrijven")}</p>
            <h3 className="mt-1 text-xl font-bold text-primary">{item.title}</h3>
            <p className="mt-1 text-sm text-neutral-500">
              {typeLabel} · {formatSessionDate(reservation.session.startDate, reservation.session.endDate, reservation.session.customDateKeys, locale)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-neutral-400 hover:text-neutral-600">
            {copy(locale, "Fermer", "Close", "Sluiten")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">{copy(locale, "Votre note", "Your rating", "Uw beoordeling")}</label>
            <StarRatingInput value={rating} onChange={setRating} />
            {errors.rating && <p className="mt-1 text-xs text-red-600">{errors.rating}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              {copy(locale, "Commentaire (optionnel)", "Comment (optional)", "Opmerking (optioneel)")}
            </label>
            <textarea
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={REVIEW_COMMENT_MAX_LENGTH}
              placeholder={copy(locale, "Partagez votre expérience…", "Share your experience…", "Deel uw ervaring…")}
              className="w-full resize-none border border-neutral-200 px-4 py-3 text-sm focus:border-gold focus:outline-none"
            />
            {errors.comment && <p className="mt-1 text-xs text-red-600">{errors.comment}</p>}
          </div>

          <div className="flex justify-end gap-3 border-t border-neutral-200 pt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="border border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-50"
            >
              {copy(locale, "Annuler", "Cancel", "Annuleren")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 bg-gold px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white hover:bg-gold/90 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {copy(locale, "Envoyer l'avis", "Send review", "Beoordeling versturen")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** "Laisser un avis" CTA or the already-submitted review, once the booking is COMPLETED. */
function ReservationReviewStatus({ reservation, kind, typeLabel, item, onOpenReview }) {
  const locale = useLocale();
  if (reservation.status !== "COMPLETED") return null;

  if (reservation.review) {
    return (
      <div className="mt-3 border-t border-ink/8 pt-3">
        <StaticStars rating={reservation.review.rating} />
        <p className="mt-1 text-xs text-ink/45">{copy(locale, "Avis envoyé le", "Review submitted on", "Beoordeling verzonden op")} {formatReviewDate(reservation.review.createdAt, locale)}</p>
        {reservation.review.comment && <p className="mt-2 text-sm text-ink/65">{reservation.review.comment}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 flex justify-end border-t border-ink/8 pt-3">
      <button
        type="button"
        onClick={() => onOpenReview({ reservation, kind, typeLabel, item })}
        className="inline-flex items-center gap-2 border border-gold px-4 py-2 text-xs font-semibold text-gold hover:bg-gold/5"
      >
        <Star className="h-3.5 w-3.5 fill-current" />
        {copy(locale, "Laisser un avis", "Leave a review", "Een beoordeling schrijven")}
      </button>
    </div>
  );
}

function ReservationCard({ reservation, kind, onOpenReview }) {
  const locale = useLocale();
  const reservationLabels = locale === "nl" ? RESERVATION_STATUS_LABELS_NL : locale === "en" ? RESERVATION_STATUS_LABELS_EN : RESERVATION_STATUS_LABELS;
  const item = kind === "workshop" ? reservation.session.workshop : reservation.session.formation;
  const typeLabel =
    kind === "workshop"
      ? item.type === "WORKSHOP" ? copy(locale, "Atelier", "Workshop", "Workshop") : copy(locale, "Événement", "Event", "Evenement")
      : item.type === "PRIVATE" ? copy(locale, "Formation privée", "Private course", "Privéopleiding") : copy(locale, "Formation groupe", "Group course", "Groepsopleiding");

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
            <p className="mt-0.5 text-xs text-ink/45">{formatSessionDate(reservation.session.startDate, reservation.session.endDate, reservation.session.customDateKeys, locale)} · {reservation.seatsCount} {copy(locale, reservation.seatsCount > 1 ? "places" : "place", reservation.seatsCount > 1 ? "seats" : "seat", reservation.seatsCount > 1 ? "plaatsen" : "plaats")}</p>
          </div>
          <StatusBadge status={reservation.status} labels={reservationLabels} />
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-ink/8 pt-3 text-[13px]">
          <span className="text-ink/50">
            {Number(reservation.balanceDue) > 0
              ? copy(locale, `Payé ${formatPrice(reservation.depositAmount, locale)} · solde ${formatPrice(reservation.balanceDue, locale)}`, `Paid ${formatPrice(reservation.depositAmount, locale)} · balance ${formatPrice(reservation.balanceDue, locale)}`, `Betaald ${formatPrice(reservation.depositAmount, locale)} · saldo ${formatPrice(reservation.balanceDue, locale)}`)
              : copy(locale, "Payé intégralement", "Paid in full", "Volledig betaald")}
          </span>
          <span className="text-sm font-bold text-gold">{formatPrice(reservation.totalPrice, locale)}</span>
        </div>

        {reservation.payment?.invoice && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            <InvoiceLink invoice={reservation.payment.invoice} />
          </div>
        )}

        <CheckInTicket reservation={reservation} typeLabel={typeLabel} />

        <ReservationCancellationRequest reservation={reservation} kind={kind} />

        <ReservationReviewStatus
          reservation={reservation}
          kind={kind}
          typeLabel={typeLabel}
          item={item}
          onOpenReview={onOpenReview}
        />
      </div>
    </div>
  );
}

const TABS = [
  { key: "orders", label: "Commandes boutique", icon: Package },
  { key: "workshops", label: "Ateliers & Événements", icon: Sparkles },
  { key: "formations", label: "Formations", icon: GraduationCap },
];

export function MonComptePageClient({ orders, workshopReservations: initialWorkshopReservations, formationReservations: initialFormationReservations }) {
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState("orders");
  const [workshopReservations, setWorkshopReservations] = useState(initialWorkshopReservations);
  const [formationReservations, setFormationReservations] = useState(initialFormationReservations);
  const [reviewModalTarget, setReviewModalTarget] = useState(null);

  const counts = {
    orders: orders.length,
    workshops: workshopReservations.length,
    formations: formationReservations.length,
  };

  function handleReviewSaved(review) {
    const setter = reviewModalTarget.kind === "workshop" ? setWorkshopReservations : setFormationReservations;
    setter((current) =>
      current.map((r) => (r.id === reviewModalTarget.reservation.id ? { ...r, review } : r))
    );
    setReviewModalTarget(null);
  }

  return (
    <>
      <section className="relative w-full bg-primary py-16 lg:py-20">
        <div className="mx-auto max-w-[1000px] px-6 md:px-10 text-center">
          <div className="mb-4 inline-flex items-center gap-3">
            <span className="h-px w-8 bg-gold" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">{copy(locale, "Mon compte", "My account", "Mijn account")}</span>
            <span className="h-px w-8 bg-gold" />
          </div>
          <h1 className="text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.6rem]">
            {copy(locale, "Mes commandes & réservations", "My orders & reservations", "Mijn bestellingen & reserveringen")}
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
                  {tab.key === "orders" ? copy(locale, "Commandes boutique", "Shop orders", "Bestellingen") : tab.key === "workshops" ? copy(locale, "Ateliers & Événements", "Workshops & Events", "Workshops & evenementen") : copy(locale, "Formations", "Courses", "Opleidingen")}
                  <span className={`rounded-full px-1.5 text-[11px] ${selected ? "bg-white/20" : "bg-ink/5"}`}>
                    {counts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          {activeTab === "orders" && (
            orders.length === 0 ? (
              <EmptyState icon={Package} text={copy(locale, "Vous n'avez pas encore passé de commande dans la boutique.", "You have not placed a shop order yet.", "U heeft nog geen bestelling geplaatst.")} />
            ) : (
              <div className="space-y-4">
                {orders.map((order) => <OrderCard key={order.id} order={order} />)}
              </div>
            )
          )}

          {activeTab === "workshops" && (
            workshopReservations.length === 0 ? (
              <EmptyState icon={Sparkles} text={copy(locale, "Vous n'avez pas encore réservé d'atelier ou d'événement.", "You have not booked a workshop or event yet.", "U heeft nog geen workshop of evenement gereserveerd.")} />
            ) : (
              <div className="space-y-4">
                {workshopReservations.map((r) => (
                  <ReservationCard key={r.id} reservation={r} kind="workshop" onOpenReview={setReviewModalTarget} />
                ))}
              </div>
            )
          )}

          {activeTab === "formations" && (
            formationReservations.length === 0 ? (
              <EmptyState icon={GraduationCap} text={copy(locale, "Vous n'avez pas encore réservé de formation.", "You have not booked a course yet.", "U heeft nog geen opleiding gereserveerd.")} />
            ) : (
              <div className="space-y-4">
                {formationReservations.map((r) => (
                  <ReservationCard key={r.id} reservation={r} kind="formation" onOpenReview={setReviewModalTarget} />
                ))}
              </div>
            )
          )}
        </div>
      </section>

      {reviewModalTarget && (
        <ReservationReviewModal
          target={reviewModalTarget}
          onClose={() => setReviewModalTarget(null)}
          onSaved={handleReviewSaved}
        />
      )}
    </>
  );
}
