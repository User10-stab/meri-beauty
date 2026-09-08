"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { CameraOff, X } from "lucide-react";

/**
 * The one camera scanner for the counter. A QR ticket, a boutique pickup
 * code, a service code, and a product barcode are all decoded through this
 * same component — the counter used to run two scanner libraries (qr-scanner
 * here, @zxing/browser at the till), and only the zxing one can also read a
 * 1D product barcode, so this is the one that stayed.
 */
export function CounterScanner({ onDecoded, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    busyRef.current = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current,
        (result, _error, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result || busyRef.current) return;
          busyRef.current = true;
          controls.stop();
          onDecoded(result.getText());
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[CounterScanner] camera init failed:", err);
        setError("Caméra indisponible. Saisissez le code à la main.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onDecoded]);

  return (
    <div className="relative mt-7 mx-auto w-80 h-70 overflow-hidden rounded-[10px] border border-stroke bg-black dark:border-dark-3">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer la caméra"
        className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
      {error ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-white/80">
          <CameraOff className="h-6 w-6" strokeWidth={1.5} />
          {error}
        </div>
      ) : (
        <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
      )}
    </div>
  );
}
