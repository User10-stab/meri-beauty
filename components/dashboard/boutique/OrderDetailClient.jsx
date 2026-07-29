"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Mail, Phone, MapPin, Truck, KeyRound } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PickupConfirmDialog } from "@/components/dashboard/boutique/PickupConfirmDialog";
import { markOrderReadyForPickup, markOrderShipped, markOrderCompleted, cancelOrder } from "@/actions/boutique/orders";

const MODE_LABEL = {
  PICKUP_PREPAID: "Retrait en boutique (payé en ligne)",
  PICKUP_ON_SITE: "Retrait en boutique (paiement sur place)",
  SHIPPING_PREPAID: "Livraison bpost",
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

function formatPrice(n) {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" }).format(n);
}
function formatDate(d) {
  return d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function OrderDetailClient({ order }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pickupDialogOrder, setPickupDialogOrder] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [trackingCode, setTrackingCode] = useState(order.bpostTrackingCode ?? "");

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
      toast.error("Le numéro de suivi bpost est obligatoire.");
      return;
    }
    runAction(markOrderShipped, { orderId: order.id, bpostTrackingCode: trackingCode.trim() });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelOrder({ orderId: order.id });
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
                      {item.variantName} · {item.sku} · × {item.quantity}
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
            <p className="font-medium text-gray-700 dark:text-dark-6">{order.user?.fullName}</p>
            <div className="mt-2 space-y-1.5 text-sm text-gray-500">
              <a href={`mailto:${order.user?.email}`} className="flex items-center gap-2 hover:text-[#2f3a2e]">
                <Mail size={14} /> {order.user?.email}
              </a>
              {order.user?.phone && (
                <a href={`tel:${order.user.phone}`} className="flex items-center gap-2 hover:text-[#2f3a2e]">
                  <Phone size={14} /> {order.user.phone}
                </a>
              )}
            </div>
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
                    {order.shippingLine1}
                    {order.shippingLine2 && <>, {order.shippingLine2}</>}
                    <br />
                    {order.shippingPostalCode} {order.shippingCity}, {order.shippingCountry}
                  </span>
                </p>
                {order.bpostTrackingCode && (
                  <p className="flex items-center gap-2 text-gray-500">
                    <Truck size={14} /> Suivi bpost : {order.bpostTrackingCode}
                  </p>
                )}
                {order.shippedAt && <p className="text-gray-400">Expédiée le {formatDate(order.shippedAt)}</p>}
              </div>
            )}
          </div>

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
                <form onSubmit={handleShip} className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                    Numéro de suivi bpost
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
              )}

              {canCloseShipped && (
                <Button className="w-full" onClick={() => runAction(markOrderCompleted, order.id)} disabled={isPending}>
                  {isPending && <Loader2 size={14} className="animate-spin" />}
                  Clôturer la commande
                </Button>
              )}

              {canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelling(true)}
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
        open={cancelling}
        title="Annuler cette commande ?"
        message={
          order.hasPayment
            ? "Le client a déjà payé en ligne — un remboursement Stripe sera automatiquement déclenché et le stock sera remis en vente."
            : "Le stock réservé sera libéré."
        }
        confirmLabel="Annuler la commande"
        danger
        loading={isPending}
        onConfirm={handleCancel}
        onCancel={() => setCancelling(false)}
      />
    </div>
  );
}
