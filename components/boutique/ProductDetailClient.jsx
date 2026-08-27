"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ChevronDown,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { addToCart } from "@/actions/boutique/cart";
import { useTranslations } from "next-intl";
import { ProductPrice } from "@/components/boutique/ProductPrice";

/** Collapsible block for the long-form copy that sits under the buy box.
 *  The description used to render above the add-to-cart button, so a product
 *  with a lot of text pushed the button off the first screen. */
function Accordion({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-neutral-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2F3A2E]">{title}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="pb-5">{children}</div>}
    </div>
  );
}

export function ProductDetailClient({ product, initialVariantId }) {
  const t = useTranslations("boutique");
  const hasInitialVariant = product.variants.some((v) => v.id === initialVariantId);
  const [selectedVariantId, setSelectedVariantId] = useState(
    hasInitialVariant ? initialVariantId : product.variants[0]?.id ?? null
  );
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [buyRowVisible, setBuyRowVisible] = useState(true);
  const buyRowRef = useRef(null);

  const variant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  const hasMultipleVariants = product.variants.length > 1;
  const available = variant?.availableQuantity ?? 0;
  const inStock = available > 0;
  const maxQuantity = Math.min(available, 99);

  const discount =
    variant?.comparePrice != null && variant.comparePrice > variant.price
      ? Math.round((1 - variant.price / variant.comparePrice) * 100)
      : null;

  // The mobile buy bar stands in for the real add-to-cart row, so it only
  // appears once that row has scrolled out of view — never both at once.
  useEffect(() => {
    const node = buyRowRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => setBuyRowVisible(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function handleSelectVariant(id) {
    setSelectedVariantId(id);
    // Don't carry over a quantity the new declension can't honour — the server
    // would reject it and the shopper would only find out at checkout.
    const next = product.variants.find((v) => v.id === id);
    if (next) setQuantity((q) => Math.min(q, Math.max(next.availableQuantity, 1)));
  }

  async function handleAddToCart() {
    if (!variant) return;
    setAdding(true);
    const result = await addToCart({ variantId: variant.id, quantity });
    setAdding(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(t("addedToCart"));
    window.dispatchEvent(new Event("boutique:cart-updated")); // updates the header badge (client-fetched)
  }

  const addToCartButton = (
    <button
      type="button"
      onClick={handleAddToCart}
      disabled={!inStock || adding}
      className="flex flex-1 items-center justify-center gap-2 bg-[#C8A46A] px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:bg-gray-300"
    >
      <ShoppingBag size={16} />
      {adding ? t("adding") : inStock ? t("addToCart") : t("outOfStock")}
    </button>
  );

  return (
    <div className="w-full bg-white">
      {/* pb-24 on mobile keeps the sticky buy bar from covering the last section */}
      <div className="mx-auto max-w-[1400px] px-6 pb-24 pt-8 md:px-10 lg:px-14 lg:pb-16">
        {/* Breadcrumb */}
        <nav className="mb-8 flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
          <Link href="/boutique" className="transition-colors hover:text-[#2F3A2E]">
            {t("title")}
          </Link>
          {product.category && (
            <>
              <ChevronRight size={12} className="shrink-0" />
              <span>{product.category.name}</span>
            </>
          )}
          {product.subcategory && (
            <>
              <ChevronRight size={12} className="shrink-0" />
              <span className="text-[#2F3A2E]">{product.subcategory.name}</span>
            </>
          )}
        </nav>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16">
          {/* ── Gallery — sticks while the buy box and its copy scroll past ── */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="relative aspect-square overflow-hidden bg-neutral-50">
              {product.images[activeImage] ? (
                <Image
                  src={product.images[activeImage].path}
                  alt={product.images[activeImage].alt ?? product.name}
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  priority
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm uppercase tracking-wide text-gray-300">
                  Meri Beauty
                </div>
              )}

              {discount != null && (
                <span className="absolute left-4 top-4 bg-[#2F3A2E] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">
                  −{discount}%
                </span>
              )}
              {!inStock && (
                <span className="absolute right-4 top-4 bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  {t("soldOut")}
                </span>
              )}
            </div>

            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {product.images.map((img, i) => (
                  <button
                    key={img.path + i}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={`${product.name} — ${i + 1}`}
                    aria-current={activeImage === i}
                    className={`relative h-16 w-16 shrink-0 overflow-hidden border-2 transition-colors ${
                      activeImage === i ? "border-[#C8A46A]" : "border-transparent hover:border-neutral-200"
                    }`}
                  >
                    <Image src={img.path} alt="" fill sizes="64px" className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Buy box ── */}
          <div>
            <h1 className="font-display text-3xl leading-tight text-[#2F3A2E] md:text-4xl">{product.name}</h1>

            <div className="mt-4">
              <ProductPrice
                priceIncl={variant?.price ?? 0}
                priceExcl={variant?.priceExclVat ?? null}
                compareIncl={variant?.comparePrice ?? null}
                compareExcl={variant?.comparePriceExclVat ?? null}
                size="lg"
              />
            </div>

            {hasMultipleVariants && (
              <div className="mt-8">
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#2F3A2E]">
                  {t("variant")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => handleSelectVariant(v.id)}
                      disabled={v.availableQuantity === 0}
                      className={`border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selectedVariantId === v.id
                          ? "border-[#2F3A2E] bg-[#2F3A2E] text-white"
                          : "border-neutral-200 text-[#2F3A2E] hover:border-[#C8A46A]"
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center gap-2 text-sm">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${inStock ? "bg-green-600" : "bg-gray-300"}`}
              />
              {inStock ? (
                <span className={available <= 5 ? "text-[#B8945A]" : "text-green-700"}>
                  {available <= 5 ? t("remainingInStock", { count: available }) : t("stock")}
                </span>
              ) : (
                <span className="text-gray-400">{t("outOfStock")}</span>
              )}
            </div>

            {/* Buy row — kept above the long-form copy so a wordy product
                description can never push it below the fold. */}
            <div ref={buyRowRef} className="mt-6 flex items-center gap-4">
              <div className="flex items-center border border-neutral-200">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="flex h-11 w-11 items-center justify-center text-[#2F3A2E] transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-gray-300"
                  aria-label={t("decreaseQuantity")}
                >
                  <Minus size={14} />
                </button>
                <span className="w-10 text-center text-sm font-medium text-[#2F3A2E]">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                  disabled={!inStock || quantity >= maxQuantity}
                  className="flex h-11 w-11 items-center justify-center text-[#2F3A2E] transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-gray-300"
                  aria-label={t("increaseQuantity")}
                >
                  <Plus size={14} />
                </button>
              </div>

              {addToCartButton}
            </div>

            {/* Reassurance strip */}
            <ul className="mt-6 grid grid-cols-3 gap-3 border-y border-neutral-200 py-4 text-center">
              {[
                { Icon: Store, label: t("trustPickup") },
                { Icon: Truck, label: t("trustShipping") },
                { Icon: ShieldCheck, label: t("trustSecure") },
              ].map(({ Icon, label }) => (
                <li key={label} className="flex flex-col items-center gap-1.5">
                  <Icon size={18} className="text-[#C8A46A]" strokeWidth={1.5} />
                  <span className="text-[11px] leading-tight text-gray-500">{label}</span>
                </li>
              ))}
            </ul>

            {/* Long-form copy — collapsible, so its length never affects the
                position of anything above it. */}
            <div className="mt-2">
              {product.description && (
                <Accordion title={t("descriptionTitle")} defaultOpen>
                  <p className="whitespace-pre-line text-sm leading-7 text-gray-600">{product.description}</p>
                </Accordion>
              )}

              <Accordion title={t("deliveryTitle")}>
                <ul className="space-y-3 text-sm leading-6 text-gray-600">
                  {[
                    { Icon: Store, line: t("deliveryPickupLine") },
                    { Icon: Truck, line: t("deliveryShippingLine") },
                    { Icon: RotateCcw, line: t("deliveryReturnsLine") },
                  ].map(({ Icon, line }) => (
                    <li key={line} className="flex gap-3">
                      <Icon size={16} strokeWidth={1.5} className="mt-1 shrink-0 text-[#C8A46A]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </Accordion>

              {variant?.sku && (
                <Accordion title={t("referenceTitle")}>
                  <p className="text-sm text-gray-600">{variant.sku}</p>
                </Accordion>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile buy bar — appears once the real buy row scrolls away.
             Hidden from focus and screen readers while parked off-screen, so
             it never reads as a second add-to-cart button. ── */}
      <div
        inert={buyRowVisible}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 px-5 py-3 backdrop-blur transition-transform duration-200 lg:hidden ${
          buyRowVisible ? "translate-y-full" : "translate-y-0"
        }`}
      >
        <div className="mx-auto flex max-w-[1400px] items-center gap-4">
          <div className="min-w-0">
            <p className="truncate text-xs text-gray-500">{product.name}</p>
            <ProductPrice priceIncl={variant?.price ?? 0} priceExcl={variant?.priceExclVat ?? null} size="compact" />
          </div>
          {addToCartButton}
        </div>
      </div>
    </div>
  );
}
