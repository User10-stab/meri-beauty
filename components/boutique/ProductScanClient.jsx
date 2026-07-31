"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CameraOff, ShoppingBag, X } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { getStorefrontProductByBarcode } from "@/actions/boutique/storefront";
import { addToCart } from "@/actions/boutique/cart";

/**
 * In-store self-scan: point the camera at a product's barcode (EAN/UPC on
 * the packaging). A hit pauses decoding and shows an inline confirm card
 * (name, image, price) with "Add to cart" / "Cancel" — it never navigates
 * away, since the customer is typically scanning several items in a row and
 * may want to retry a misread as many times as needed. The camera itself is
 * never stopped between scans, only the decode results are ignored while a
 * card is showing (foundRef), so resuming is instant.
 */
export function ProductScanClient() {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const foundRef = useRef(false);
  const lastCodeRef = useRef(null);
  const [error, setError] = useState(null);
  const [found, setFound] = useState(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        async (result, err, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result || busyRef.current || foundRef.current) return;

          const code = result.getText().trim();
          if (code === lastCodeRef.current) return; // avoid re-firing on the same held-up barcode

          busyRef.current = true;
          lastCodeRef.current = code;

          const lookup = await getStorefrontProductByBarcode(code);
          busyRef.current = false;

          if (cancelled) return;

          if (!lookup.success) {
            toast.error(lookup.message);
            setTimeout(() => {
              lastCodeRef.current = null; // allow retrying the same code after a miss
            }, 1500);
            return;
          }

          foundRef.current = true;
          setFound(lookup.data);
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[ProductScanClient] camera init failed:", err);
        setError("Impossible d'accéder à la caméra — vérifiez les autorisations de votre navigateur.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, []);

  function resumeScanning() {
    foundRef.current = false;
    lastCodeRef.current = null;
    setFound(null);
  }

  async function handleAddToCart() {
    if (!found) return;
    setAdding(true);
    const result = await addToCart({ variantId: found.variantId, quantity: 1 });
    setAdding(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success("Ajouté au panier.");
    window.dispatchEvent(new Event("boutique:cart-updated")); // updates the header badge (client-fetched)
    resumeScanning();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#C8A46A]">Boutique</p>
      <h1 className="mb-3 text-2xl text-[#2F3A2E]">Scanner un produit</h1>
      <p className="mb-8 text-sm text-gray-500">
        Visez le code-barres sur l'emballage pour voir la fiche produit, le prix et le stock.
      </p>

      {error ? (
        <div className="flex w-full flex-col items-center gap-3 border border-neutral-200 bg-neutral-50 px-6 py-16">
          <CameraOff size={22} className="text-gray-300" />
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      ) : (
        <div className="relative w-full overflow-hidden bg-black">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />

          {found && (
            <div className="absolute inset-0 flex flex-col justify-end bg-black/60 p-4">
              <div className="w-full bg-white p-4 text-left shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden bg-neutral-50">
                    {found.image ? (
                      <img src={found.image} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] uppercase text-gray-300">
                        Meri Beauty
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#2F3A2E]">{found.productName}</p>
                    {found.variantName && found.variantName !== "Standard" && (
                      <p className="truncate text-xs text-gray-400">{found.variantName}</p>
                    )}
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-[#2F3A2E]">€{found.price.toFixed(2)}</span>
                      {found.comparePrice != null && (
                        <span className="text-xs text-gray-400 line-through">€{found.comparePrice.toFixed(2)}</span>
                      )}
                    </div>
                    {found.availableQuantity === 0 && (
                      <p className="mt-0.5 text-xs text-red-500">Rupture de stock</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={resumeScanning}
                    className="flex flex-1 items-center justify-center gap-1.5 border border-neutral-200 px-4 py-2.5 text-sm font-medium text-[#2F3A2E] transition-colors hover:bg-neutral-50"
                  >
                    <X size={14} />
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={adding || found.availableQuantity === 0}
                    className="flex flex-1 items-center justify-center gap-1.5 bg-[#C8A46A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#B8945A] disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    <ShoppingBag size={14} />
                    {adding ? "Ajout…" : "Ajouter au panier"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Link href="/boutique" className="mt-8 text-sm font-medium text-[#2F3A2E] underline underline-offset-4">
        Retour à la boutique
      </Link>
    </div>
  );
}
