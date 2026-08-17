"use client";

import { useEffect, useRef, useState } from "react";
import { X, CameraOff, Loader2, ScanLine } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { getProductByBarcode } from "@/actions/boutique/products";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("dashboardBoutique.productScanDialog");
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const [error, setError] = useState(null);
  const [looking, setLooking] = useState(false);
  const [usbCode, setUsbCode] = useState("");

  async function handleUsbScan(event) {
    event.preventDefault();
    const code = usbCode.trim();
    if (!code || looking) return;

    setLooking(true);
    setError(null);
    const lookup = await getProductByBarcode(code);
    setLooking(false);
    if (!lookup.success) {
      setError(lookup.message);
      return;
    }
    setUsbCode("");
    if (lookup.found) onFound(lookup.productId);
    else onNotFound(code);
  }

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
        setError(t("cameraError"));
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[calc(100vh-24px)] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{t("title")}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleUsbScan} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <ScanLine size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a46a]" />
            <input
              value={usbCode}
              onChange={(event) => setUsbCode(event.target.value)}
              placeholder="Lecteur USB : QR ou code-barres"
              autoComplete="off"
              autoFocus
              className="h-11 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm outline-none focus:border-[#2f3a2e]"
            />
          </div>
          <button type="submit" disabled={looking} className="h-11 rounded-lg bg-[#2f3a2e] px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">
            Lire
          </button>
        </form>

        {error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 px-4 py-10 text-center">
            <CameraOff size={22} className="text-gray-300" />
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-[4/3] w-full object-cover sm:aspect-square" muted playsInline />
            {looking && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 size={22} className="animate-spin text-white" />
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          {t("hint")}
          USB ou caméra · code connu → fiche produit · code inconnu → nouveau produit pré-rempli.
        </p>
      </div>
    </div>
  );
}
