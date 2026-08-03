"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X, Copy } from "lucide-react";
import { changeReservationSession, changeReservationSeats } from "@/actions/workshops/manage-reservation";
import Button from "@/components/ui/Button";

function formatSessionDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Admin-only: modifies a confirmed reservation — either its session (date)
 * or its seat count — generating a Stripe Checkout link for a 10% change
 * fee to send to the customer (no self-service — the customer contacts the
 * salon and staff process the change here).
 */
export function ChangeSessionModal({ open, onClose, reservation }) {
  const [mode, setMode] = useState("session"); // "session" | "seats"
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [newSeatsCount, setNewSeatsCount] = useState("");
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [isSubmitting, startSubmit] = useTransition();

  if (!open || !reservation) return null;

  const otherSessions = (reservation.session?.workshop?.sessions ?? []).filter(
    (s) => s.id !== reservation.sessionId && s.status === "SCHEDULED"
  );
  const capacity = reservation.session?.capacity ?? reservation.session?.workshop?.capacity ?? 8;

  const changeFeePreview = Number(reservation.totalPrice ?? 0) * 0.1;

  function handleClose() {
    setMode("session");
    setSelectedSessionId("");
    setNewSeatsCount("");
    setPaymentUrl(null);
    onClose();
  }

  function handleSubmitSession() {
    if (!selectedSessionId) {
      toast.error("Veuillez choisir une nouvelle séance.");
      return;
    }
    startSubmit(async () => {
      const result = await changeReservationSession(reservation.id, selectedSessionId);
      if (result.success) {
        toast.success(result.message);
        setPaymentUrl(result.paymentUrl);
      } else {
        toast.error(result.message);
      }
    });
  }

  function handleSubmitSeats() {
    const seats = parseInt(newSeatsCount, 10);
    if (!seats || seats < 1) {
      toast.error("Veuillez indiquer un nombre de places valide.");
      return;
    }
    startSubmit(async () => {
      const result = await changeReservationSeats(reservation.id, seats);
      if (result.success) {
        toast.success(result.message);
        setPaymentUrl(result.paymentUrl);
      } else {
        toast.error(result.message);
      }
    });
  }

  function copyLink() {
    navigator.clipboard.writeText(paymentUrl);
    toast.success("Lien copié !");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">Modifier la réservation</h2>
          <button type="button" onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          {reservation.session?.workshop?.title} — {reservation.customer?.fullName}
          <br />
          Séance actuelle : {formatSessionDate(reservation.session?.startDate)} · {reservation.seatsCount} place
          {reservation.seatsCount > 1 ? "s" : ""}
        </p>

        {!paymentUrl && (
          <div className="mb-4 flex gap-2 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setMode("session")}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                mode === "session" ? "border-[#2f3a2e] text-[#2f3a2e]" : "border-transparent text-gray-400"
              }`}
            >
              Changer de séance
            </button>
            <button
              type="button"
              onClick={() => setMode("seats")}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
                mode === "seats" ? "border-[#2f3a2e] text-[#2f3a2e]" : "border-transparent text-gray-400"
              }`}
            >
              Modifier les places
            </button>
          </div>
        )}

        {!paymentUrl ? (
          mode === "session" ? (
            <>
              <label className="mb-1 block text-sm font-medium text-gray-700">Nouvelle séance</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="mb-4 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">Sélectionner une séance...</option>
                {otherSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSessionDate(s.startDate)}
                  </option>
                ))}
              </select>

              {otherSessions.length === 0 && (
                <p className="mb-4 text-xs text-amber-600">
                  Aucune autre séance planifiée n'est disponible pour cet atelier.
                </p>
              )}

              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Frais de modification (10% du total) : <strong>€{changeFeePreview.toFixed(2)}</strong>
              </div>

              <Button
                onClick={handleSubmitSession}
                disabled={isSubmitting || !selectedSessionId}
                className="w-full bg-[#2f3a2e]"
              >
                {isSubmitting ? "Génération du lien..." : "Générer le lien de paiement"}
              </Button>
            </>
          ) : (
            <>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Nouveau nombre de places (max {capacity})
              </label>
              <input
                type="number"
                min={1}
                max={capacity}
                value={newSeatsCount}
                onChange={(e) => setNewSeatsCount(e.target.value)}
                placeholder={String(reservation.seatsCount)}
                className="mb-4 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm text-gray-700 outline-none focus:border-indigo-450 focus:ring-2 focus:ring-indigo-100"
              />

              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                Frais de modification (10% du total, quel que soit le sens du changement) :{" "}
                <strong>€{changeFeePreview.toFixed(2)}</strong>
              </div>

              <Button
                onClick={handleSubmitSeats}
                disabled={isSubmitting || !newSeatsCount}
                className="w-full bg-[#2f3a2e]"
              >
                {isSubmitting ? "Génération du lien..." : "Générer le lien de paiement"}
              </Button>
            </>
          )
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-600">
              Envoyez ce lien au client pour finaliser la modification :
            </p>
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex-1 truncate text-xs text-gray-600">{paymentUrl}</span>
              <button type="button" onClick={copyLink} className="text-gray-400 hover:text-gray-700">
                <Copy size={14} />
              </button>
            </div>
            <Button onClick={handleClose} className="w-full bg-[#2f3a2e]">
              Fermer
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
