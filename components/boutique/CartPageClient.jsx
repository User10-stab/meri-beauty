"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { updateCartItemQuantity, removeFromCart } from "@/actions/boutique/cart";
import { calculateCartPricing, calculateItemPricing, formatPrice } from "@/lib/pricing";
import { useTranslations } from "next-intl";

function notifyCartUpdated(itemCount) {
  // Passing the count lets the header badge update in the same tick as this
  // page's own optimistic state, instead of waiting on a second round trip
  // to re-fetch it.
  window.dispatchEvent(new CustomEvent("boutique:cart-updated", { detail: { itemCount } }));
}

export function CartPageClient({ initialCart }) {
  const t = useTranslations("boutique");
  const [cart, setCart] = useState(initialCart);
  const [isPending, startTransition] = useTransition();

  // Calculate detailed pricing breakdown for the entire cart
  const cartPricing = useMemo(() => calculateCartPricing(cart.items), [cart.items]);

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
            const itemPricing = calculateItemPricing(item);
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

          {/* Before TVA */}
          <div className="flex justify-between text-sm text-gray-600">
            <span>{t("subtotalExclVat")}</span>
            <span className="font-medium text-[#2F3A2E]">{formatPrice(cartPricing.totalHT)}</span>
          </div>

          {/* TVA amount */}
          <div className="flex justify-between text-sm text-gray-600">
            <span>{t("vat", { rate: 21 })}</span>
            <span className="font-medium text-[#2F3A2E]">{formatPrice(cartPricing.totalVAT)}</span>
          </div>

          {/* Savings (if applicable) */}
          {cartPricing.hasPromotions && (
            <div className="flex justify-between text-sm text-green-600">
              <span>{t("promoDiscount")}</span>
              <span className="font-medium">-{formatPrice(cartPricing.totalSavings)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between text-base font-semibold text-[#2F3A2E] mt-3 pt-3 border-t border-neutral-200">
            <span>{t("totalInclVat")}</span>
            <span>{formatPrice(cartPricing.totalTTC)}</span>
          </div>

          <p className="mt-3 text-xs text-gray-400">{t("shippingNotice")}</p>

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
