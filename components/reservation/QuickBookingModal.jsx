"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, CalendarCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { getQuickBookingPrefill } from "@/actions/reservation/get-quick-booking-prefill";
import ReservationForm from "@/components/reservation/ReservationForm";

/**
 * Popup de réservation rapide depuis la page d'un membre du staff.
 *
 * Catégorie + staff + service sont déjà sélectionnés (via getQuickBookingPrefill
 * qui réutilise les règles de visibilité du parcours normal). Le formulaire
 * réutilisé démarre directement aux « Créneaux disponibles » et enchaîne
 * uniquement les étapes restantes (infos client, récapitulatif, paiement)
 * avec exactement la même logique métier que la réservation normale.
 */
export default function QuickBookingModal({
  open,
  onClose,
  staffId,
  serviceId,
  serviceName,
  staffName,
  customerSession = null,
}) {
  const router = useRouter();
  const origin = staffId ? `/staff/${staffId}` : "/reservation";
  const [preset, setPreset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadPrefill = useCallback(async () => {
    if (!open || !staffId || !serviceId) return;
    setLoading(true);
    setError(null);
    setPreset(null);
    const result = await getQuickBookingPrefill({ staffId, serviceId });
    if (result.success) {
      setPreset(result.data);
    } else {
      setError(result.message || "Impossible de préparer la réservation.");
    }
    setLoading(false);
  }, [open, staffId, serviceId]);

  useEffect(() => {
    loadPrefill();
  }, [loadPrefill]);

  // Verrouiller le scroll + fermer sur Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Réserver ${serviceName ?? ""}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-[#fdf8f0] shadow-2xl sm:rounded-3xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-[#ede5d8]/70 bg-white px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
                  <CalendarCheck size={18} />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b89664]">
                    Réservation rapide
                  </p>
                  <h2 className="font-display text-lg font-semibold leading-tight text-[#2F3A2E]">
                    {serviceName ?? "Votre rendez-vous"}
                    {staffName ? (
                      <span className="block text-sm font-normal text-[#6f6a64]">
                        avec {staffName}
                      </span>
                    ) : null}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[#ede5d8] bg-[#fdf8f0] text-[#2F3A2E] transition-colors hover:bg-[#f5ece0]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-7">
              {loading && (
                <div className="flex min-h-[280px] flex-col items-center justify-center gap-4">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#ede5d8] border-t-[#2F3A2E]" />
                  <p className="text-sm text-[#6f6a64]">
                    Préparation de votre réservation…
                  </p>
                </div>
              )}

              {!loading && error && (
                <div className="mx-auto flex min-h-[200px] max-w-md flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm font-medium text-[#2F3A2E]">{error}</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={loadPrefill}
                      className="rounded-full bg-[#2F3A2E] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#212a20]"
                    >
                      Réessayer
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-full border border-[#ede5d8] bg-white px-5 py-2.5 text-sm font-medium text-[#2F3A2E] transition-colors hover:bg-[#f5ece0]"
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              )}

              {!loading && !error && preset && (
                <ReservationForm
                  key={preset.staffService.id}
                  customerSession={customerSession}
                  initialPreset={preset}
                  quickMode
                  origin={origin}
                  onCompleted={() => {
                    onClose();
                    // Ensure user lands back on the staff profile that started the flow
                    router.push(origin);
                  }}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
