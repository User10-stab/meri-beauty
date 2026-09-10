"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Clock3, AlertCircle, X } from "lucide-react";

export default function ReservationStatusModal({ open, onClose, onRetry, result }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !result) return null;

  const isError = result.success === false || result.paymentStatus === "FAILED" || result.paymentStatus === "FAILED_DEPOSIT";
  const isPendingManual = result.success && result.appointmentStatus === "PENDING" && result.isManualMode;
  const isAccepted = result.success && result.appointmentStatus === "ACCEPTED";
  const isConfirmed = result.success && result.appointmentStatus === "CONFIRMED";
  const isPendingPayment = result.success && result.appointmentStatus === "PENDING" && result.paymentStatus === "PENDING" && !result.isManualMode;
  const isMulti = Boolean(result.isMulti);

  let icon = <Clock3 size={28} className="text-amber-700" />;
  let iconBg = "bg-amber-100";
  let title = "Demande envoyée";
  let message = "";

  if (isError) {
    icon = <AlertCircle size={28} className="text-red-600" />;
    iconBg = "bg-red-100";
    if (result.paymentStatus === "FAILED") {
      title = "Paiement échoué";
      message = "Votre paiement n'a pas abouti. Vous pouvez réessayer — votre créneau reste conservé quelques minutes.";
    } else {
      title = "Oups, une erreur est survenue";
      message = result.message || "Nous n'avons pas pu finaliser votre réservation. Veuillez réessayer. Si le problème persiste, contactez-nous.";
    }
  } else if (isAccepted) {
    icon = <CheckCircle2 size={28} className="text-emerald-600" />;
    iconBg = "bg-emerald-100";
    title = "Demande acceptée";
    // Inspiré de reservationAcceptedWithPaymentLinkEmail
    if (result.paymentType === "DEPOSIT") {
      message =
        "Bonne nouvelle, notre équipe a accepté votre demande. Un acompte est requis pour la confirmer : vous allez recevoir un e-mail avec un lien de paiement sécurisé. Le solde sera à régler au salon.";
    } else if (result.paymentType === "ONLINE") {
      message =
        "Bonne nouvelle, notre équipe a accepté votre demande. Vous allez recevoir un e-mail avec un lien de paiement sécurisé pour la confirmer.";
    } else {
      message =
        "Bonne nouvelle, notre équipe a accepté votre demande. Vous recevrez un e-mail de confirmation très bientôt.";
    }
  } else if (isPendingManual) {
    // Inspiré de reservationReceivedEmail (PENDING)
    icon = <Clock3 size={28} className="text-amber-700" />;
    iconBg = "bg-amber-100";
    title = isMulti ? "Demandes envoyées" : "Demande envoyée";
    message =
      "Nous avons bien reçu votre demande de réservation. Notre équipe va l'examiner et vous recevrez un e-mail de confirmation très bientôt.";
  } else if (isPendingPayment) {
    icon = <Clock3 size={28} className="text-[#b89664]" />;
    iconBg = "bg-[#fdf8f0]";
    if (result.paymentType === "DEPOSIT") {
      title = "Acompte requis";
      message =
        "Votre créneau est réservé provisoirement. Un acompte est requis pour le confirmer — vous allez être redirigé vers le paiement sécurisé.";
    } else {
      title = "Paiement requis";
      message =
        "Votre créneau est réservé provisoirement. Un paiement est requis pour confirmer votre réservation.";
    }
  } else if (isConfirmed) {
    const isPaid = result.paymentStatus === "PAID" || result.paymentType === "ONLINE" || result.paymentType === "DEPOSIT";
    const cashOnly = result.allowedPaymentMethods === "CASH_ONLY";
    const noOnline = result.paymentType === "ON_SITE" || !result.paymentType;

    if (isPaid && result.paymentStatus === "PAID") {
      // Inspiré de paymentConfirmationEmail / reservationConfirmedEmail avec paiement
      icon = <CheckCircle2 size={28} className="text-emerald-600" />;
      iconBg = "bg-emerald-100";
      title = "Paiement confirmé";
      message = "Votre paiement a bien été reçu et votre rendez-vous est confirmé. Nous avons hâte de vous accueillir !";
    } else if (cashOnly || noOnline) {
      // Inspiré de reservationConfirmedEmail sans paiement (CASH_ONLY)
      icon = <CheckCircle2 size={28} className="text-emerald-600" />;
      iconBg = "bg-emerald-100";
      title = isMulti ? "Réservations confirmées" : "Réservation confirmée";
      message =
        "Votre réservation est confirmée. Vous réglerez directement au salon le jour de votre rendez-vous. Un e-mail de confirmation vous a été envoyé.";
    } else if (result.paymentType === "DEPOSIT") {
      icon = <CheckCircle2 size={28} className="text-emerald-600" />;
      iconBg = "bg-emerald-100";
      title = "Acompte confirmé";
      message = "Votre acompte a été payé et votre rendez-vous est confirmé. Le solde sera à régler au salon.";
    } else if (result.paymentType === "ONLINE") {
      icon = <CheckCircle2 size={28} className="text-emerald-600" />;
      iconBg = "bg-emerald-100";
      title = "Paiement confirmé";
      message = "Votre paiement a été effectué avec succès et votre réservation est confirmée.";
    } else {
      icon = <CheckCircle2 size={28} className="text-emerald-600" />;
      iconBg = "bg-emerald-100";
      title = isMulti ? "Réservations confirmées" : "Réservation confirmée";
      message = "Votre réservation a été créée avec succès. Un e-mail de confirmation vous a été envoyé.";
    }
  } else {
    title = "Réservation enregistrée";
    message = "Votre demande a bien été prise en compte. Vous recevrez un e-mail de suivi très bientôt.";
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm p-0 sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="flex w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-6">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>{icon}</span>
                <div>
                  <h2 className="font-display text-[17px] font-semibold leading-tight text-[#2F3A2E]">{title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#6f6a64]">{message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#ede5d8] bg-[#fdf8f0] text-[#2F3A2E] hover:bg-[#f5ece0]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-3 px-6 pb-6 pt-6">
              {isError && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex-1 rounded-full bg-[#2F3A2E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#212a20]"
                >
                  Réessayer le paiement
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className={`rounded-full px-5 py-3 text-sm font-semibold ${
                  isError && onRetry
                    ? "flex-1 border border-[#ede5d8] bg-white text-[#2F3A2E] hover:bg-[#fdf8f0]"
                    : "flex-1 bg-[#b89664] text-white hover:bg-[#a38353]"
                }`}
              >
                Continuer
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
