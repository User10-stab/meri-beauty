"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X, Printer } from "lucide-react";
import QRCode from "qrcode";

/**
 * Printable label for a variant's barcode — mainly for internally-generated
 * codes (no supplier EAN/UPC to fall back on) that need a physical sticker
 * before /dashboard/boutique/scan can ever find them on the shelf.
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
        /* Sized for small products (e.g. loose stones) where a standard
           shipping-label-sized sticker would dwarf the item itself — matches
           common small thermal label rolls (35x45mm). */
        @media print {
          @page { size: 35mm 45mm; margin: 0; }
          /* visibility:hidden (below) keeps every hidden element in the
             page's layout flow — against a page this small, the rest of
             the dashboard behind this dialog is "tall" enough to spill
             into a dozen extra, blank pages. Collapsing html/body's own
             box is what actually stops that overflow from paginating. */
          html, body { height: 35mm; overflow: hidden; }
          body * { visibility: hidden; }
          #barcode-label, #barcode-label * { visibility: visible; }
          #barcode-label {
            position: fixed; top: 0; left: 0;
            width: 35mm; height: 45mm;
            border: none; padding: 1.5mm;
          }
        }
      `}</style>

      <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl print:shadow-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h2 className="text-base font-semibold text-gray-900">Étiquette produit</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div
          id="barcode-label"
          style={{ width: "35mm", height: "45mm" }}
          className="mx-auto flex flex-col items-center justify-center gap-[1mm] overflow-hidden border border-dashed border-gray-300 text-center"
        >
          <p className="w-full truncate px-[1mm] text-[2.6mm] font-medium leading-tight text-gray-700">{productName}</p>
          <p className="w-full truncate px-[1mm] text-[2.2mm] leading-tight text-gray-500">{variant.name}</p>
          {qr && (
            <Image
              src={qr}
              alt="QR code produit"
              width={200}
              height={200}
              unoptimized
              className="my-[0.5mm] h-[24mm] w-[24mm]"
            />
          )}
          <p className="font-mono text-[2.2mm] leading-tight tracking-wide text-gray-800">{variant.barcode}</p>
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
