"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail, Phone, MapPin, Truck, KeyRound, Download, FileMinus, Printer, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PickupConfirmDialog } from "@/components/dashboard/boutique/PickupConfirmDialog";
import { markOrderReadyForPickup, markOrderShipped, markOrderCompleted, cancelOrder } from "@/actions/boutique/orders";
import { generateShippingLabel } from "@/actions/boutique/mondial-relay";
import { DocumentDeliveryDialog } from "@/components/dashboard/operations/DocumentDeliveryDialog";

const MODE_LABEL = {
  PICKUP_PREPAID: "Retrait en boutique (payé en ligne)",
  PICKUP_ON_SITE: "Retrait en boutique (paiement sur place)",
  SHIPPING_PREPAID: "Livraison Mondial Relay",
};

const STATUS_LABEL = {
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

const STATUS_STYLE = {
  PENDING_PAYMENT: "bg-gray-100 text-gray-600 border-gray-200",
  PENDING_PICKUP: "bg-amber-50 text-amber-700 border-amber-100",
  PAID: "bg-blue-50 text-blue-700 border-blue-100",
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-100",
  READY_FOR_PICKUP: "bg-emerald-50 text-emerald-700 border-emerald-100",
  SHIPPED: "bg-emerald-50 text-emerald-700 border-emerald-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
  CANCELLED: "bg-red-50 text-red-600 border-red-100",
  EXPIRED: "bg-red-50 text-red-600 border-red-100",
};

const CANCELLABLE = ["PENDING_PAYMENT", "PENDING_PICKUP", "PAID", "PROCESSING", "READY_FOR_PICKUP"];

const RETURN_STATUS_LABEL = {
  REQUESTED: "Demandée",
  APPROVED: "Approuvée",
  REJECTED: "Refusée",
  COMPLETED: "Terminée",
};
const RETURN_STATUS_STYLE = {
  REQUESTED: "bg-amber-50 text-amber-700 border-amber-100",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-100",
  REJECTED: "bg-red-50 text-red-600 border-red-100",
  COMPLETED: "bg-gray-100 text-gray-500 border-gray-200",
};

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(d) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" }) : "—";
}

