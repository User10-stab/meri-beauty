"use client";

import { useState } from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingBag, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { addToCart } from "@/actions/boutique/cart";

export function ProductDetailClient({ product, initialVariantId }) {
  const hasInitialVariant = product.variants.some((v) => v.id === initialVariantId);
  const [selectedVariantId, setSelectedVariantId] = useState(
    hasInitialVariant ? initialVariantId : product.variants[0]?.id ?? null
  );
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const variant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  const hasMultipleVariants = product.variants.length > 1;
  const inStock = variant && variant.availableQuantity > 0;

  async function handleAddToCart() {
    if (!variant) return;
    setAdding(true);
    const result = await addToCart({ variantId: variant.id, quantity });
    setAdding(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success("Ajouté au panier.");
    window.dispatchEvent(new Event("boutique:cart-updated")); // updates the header badge (client-fetched)
  }

  return (
    <div className="w-full bg-white">
      <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10 lg:px-14">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1.5 text-xs text-gray-400">
          <Link href="/boutique" className="hover:text-[#2F3A2E]">
            Boutique
          </Link>
          <ChevronRight size={12} />
          <span>{product.category.name}</span>
          <ChevronRight size={12} />
          <span className="text-[#2F3A2E]">{product.subcategory.name}</span>
        </nav>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          {/* Images */}
          <div>
            <div className="aspect-square overflow-hidden bg-neutral-50">
              {product.images[activeImage] ? (
                <img
                  src={product.images[activeImage].path}
                  alt={product.images[activeImage].alt ?? product.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm uppercase tracking-wide text-gray-300">
                  Meri Beauty
                </div>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2">
                {product.images.map((img, i) => (
                  <button
                    key={img.path + i}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    className={`h-16 w-16 overflow-hidden border-2 transition-colors ${
                      activeImage === i ? "border-[#C8A46A]" : "border-transparent"
                    }`}
                  >
                    <img src={img.path} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            {product.brand && (
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">{product.brand.name}</p>
            )}
            <h1 className="mt-2 text-3xl text-[#2F3A2E]">{product.name}</h1>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-2xl font-semibold text-[#2F3A2E]">€{(variant?.price ?? 0).toFixed(2)}</span>
              {variant?.comparePrice != null && (
                <span className="text-base text-gray-400 line-through">€{variant.comparePrice.toFixed(2)}</span>
              )}
            </div>

            {product.description && (
              <p className="mt-6 whitespace-pre-line text-sm leading-7 text-gray-600">{product.description}</p>
            )}

            {hasMultipleVariants && (
              <div className="mt-8">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#2F3A2E]">Déclinaison</h3>
                <div className="flex flex-wrap gap-2">
                  {product.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVariantId(v.id)}
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

            <div className="mt-4 text-sm">
              {inStock ? (
                <span className="text-green-700">
                  {variant.availableQuantity <= 5
                    ? `Il ne reste que ${variant.availableQuantity} en stock`
                    : "En stock"}
                </span>
              ) : (
                <span className="text-gray-400">Rupture de stock</span>
              )}
            </div>

            <div className="mt-6 flex items-center gap-4">
              <div className="flex items-center border border-neutral-200">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-11 w-11 items-center justify-center text-[#2F3A2E] hover:bg-neutral-50"
                  aria-label="Diminuer la quantité"
                >
                  <Minus size={14} />
                </button>
                <span className="w-10 text-center text-sm font-medium text-[#2F3A2E]">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  className="flex h-11 w-11 items-center justify-center text-[#2F3A2E] hover:bg-neutral-50"
                  aria-label="Augmenter la quantité"
                >
                  <Plus size={14} />
                </button>
              </div>

              <button
                type="button"
                onClick={handleAddToCart}
                disabled={!inStock || adding}
                className="flex flex-1 items-center justify-center gap-2 bg-[#C8A46A] px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <ShoppingBag size={16} />
                {adding ? "Ajout…" : "Ajouter au panier"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
