"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { CameraOff, Loader2, ScanLine, X } from "lucide-react";

/**
 * Decodes a physical factory barcode/QR into its text payload.
 *
 * This intentionally does not look the code up in the catalogue. Product edit
 * already validates uniqueness on save; this dialog's job is only to translate
 * the visible barcode into text and hand that text back to the current field.
 *
 * @param {{ open: boolean, onClose: () => void, onDecoded: (text: string) => void, title?: string }} props
 */
export function BarcodeTextScannerDialog({
  open,
  onClose,
  onDecoded,
  title = "Lire un code-barres",
}) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const busyRef = useRef(false);
  const [error, setError] = useState(null);
  const [decoding, setDecoding] = useState(false);
  const [manualCode, setManualCode] = useState("");

  const commitDecoded = useCallback((rawCode) => {
    const code = rawCode?.trim();
    if (!code || busyRef.current) return;

    busyRef.current = true;
    setDecoding(true);
    controlsRef.current?.stop();
    onDecoded(code);
    setManualCode("");
    setDecoding(false);
    onClose();
  }, [onClose, onDecoded]);

  function handleManualSubmit(event) {
    event.preventDefault();
    commitDecoded(manualCode);
  }

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setError(null);
    setDecoding(false);
    busyRef.current = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" } },
        videoRef.current,
        (result, _error, controls) => {
          controlsRef.current = controls;
          if (cancelled || !result) return;
          commitDecoded(result.getText());
        }
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[BarcodeTextScannerDialog] camera init failed:", err);
        setError("Impossible d'accéder à la caméra. Vérifiez l'autorisation du navigateur ou utilisez le lecteur USB.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, commitDecoded]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-dark">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleManualSubmit} className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <ScanLine size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a46a]" />
            <input
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="Lecteur USB : scannez ici"
              autoComplete="off"
              autoFocus
              className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-3 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={decoding}
            className="rounded-lg bg-[#2f3a2e] px-3 text-xs font-semibold text-white disabled:opacity-50"
          >
            Lire
          </button>
        </form>

        {error ? (
          <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-50 px-4 py-10 text-center dark:bg-dark-2">
            <CameraOff size={22} className="text-gray-300" />
            <p className="text-sm text-gray-500 dark:text-dark-6">{error}</p>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
            {decoding && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 size={22} className="animate-spin text-white" />
              </div>
            )}
          </div>
        )}

        <p className="mt-4 text-center text-xs text-gray-400">
          Caméra ou lecteur USB · le texte décodé remplit le champ code-barres.
        </p>
      </div>
    </div>
  );
}
