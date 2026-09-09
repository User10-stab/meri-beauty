"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PackageSearch, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { confirmExpiredPickupNotCollected } from "@/actions/boutique/orders";
import { PickupConfirmDialog } from "@/components/dashboard/boutique/PickupConfirmDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * The two-outcome worklist for expired on-site pickups.
 *
 * An expired pickup is one of two completely different situations wearing the
 * same status: the goods are on a shelf, or they are already in a customer's
 * bag because staff handed them over without running the pickup flow. The
 * cron cannot tell, so it no longer restocks on a guess — it leaves the
 * reservation in place and lists the order here, where whoever can walk over
 * and look decides. Doing nothing keeps stock reserved, which is the safe
 * failure: an item briefly unavailable, never one sold twice.
 */
export function PickupsToVerify({ orders }) {
  const t = useTranslations("dashboardBoutique.pickupsToVerify");
  const router = useRouter();
  const [pickupOrder, setPickupOrder] = useState(null);
  const [releaseOrder, setReleaseOrder] = useState(null);
  const [releasing, startReleasing] = useTransition();

  if (!orders || orders.length === 0) return null;

  function handleRelease() {
    const order = releaseOrder;
    if (!order) return;
    startReleasing(async () => {
      const result = await confirmExpiredPickupNotCollected({ orderId: order.id });
      if (result.success) {
        toast.success(result.message);
        setReleaseOrder(null);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5 dark:border-amber-500/40 dark:bg-amber-500/5">
      <div className="flex items-start gap-3">
        <PackageSearch size={18} className="mt-0.5 flex-shrink-0 text-amber-700 dark:text-amber-400" />
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("title")} — {t("count", { count: orders.length })}
          </h2>
          <p className="mt-1 text-[13px] text-gray-600 dark:text-dark-6">{t("subtitle")}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {orders.map((order) => (
          <li
            key={order.id}
            className="rounded-xl border border-amber-200 bg-white p-4 dark:border-amber-500/30 dark:bg-gray-dark"
          >
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              n°{order.orderNumber} — {order.user?.fullName ?? "—"}
            </p>
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-dark-6">
              {order.user?.email}
              {order.user?.phone ? ` · ${order.user.phone}` : ""}
            </p>
            {order.cancelledAt && (
              <p className="mt-0.5 text-[12px] text-gray-500 dark:text-dark-6">
                {t("expiredOn", {
                  date: new Date(order.cancelledAt).toLocaleDateString("fr-BE", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    timeZone: "Europe/Brussels",
                  }),
                })}
              </p>
            )}
            <ul className="mt-2 space-y-0.5">
              {order.items.map((item) => (
                <li key={item.id} className="text-[12px] text-gray-700 dark:text-gray-300">
                  {item.quantity} × {item.productName} — {item.variantName}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setPickupOrder({
                    id: order.id,
                    orderNumber: order.orderNumber,
                    user: order.user,
                    hasPayment: Boolean(order.payment),
                    // Required, not decorative: an on-site pickup is unpaid,
                    // so the dialog shows the amount the counter has to take
                    // and cannot render without it.
                    totalAmount: order.totalAmount,
                  })
                }
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-gray-800"
              >
                {t("collected")}
              </button>
              <button
                type="button"
                onClick={() => setReleaseOrder(order)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[13px] font-medium text-amber-800 hover:bg-amber-50 dark:bg-transparent dark:text-amber-300"
              >
                {t("notCollected")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <PickupConfirmDialog
        order={pickupOrder}
        onClose={() => setPickupOrder(null)}
        onDone={() => {
          setPickupOrder(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={Boolean(releaseOrder)}
        title={t("notCollected")}
        message={t("confirmNotCollected")}
        confirmLabel={releasing ? t("releasing") : t("notCollected")}
        loading={releasing}
        onConfirm={handleRelease}
        onCancel={() => !releasing && setReleaseOrder(null)}
      />
    </section>
  );
}
