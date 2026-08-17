"use client";

import { useEffect, useRef, useState } from "react";
import { X, CameraOff, ScanLine } from "lucide-react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { useTranslations } from "next-intl";

/**
 * Camera-driven alternative to typing a pickup code by hand. Decodes the QR
 * shown on the customer's confirmation page/email and hands the raw text
 * back to the caller — it does not look up or complete the order itself,
 * that stays in OrdersPageClient so both entry paths share one code path.
 *
 * @param {{ open: boolean, onClose: () => void, onDecoded: (code: string) => void }} props
 */
export function PickupScannerDialog({ open, onClose, onDecoded }) {
  const t = useTranslations("dashboardBoutique.pickupScannerDialog");
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [usbCode, setUsbCode] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setError(null);
    const reader = new BrowserQRCodeReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result, err, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result) return;
          controls.stop();
          onDecoded(result.getText().trim().toUpperCase());
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[PickupScannerDialog] camera init failed:", err);
        setError(t("cameraError"));
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDecoded]);

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
          <h2 className="text-base font-semibold text-gray-900">{t("title")}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            const code = usbCode.trim();
            if (!code) return;
            setUsbCode("");
            onDecoded(code.toUpperCase());
          }}
          className="mb-4 flex gap-2"
        >
          <div className="relative flex-1">
            <ScanLine size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a46a]" />
            <input
              value={usbCode}
              onChange={(event) => setUsbCode(event.target.value)}
              placeholder="Lecteur USB : scannez le QR"
              autoComplete="off"
              autoFocus
              className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm outline-none focus:border-[#2f3a2e]"
            />
          </div>
          <button type="submit" className="rounded-lg bg-[#2f3a2e] px-3 text-xs font-semibold text-white">Lire</button>
        </form>

        {error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 px-4 py-10 text-center">
            <CameraOff size={22} className="text-gray-300" />
            <p className="text-sm text-gray-500">{error}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          {t("hint")}
        </p>
      </div>
    </div>
  );
}