export function OrderDetailClient({ order }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pickupDialogOrder, setPickupDialogOrder] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [manualRefundConfirmed, setManualRefundConfirmed] = useState(false);
  const [manualRefundReference, setManualRefundReference] = useState("");
  const [trackingCode, setTrackingCode] = useState(order.trackingCode ?? "");
  const [generatingLabel, setGeneratingLabel] = useState(false);
  const [closingShipped, setClosingShipped] = useState(false);
  const [collectedAt, setCollectedAt] = useState("");
  const [deliveryDoc, setDeliveryDoc] = useState(null);
  const isB2B = order.invoice?.customerType === "B2B";

  function runAction(action, ...args) {
    startTransition(async () => {
      const result = await action(...args);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleShip(e) {
    e.preventDefault();
    if (!trackingCode.trim()) {
      toast.error("Le numéro de suivi est obligatoire.");
      return;
    }
    runAction(markOrderShipped, { orderId: order.id, trackingCode: trackingCode.trim() });
  }

  function handleGenerateLabel() {
    setGeneratingLabel(true);
    generateShippingLabel(order.id).then((result) => {
      setGeneratingLabel(false);
      if (result.success) {
        toast.success(result.message);
        if (result.data?.trackingCode) setTrackingCode(result.data.trackingCode);
        if (result.data?.labelUrl) window.open(result.data.labelUrl, "_blank");
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleCloseShipped() {
    startTransition(async () => {
      const result = await markOrderCompleted({ orderId: order.id, collectedAt });
      if (result.success) {
        toast.success(result.message);
        setClosingShipped(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelOrder({
        orderId: order.id,
        manualRefundConfirmed,
        manualRefundReference: manualRefundReference || undefined,
      });
      if (result.success) {
        toast.success(result.message);
        setCancelling(false);
        router.refresh();
      } else {
        toast.error(result.message);
        setCancelling(false);
      }
    });
  }

  const isPickupMode = order.fulfilmentMode !== "SHIPPING_PREPAID";
  const canMarkReady = isPickupMode && ["PAID", "PENDING_PICKUP"].includes(order.status);
  const canCompletePickup = isPickupMode && ["PAID", "PENDING_PICKUP", "READY_FOR_PICKUP"].includes(order.status);
  const canShip = !isPickupMode && order.status === "PROCESSING";
  const canCloseShipped = !isPickupMode && order.status === "SHIPPED";
  const canCancel = CANCELLABLE.includes(order.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/boutique/orders" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-2xl font-bold text-dark dark:text-white">Commande n°{order.orderNumber}</h1>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[order.status]}`}>
          {STATUS_LABEL[order.status]}
        </span>
      </div>
      <p className="-mt-4 text-sm text-gray-500">{MODE_LABEL[order.fulfilmentMode]} · {formatDate(order.createdAt)}</p>

      {order.cancelReason && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Raison : {order.cancelReason}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Items */}
          <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <div className="border-b border-stroke px-6 py-4 dark:border-dark-3">
              <h2 className="font-semibold text-gray-800 dark:text-white">Articles</h2>
            </div>
            <ul className="divide-y divide-gray-100 px-6">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-gray-800 dark:text-white">{item.productName}</p>
                    <p className="text-xs text-gray-400">
                      {item.variantName ? `${item.variantName} · ` : ""}
                      {item.sku ? `${item.sku} · ` : ""}
                      × {item.quantity}
                    </p>
                  </div>
                  <span className="font-medium text-gray-700 dark:text-dark-6">
                    {formatPrice(item.unitPrice * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5 border-t border-stroke px-6 py-4 dark:border-dark-3">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Sous-total</span>
                <span>{formatPrice(order.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Livraison</span>
                <span>{order.shippingCost > 0 ? formatPrice(order.shippingCost) : "Offerte / —"}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-gray-800 dark:text-white">
                <span>Total</span>
                <span>{formatPrice(order.totalAmount)}</span>
              </div>
            </div>
          </div>

          {order.notes && (
            <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
              <h2 className="mb-2 font-semibold text-gray-800 dark:text-white">Notes du client</h2>
              <p className="text-sm text-gray-600 dark:text-dark-6">{order.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Customer */}
          <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <h2 className="mb-3 font-semibold text-gray-800 dark:text-white">Client</h2>
            {order.user ? (
              <>
                <p className="font-medium text-gray-700 dark:text-dark-6">{order.user.fullName}</p>
                <div className="mt-2 space-y-1.5 text-sm text-gray-500">
                  <a href={`mailto:${order.user.email}`} className="flex items-center gap-2 hover:text-[#2f3a2e]">
                    <Mail size={14} /> {order.user.email}
                  </a>
                  {order.user.phone && (
                    <a href={`tel:${order.user.phone}`} className="flex items-center gap-2 hover:text-[#2f3a2e]">
                      <Phone size={14} /> {order.user.phone}
                    </a>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-700 dark:text-dark-6">Client de passage</p>
                <p className="mt-0.5 text-xs text-gray-400 dark:text-dark-6">
                  Aucun compte — vente anonyme, ticket au lieu d&apos;une facture.
                </p>
                {/* Only the walk-in ticket knows whether an e-mail was ever
                    requested, and whether the send actually succeeded —
                    otherwise unrecoverable once the cashier's one-shot toast
                    is gone. */}
                <div className="mt-3 border-t border-stroke pt-3 text-sm dark:border-dark-3">
                  {order.posTicketEmailTo ? (
                    order.posTicketEmailSentAt ? (
                      <p className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={14} className="shrink-0" />
                        Ticket envoyé à {order.posTicketEmailTo}
                      </p>
                    ) : (
                      <p className="flex items-center gap-2 text-red-600 dark:text-red-400">
                        <XCircle size={14} className="shrink-0" />
                        Échec de l&apos;envoi à {order.posTicketEmailTo}
                      </p>
                    )
                  ) : (
                    <p className="flex items-center gap-2 text-gray-400 dark:text-dark-6">
                      <MinusCircle size={14} className="shrink-0" />
                      Aucun e-mail demandé — ticket papier uniquement
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Fulfilment info */}
          <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <h2 className="mb-3 font-semibold text-gray-800 dark:text-white">
              {isPickupMode ? "Retrait" : "Livraison"}
            </h2>

            {isPickupMode ? (
              <div className="space-y-2 text-sm">
                {order.pickupCode && (
                  <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 font-mono text-base font-semibold tracking-wide text-[#2f3a2e]">
                    <KeyRound size={16} />
                    {order.pickupCode}
                  </div>
                )}
                {order.pickedUpAt ? (
                  <p className="text-gray-500">Retirée le {formatDate(order.pickedUpAt)}</p>
                ) : order.expiresAt ? (
                  <p className="text-gray-500">À retirer avant le {formatDate(order.expiresAt)}</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 text-sm text-gray-600 dark:text-dark-6">
                <p className="flex items-start gap-2">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                  <span>
                    {order.pickupPointName && <>{order.pickupPointName}<br /></>}
                    {order.pickupPointAddress}
                    <br />
                    {order.pickupPointPostalCode} {order.pickupPointCity}
                  </span>
                </p>
                {order.trackingCode && (
                  <p className="flex items-center gap-2 text-gray-500">
                    <Truck size={14} /> Suivi Mondial Relay : {order.trackingCode}
                  </p>
                )}
                {order.shippedAt && <p className="text-gray-400">Expédiée le {formatDate(order.shippedAt)}</p>}
                {order.collectedAt && <p className="text-gray-400">Récupérée le {formatDate(order.collectedAt)}</p>}
              </div>
            )}
          </div>

          {/* Documents. Not gated on an invoice existing: the receipt is
              re-rendered on demand from the order, and a walk-in sale has no
              invoice at all yet still needs its slip reprintable. */}
          <div className="space-y-2 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
            <h2 className="mb-1 font-semibold text-gray-800 dark:text-white">Documents</h2>
              <a
                href={`/api/orders/${order.id}/ticket`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-[#2f3a2e] hover:text-[#2f3a2e] dark:border-dark-3 dark:text-dark-6"
              >
                <span>Reçu / ticket de caisse</span>
                <Printer size={14} />
              </a>
              {order.invoice && (
              <div className="flex items-center gap-2">
                <a
                  href={`/api/invoices/${order.invoice.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-[#2f3a2e] hover:text-[#2f3a2e] dark:border-dark-3 dark:text-dark-6"
                >
                  <span>Facture {order.invoice.number}</span>
                  <Download size={14} />
                </a>
                {isB2B && (
                  <button
                    type="button"
                    onClick={() => setDeliveryDoc({ kind: "INVOICE", document: order.invoice })}
                    className="flex items-center gap-1.5 rounded-lg border border-[#2f3a2e] px-3 py-2 text-xs font-semibold text-[#2f3a2e] hover:bg-[#f4f7f3]"
                  >
                    <Mail size={14} /> {order.invoice.emailSentAt || order.invoice.billitSentAt ? "Gérer l'envoi" : "Envoyer"}
                  </button>
                )}
              </div>
              )}
              {order.creditNotes.map((cn) => (
                <div key={cn.id} className="flex items-center gap-2">
                  <a
                    href={`/api/credit-notes/${cn.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-between rounded-lg border border-red-100 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                  >
                    <span>Télécharger la note de crédit {cn.number}</span>
                    <FileMinus size={14} />
                  </a>
                  {isB2B && (
                    <button
                      type="button"
                      onClick={() => setDeliveryDoc({ kind: "CREDIT_NOTE", document: cn })}
                      className="flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-900 hover:bg-violet-50"
                    >
                      <Mail size={14} /> {cn.emailSentAt || cn.billitSentAt ? "Gérer l'envoi" : "Envoyer"}
                    </button>
                  )}
                </div>
              ))}
          </div>

          {/* Returns */}
          {order.returnRequests?.length > 0 && (
            <div className="space-y-2 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
              <h2 className="mb-1 font-semibold text-gray-800 dark:text-white">Retours</h2>
              {order.returnRequests.map((rr) => (
                <div key={rr.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-dark-3">
                  <span className="text-gray-700 dark:text-dark-6">{rr.itemCount} article(s)</span>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${RETURN_STATUS_STYLE[rr.status]}`}>
                    {RETURN_STATUS_LABEL[rr.status]}
                  </span>
                </div>
              ))}
              <Link href="/dashboard/boutique/returns" className="mt-1 inline-block text-xs font-medium text-[#2f3a2e] hover:underline">
                Gérer les retours →
              </Link>
            </div>
          )}

          {/* Actions */}
          {(canMarkReady || canCompletePickup || canShip || canCloseShipped || canCancel) && (
            <div className="space-y-3 rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
              <h2 className="font-semibold text-gray-800 dark:text-white">Actions</h2>

              {canMarkReady && (
                <Button className="w-full" onClick={() => runAction(markOrderReadyForPickup, order.id)} disabled={isPending}>
                  {isPending && <Loader2 size={14} className="animate-spin" />}
                  Marquer prête pour retrait
                </Button>
              )}

              {canCompletePickup && (
                <Button className="w-full" onClick={() => setPickupDialogOrder(order)} disabled={isPending}>
                  Confirmer le retrait
                </Button>
              )}

              {canShip && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleGenerateLabel}
                    disabled={generatingLabel || isPending}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#2f3a2e] px-4 py-2 text-sm font-medium text-[#2f3a2e] transition-colors hover:bg-[#2f3a2e]/5 disabled:opacity-50 dark:border-dark-3 dark:text-dark-6"
                  >
                    {generatingLabel && <Loader2 size={14} className="animate-spin" />}
                    Générer l&apos;étiquette Mondial Relay
                  </button>
                  <form onSubmit={handleShip} className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Numéro de suivi (manuel si pas d&apos;étiquette générée)
                    </label>
                    <input
                      type="text"
                      value={trackingCode}
                      onChange={(e) => setTrackingCode(e.target.value)}
                      placeholder="ex : 1234567890123"
                      className="h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10 dark:border-dark-3 dark:bg-dark-2 dark:text-white"
                    />
                    <Button type="submit" className="w-full" disabled={isPending}>
                      {isPending && <Loader2 size={14} className="animate-spin" />}
                      Marquer expédiée
                    </Button>
                  </form>
                </div>
              )}

              {canCloseShipped && (
                <Button
                  className="w-full"
                  onClick={() => {
                    setCollectedAt(new Date().toISOString().slice(0, 10));
                    setClosingShipped(true);
                  }}
                  disabled={isPending}
                >
                  Clôturer la commande
                </Button>
              )}

              {canCancel && (
                <button
                  type="button"
                  onClick={() => {
                    setManualRefundConfirmed(false);
                    setManualRefundReference("");
                    setCancelling(true);
                  }}
                  disabled={isPending}
                  className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  Annuler la commande
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <PickupConfirmDialog
        order={pickupDialogOrder}
        onClose={() => setPickupDialogOrder(null)}
        onDone={() => {
          setPickupDialogOrder(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={closingShipped}
        title="Clôturer la commande"
        message="Vérifiez le suivi Mondial Relay et indiquez la date à laquelle la cliente a récupéré le colis au point relais — cette date déclenche son délai légal de rétractation de 14 jours."
        confirmLabel="Clôturer"
        loading={isPending}
        confirmDisabled={!collectedAt}
        onConfirm={handleCloseShipped}
        onCancel={() => setClosingShipped(false)}
      >
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Date de retrait au point relais
        </label>
        <input
          type="date"
          value={collectedAt}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setCollectedAt(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-[#2f3a2e] focus:ring-2 focus:ring-[#2f3a2e]/10"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelling}
        title="Annuler cette commande ?"
        message={
          order.payment?.requiresManualRefund
            ? order.payment.refundInstruction
            : order.hasPayment
              ? "Le client a déjà payé en ligne — le remboursement sera mis en attente de traitement manuel par l'équipe (visible dans Opérations) et le stock sera remis en vente."
            : "Le stock réservé sera libéré."
        }
        confirmLabel="Annuler la commande"
        danger
        loading={isPending}
        confirmDisabled={Boolean(
          order.payment?.requiresManualRefund &&
            (!manualRefundConfirmed || (order.payment.paymentMethod === "CARD" && !manualRefundReference.trim()))
        )}
        onConfirm={handleCancel}
        onCancel={() => setCancelling(false)}
      >
        {order.payment?.requiresManualRefund && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p><span className="font-semibold">Paiement d'origine : </span>{order.payment.paymentMethodLabel}</p>
            <label className="mt-3 flex items-start gap-2 font-medium">
              <input
                type="checkbox"
                checked={manualRefundConfirmed}
                onChange={(event) => setManualRefundConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-amber-400"
              />
              Je confirme que le remboursement a déjà été effectué au client.
            </label>
            {order.payment.paymentMethod === "CARD" && (
              <input
                value={manualRefundReference}
                onChange={(event) => setManualRefundReference(event.target.value)}
                maxLength={100}
                placeholder="Référence du ticket terminal (obligatoire)"
                className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#2f3a2e]"
              />
            )}
          </div>
        )}
      </ConfirmDialog>

      <DocumentDeliveryDialog
        open={Boolean(deliveryDoc)}
        onClose={() => setDeliveryDoc(null)}
        document={deliveryDoc?.document ?? null}
        invoice={order.invoice}
        kind={deliveryDoc?.kind ?? "INVOICE"}
        onDelivered={() => router.refresh()}
      />
    </div>
  );
}
