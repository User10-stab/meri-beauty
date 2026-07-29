"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CameraOff } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { getStorefrontProductByBarcode } from "@/actions/boutique/storefront";

/**
 * In-store self-scan: point the camera at a product's barcode (EAN/UPC on
 * the packaging) to jump straight to its page. A miss (wrong item, wrapper,
 * random code) just shows a toast and keeps scanning — it doesn't stop the
 * camera, since the customer will likely just try again immediately.
 */
export function ProductScanClient() {
  const router = useRouter();
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const lastCodeRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        async (result, err, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result || busyRef.current) return;

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

          controls.stop();
          router.push(`/boutique/${lookup.data.slug}?variant=${lookup.data.variantId}`);
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
  }, [router]);

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
        <div className="w-full overflow-hidden bg-black">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        </div>
      )}

      <Link href="/boutique" className="mt-8 text-sm font-medium text-[#2F3A2E] underline underline-offset-4">
        Retour à la boutique
      </Link>
    </div>
  );
}
