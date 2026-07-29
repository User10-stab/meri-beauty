"use client";

import { useEffect, useState } from "react";
import { X, Printer } from "lucide-react";
import QRCode from "qrcode";

/**
 * Printable label for a variant's barcode — mainly for internally-generated
 * codes (no supplier EAN/UPC to fall back on) that need a physical sticker
 * before /boutique/scan can ever find them on the shelf.
 *
 * @param {{ variant: object|null, productName: string, onClose: () => void }} props
 */
export function BarcodeLabelDialog({ variant, productName, onClose }) {
  const [qr, setQr] = useState(null);

  useEffect(() => {
    if (!variant?.barcode) return;
    let cancelled = false;
    QRCode.toDataURL(variant.barcode, { margin: 1, width: 200, color: { dark: "#000000", light: "#FFFFFF" } }).then(
      (url) => !cancelled && setQr(url)
    );
    return () => {
      cancelled = true;
    };
  }, [variant?.barcode]);

  if (!variant) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 print:bg-white print:backdrop-blur-none"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #barcode-label, #barcode-label * { visibility: visible; }
          #barcode-label { position: fixed; top: 2rem; left: 50%; transform: translateX(-50%); }
        }
      `}</style>

      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl print:shadow-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h2 className="text-base font-semibold text-gray-900">Étiquette produit</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div id="barcode-label" className="flex flex-col items-center gap-2 border border-dashed border-gray-300 p-5 text-center">
          <p className="text-xs font-medium text-gray-700">{productName}</p>
          <p className="text-[11px] text-gray-500">{variant.name}</p>
          {qr && <img src={qr} alt="QR code produit" width={140} height={140} className="my-1 h-[140px] w-[140px]" />}
          <p className="font-mono text-xs tracking-wide text-gray-800">{variant.barcode}</p>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3d4e3b] print:hidden"
        >
          <Printer size={14} />
          Imprimer l'étiquette
        </button>
      </div>
    </div>
  );
}
