"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Users } from "lucide-react";
import { changeWorkshopReservationSeatsFree } from "@/actions/workshops/manage-reservation";
import { changeFormationReservationSeatsFree } from "@/actions/formations/manage-reservation";

const CHANGE_SEATS_BY_KIND = {
  workshop: changeWorkshopReservationSeatsFree,
  formation: changeFormationReservationSeatsFree,
};

/**
 * Free counter seat-count change — absent for an appointment (no seat
 * concept there) and collapsed by default, since it is used far less often
 * than checking someone in or settling a balance. Distinct from the
 * customer's self-serve 10%-fee Stripe flow: this never touches Stripe and
 * costs nothing, see lib/reservations/change-reservation-seats.js.
 */
export function FicheSeatsAction({ ticket, onChanged }) {
  const [open, setOpen] = useState(false);
  const [newSeatsCount, setNewSeatsCount] = useState(String(ticket.seatsCount));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const parsedSeats = Number(newSeatsCount);
  const changed = Number.isInteger(parsedSeats) && parsedSeats !== ticket.seatsCount;
  const belowCheckedIn = Number.isInteger(parsedSeats) && parsedSeats < ticket.checkedInSeats;

  async function handleSave() {
    if (!Number.isInteger(parsedSeats) || parsedSeats < 1) {
      toast.error("Le nombre de places doit être un entier positif.");
      return;
    }
    if (!changed) {
      toast.error("Cette réservation a déjà ce nombre de places.");
      return;
    }
    if (belowCheckedIn) {
      toast.error(`${ticket.checkedInSeats} place${ticket.checkedInSeats > 1 ? "s" : ""} déjà pointée${ticket.checkedInSeats > 1 ? "s" : ""} — impossible de descendre en dessous.`);
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("Indiquez la raison du changement de nombre de places.");
      return;
    }
    setSaving(true);
    const changeSeats = CHANGE_SEATS_BY_KIND[ticket.kind];
    const result = await changeSeats(ticket.reservationId, { newSeatsCount: parsedSeats, reason: reason.trim() });
    setSaving(false);

    if (!result.success) {
      toast.error(result.message);
      return;
    }
    toast.success(`Nombre de places modifié — ${ticket.holderName}`);
    setOpen(false);
    setReason("");
    onChanged();
  }

  return (
    <div className="rounded-[10px] border border-stroke dark:border-dark-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-dark dark:text-white"
      >
        <Users size={16} className="text-[#2f3a2e]" />
        Modifier le nombre de places
        {open ? <ChevronUp size={16} className="ml-auto" /> : <ChevronDown size={16} className="ml-auto" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-stroke px-4 py-3 dark:border-dark-3">
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Sans frais — distinct du lien de paiement à 10% envoyé au client. Le nouveau prix est calculé sur le tarif catalogue actuel, jamais sur l&apos;ancien prix divisé par les places.
          </p>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
            <label className="flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-xs font-bold">Places</span>
              <input
                type="number"
                min={Math.max(1, ticket.checkedInSeats)}
                step="1"
                value={newSeatsCount}
                onChange={(event) => setNewSeatsCount(event.target.value)}
                aria-label="Nouveau nombre de places"
                className="w-full rounded-[7px] border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              />
            </label>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Raison obligatoire : place ajoutée sur place, correction…"
              className="rounded-[7px] border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#2f3a2e] dark:border-dark-3 dark:bg-dark-2 dark:text-white"
            />
          </div>
          <button
            type="button"
            disabled={saving || !changed || belowCheckedIn || reason.trim().length < 3}
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-[7px] bg-dark px-4 py-2 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-dark"
          >
            {saving ? "Traitement…" : "Confirmer le changement"}
          </button>
        </div>
      )}
    </div>
  );
}
