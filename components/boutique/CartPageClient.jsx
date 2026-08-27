"use client";

import { useState, useTransition, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { updateCartItemQuantity, removeFromCart } from "@/actions/boutique/cart";
import { getCartShippingCost } from "@/actions/boutique/shipping";
import { calculateCartPricing, calculateItemPricing, formatPrice } from "@/lib/pricing";
import { BELGIUM_VAT_RATE, resolveGoodsVatPolicy, roundMoney } from "@/lib/tax-policy";
import { useTranslations } from "next-intl";

function notifyCartUpdated(itemCount) {
  // Passing the count lets the header badge update in the same tick as this
  // page's own optimistic state, instead of waiting on a second round trip
  // to re-fetch it.
  window.dispatchEvent(new CustomEvent("boutique:cart-updated", { detail: { itemCount } }));
}

export function CartPageClient({ initialCart, customerSession = null }) {
  const t = useTranslations("boutique");
  const [cart, setCart] = useState(initialCart);
  const [isPending, startTransition] = useTransition();

  const vatRate = useMemo(() => {
    try {
      return resolveGoodsVatPolicy({
        fulfilmentMode: "PICKUP_PREPAID",
        destinationCountry: "BE",
        customer: customerSession,
      }).vatRate;
    } catch {
      return BELGIUM_VAT_RATE;
    }
  }, [customerSession]);

  // Calculate detailed pricing with the same VAT policy used by checkout.
  const cartPricing = useMemo(() => calculateCartPricing(cart.items, vatRate), [cart.items, vatRate]);

  // Carriage, from the same server action the checkout calls — weightGrams is
  // not serialised into the cart, so this cannot be computed on the client.
  // It is an ESTIMATE here and labelled as one: the customer has not chosen
  // between point-relais delivery and free in-salon pickup yet, so the figure
  // shown is the worst case of the two.
  const [shipping, setShipping] = useState({ costExclVat: 0, cost: 0, isFree: true, loading: true, quoteRequired: false });

  useEffect(() => {
    if (cart.items.length === 0) {
      setShipping({ costExclVat: 0, cost: 0, isFree: true, loading: false, quoteRequired: false });
      return;
    }
    let cancelled = false;
    getCartShippingCost()
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setShipping({ costExclVat: 0, cost: 0, isFree: false, loading: false, quoteRequired: Boolean(result.data?.quoteRequired) });
          return;
        }
        setShipping({
          costExclVat: Number(result.data.costExclVat) || 0,
          cost: Number(result.data.cost) || 0,
          isFree: Boolean(result.data.isFree),
          untilFree: Number(result.data.untilFree) || 0,
          loading: false,
          quoteRequired: false,
        });
      })
      .catch(() => {
        if (!cancelled) setShipping((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // itemCount rather than the items array: quantity is what moves the
    // weight tier, and depending on the array itself would refetch on every
    // optimistic re-render.
  }, [cart.itemCount]);

  // Carriage is taxed at the same rate as the goods, so the two are summed
  // before the split rather than shown as separate VAT lines.
  const totals = useMemo(() => {
    const shippingNet = shipping.quoteRequired ? 0 : shipping.costExclVat;
    const shippingVat = roundMoney(shipping.cost - shipping.costExclVat);
    return {
      subtotalHT: roundMoney(cartPricing.totalHT),
      shippingHT: roundMoney(shippingNet),
      vat: roundMoney(cartPricing.totalVAT + shippingVat),
      totalTTC: roundMoney(cartPricing.totalTTC + (shipping.quoteRequired ? 0 : shipping.cost)),
    };
  }, [cartPricing, shipping]);

  function updateQuantity(item, nextQuantity) {
    // Optimistic update — the server re-validates stock and we roll back on failure.
    const previous = cart;
    const items = nextQuantity === 0 ? cart.items.filter((i) => i.id !== item.id) : cart.items.map((i) => (i.id === item.id ? { ...i, quantity: nextQuantity } : i));
    const subtotal = items.reduce((sum, i) => sum + i.variant.price * i.quantity, 0);
    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    setCart({ ...cart, items, subtotal, itemCount });
    notifyCartUpdated(itemCount);

    startTransition(async () => {
      const result = await updateCartItemQuantity({ cartItemId: item.id, quantity: nextQuantity });
      if (!result.success) {
        toast.error(result.message);
        setCart(previous);
        notifyCartUpdated(previous.itemCount);
        return;
      }
    });
  }

  function handleRemove(item) {
    const previous = cart;
    const items = cart.items.filter((i) => i.id !== item.id);
    const subtotal = items.reduce((sum, i) => sum + i.variant.price * i.quantity, 0);
    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    setCart({ ...cart, items, subtotal, itemCount });
    notifyCartUpdated(itemCount);

    startTransition(async () => {
      const result = await removeFromCart(item.id);
      if (!result.success) {
        toast.error(result.message);
        setCart(previous);
        notifyCartUpdated(previous.itemCount);
        return;
      }
    });
  }

  if (cart.items.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <ShoppingBag size={40} className="text-gray-300" />
        <h1 className="text-2xl text-[#2F3A2E]">{t("cartEmptyTitle")}</h1>
        <p className="max-w-sm text-sm text-gray-500">
          {t("cartEmptySubtitle")}
        </p>
        <Link
          href="/boutique"
          className="mt-4 inline-block bg-[#C8A46A] px-8 py-3 text-sm font-medium uppercase tracking-wider text-white transition-colors hover:bg-[#B8945A]"
        >
          {t("viewShop")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-6 py-12 md:px-10">
      <h1 className="mb-8 text-3xl text-[#2F3A2E]">{t("cartTitle")}</h1>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_320px]">
        <ul className={`divide-y divide-neutral-100 ${isPending ? "opacity-60" : ""}`}>
          {cart.items.map((item) => {
            const itemPricing = calculateItemPricing(item, vatRate);
            return (
            <li key={item.id} className="flex gap-4 py-6">
              <Link href={`/boutique/${item.variant.product.slug}`} className="relative h-24 w-24 flex-shrink-0 overflow-hidden bg-neutral-50">
                {item.variant.product.image ? (
                  <Image src={item.variant.product.image} alt="" fill sizes="96px" className="object-cover" />
                ) : null}
              </Link>

              <div className="flex flex-1 flex-col justify-between">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <Link href={`/boutique/${item.variant.product.slug}`} className="text-sm font-medium text-[#2F3A2E] hover:text-[#C8A46A]">
                      {item.variant.product.name}
                    </Link>
                    {item.variant.name !== "Standard" && <p className="mt-0.5 text-xs text-gray-400">{item.variant.name}</p>}

                    {/* Pricing breakdown for this item */}
                    <div className="mt-2 space-y-1 text-xs">
                      {itemPricing.savings > 0 && (
                        <div className="text-gray-400">
                          <span className="line-through">{formatPrice(itemPricing.originalPrice / itemPricing.quantity)} / unit</span>
                          <span className="text-green-600 ml-2">{t("promoDiscount")}: {formatPrice(itemPricing.savings)}</span>
                        </div>
                      )}
                      <div className="text-gray-500">
                        {formatPrice(itemPricing.subtotalExclVat / itemPricing.quantity)} HT/unit + {formatPrice(itemPricing.vatAmount / itemPricing.quantity)} TVA
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    className="text-gray-300 transition-colors hover:text-red-500"
                    aria-label={t("removeFromCart")}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center border border-neutral-200">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item, Math.max(0, item.quantity - 1))}
                      className="flex h-9 w-9 items-center justify-center text-[#2F3A2E] hover:bg-neutral-50"
                      aria-label={t("decreaseQuantity")}
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-8 text-center text-sm font-medium text-[#2F3A2E]">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item, item.quantity + 1)}
                      className="flex h-9 w-9 items-center justify-center text-[#2F3A2E] hover:bg-neutral-50"
                      aria-label={t("increaseQuantity")}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="text-right">
                    <span className="block text-sm font-semibold text-[#2F3A2E]">
                      {formatPrice(itemPricing.totalPrice)}
                    </span>
                    <span className="block text-xs text-gray-500">TTC</span>
                  </div>
                </div>
              </div>
            </li>
          );
          })}
        </ul>

        {/* Summary */}
        <div className="h-fit border border-neutral-200 p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">{t("summary")}</h2>

          {/* Before promotion (if applicable) */}
          {cartPricing.hasPromotions && (
            <div className="flex justify-between text-sm text-gray-500 mb-2">
              <span>{t("beforePromo")}</span>
              <span className="line-through">{formatPrice(cartPricing.totalOriginalTTC)}</span>
            </div>
          )}

          {/* The catalogue is stored net, so the breakdown reads in the order
              the price is actually built: goods HT, carriage HT, the VAT on
              both, then the amount to pay. */}
          <div className="flex justify-between text-sm text-gray-600">
            <span>{t("subtotalExclVat")}</span>
            <span className="font-medium text-[#2F3A2E]">{formatPrice(totals.subtotalHT)}</span>
          </div>

          <div className="mt-1 flex justify-between text-sm text-gray-600">
            <span>{t("shippingExclVat")}</span>
            <span className="font-medium text-[#2F3A2E]">
              {shipping.loading
                ? "…"
                : shipping.quoteRequired
                  ? t("quoteRequired")
                  : shipping.isFree
                    ? t("shippingFree")
                    : formatPrice(totals.shippingHT)}
            </span>
          </div>

          {/* TVA amount */}
          <div className="mt-1 flex justify-between text-sm text-gray-600">
            <span>{t("vat", { rate: vatRate })}</span>
            <span className="font-medium text-[#2F3A2E]">{formatPrice(totals.vat)}</span>
          </div>

          {/* Savings (if applicable) */}
          {cartPricing.hasPromotions && (
            <div className="mt-1 flex justify-between text-sm text-green-600">
              <span>{t("promoDiscount")}</span>
              <span className="font-medium">-{formatPrice(cartPricing.totalSavings)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between text-base font-semibold text-[#2F3A2E] mt-3 pt-3 border-t border-neutral-200">
            <span>{t("totalInclVat")}</span>
            <span>{shipping.quoteRequired ? "—" : formatPrice(totals.totalTTC)}</span>
          </div>

          <p className="mt-3 text-xs text-gray-400">
            {shipping.quoteRequired ? t("shippingQuoteNotice") : t("shippingEstimateNotice")}
          </p>

          <Link
            href="/boutique/checkout"
            className="mt-6 flex w-full items-center justify-center bg-[#C8A46A] px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#B8945A]"
          >
            {t("checkoutAction")}
          </Link>
          <Link
            href="/boutique"
            className="mt-3 flex w-full items-center justify-center border border-neutral-200 px-6 py-3 text-sm font-medium text-[#2F3A2E] transition-colors hover:border-[#2F3A2E]"
          >
            {t("continueShopping")}
          </Link>
        </div>
      </div>
    </div>
  );
}
