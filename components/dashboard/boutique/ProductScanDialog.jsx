"use client";

import { useEffect, useRef, useState } from "react";
import { X, CameraOff, Loader2 } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { getProductByBarcode } from "@/actions/boutique/products";

/**
 * Staff-side barcode scan from the products list. A known barcode opens that
 * product for editing; an unknown one opens the new-product form pre-filled
 * with the scanned code instead of a dead end — this is how a product
 * without a supplier barcode gets onboarded: scan the blank/generated label
 * once, land straight on a form ready to fill in the rest.
 *
 * @param {{ open: boolean, onClose: () => void, onFound: (productId: string) => void, onNotFound: (barcode: string) => void }} props
 */
export function ProductScanDialog({ open, onClose, onFound, onNotFound }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const [error, setError] = useState(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    setLooking(false);
    busyRef.current = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        async (result, err, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result || busyRef.current) return;

          const code = result.getText().trim();
          busyRef.current = true;
          setLooking(true);
          controls.stop();

          const lookup = await getProductByBarcode(code);
          if (cancelled) return;

          if (!lookup.success) {
            setLooking(false);
            setError(lookup.message);
            return;
          }

          if (lookup.found) onFound(lookup.productId);
          else onNotFound(code);
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[ProductScanDialog] camera init failed:", err);
        setError("Impossible d'accéder à la caméra — vérifiez les autorisations de votre navigateur.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onFound, onNotFound]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Scanner un produit</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 px-4 py-10 text-center">
            <CameraOff size={22} className="text-gray-300" />
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
            {looking && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 size={22} className="animate-spin text-white" />
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          Code connu → fiche produit. Code inconnu → nouveau produit pré-rempli.
        </p>
      </div>
    </div>
  );
}
