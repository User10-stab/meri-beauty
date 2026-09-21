"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { cancelCounterQrCheckout, createCounterQrCheckout, getCounterQrStatus } from "@/actions/counter/qr-checkout";

/**
 * « Carte QR » for « Pointage & encaissement » — the same dialog the retail
 * till has always shown, made reusable (2026-09-21).
 *
 * The till renders its own copy against a POS order; this one works for a
 * booking balance, a pickup order or a séance, and reports back rather than
 * settling anything itself. The caller runs its normal settle action with
 * `method: "CARD_QR"` and the session id, and the SERVER asks Stripe whether
 * that session was really paid (lib/counter/qr-checkout.js) — the operator's
 * word is never what records the money.
 */

/**
 * Drives one QR payment.
 *
 * @param {{ surface: string, targetId: string, amount: number,
 *           onPaid: (sessionId: string) => void, onClose: () => void }} props
 */
export function CounterQrDialog({ surface, targetId, amount, onPaid, onClose }) {
  const [checkout, setCheckout] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [settling, setSettling] = useState(false);

  // One session per opening. Created here rather than by the caller so the
  // dialog owns its whole lifecycle, including expiring it on cancel.
  useEffect(() => {
    let active = true;
    createCounterQrCheckout({ surface, targetId, amount }).then((result) => {
      if (!active) return;
      if (!result.success) {
        toast.error(result.message);
        onClose();
        return;
      }
      setCheckout(result.data);
    });
    return () => {
      active = false;
    };
    // Deliberately once: re-creating a session under a paying client would
    // strand the one they are already looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!checkout?.url) {
      setQrDataUrl("");
      return undefined;
    }
    let active = true;
    QRCode.toDataURL(checkout.url, { width: 320, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => active && setQrDataUrl(url))
      .catch(() => active && toast.error("Impossible de générer le QR de paiement."));
    return () => {
      active = false;
    };
  }, [checkout?.url]);

  // Same cadence as the till's own QR poll.
  useEffect(() => {
    if (!checkout?.sessionId) return undefined;
    let active = true;

    const poll = async () => {
      const result = await getCounterQrStatus(checkout.sessionId);
      if (!active || !result.success) return;
      if (result.data.paid) {
        active = false;
        setSettling(true);
        onPaid(checkout.sessionId);
        return;
      }
      if (result.data.expired) {
        active = false;
        toast.error("Ce QR a expiré. Générez-en un nouveau.");
        onClose();
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [checkout?.sessionId, onPaid, onClose]);

  const handleCancel = useCallback(async () => {
    if (!checkout?.sessionId) {
      onClose();
      return;
    }
    setCancelling(true);
    const result = await cancelCounterQrCheckout(checkout.sessionId);
    setCancelling(false);
    // Already paid: refusing to close is the point — that money has to be
    // recorded, not abandoned.
    if (!result.success) {
      toast.error(result.message);
      return;
    }
    onClose();
  }, [checkout?.sessionId, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="counter-qr-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4"
    >
      <div className="max-h-[calc(100vh-24px)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 text-center shadow-xl dark:bg-gray-dark sm:p-6">
        <h2 id="counter-qr-title" className="text-xl font-bold text-gray-900 dark:text-white">
          Paiement par carte
        </h2>
        <p className="mt-1 text-sm text-gray-500">Scannez ce QR avec le téléphone du client.</p>
        <p className="mt-4 text-3xl font-bold text-[#2f3a2e]">{Number(amount).toFixed(2)} €</p>

        <div className="relative mx-auto mt-5 flex aspect-square w-full max-w-80 items-center justify-center rounded-xl border border-gray-200 bg-white p-3">
          {qrDataUrl ? (
            <Image src={qrDataUrl} alt="QR code Stripe Checkout" fill sizes="320px" unoptimized className="object-contain p-3" />
          ) : (
            <Loader2 size={28} className="animate-spin text-[#2f3a2e]" />
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
          <Loader2 size={15} className="animate-spin" />
          {settling ? "Paiement reçu — clôture en cours…" : "En attente de confirmation Stripe…"}
        </div>

        {checkout?.url && (
          <a
            href={checkout.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm font-medium text-[#2f3a2e] underline"
          >
            Ouvrir le paiement dans un nouvel onglet
          </a>
        )}

        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling || settling}
          className="mt-5 w-full rounded-lg border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {cancelling ? "Annulation…" : "Annuler ce paiement"}
        </button>
      </div>
    </div>
  );
}
