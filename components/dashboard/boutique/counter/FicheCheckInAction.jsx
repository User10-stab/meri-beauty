"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { confirmActivityCheckIn } from "@/actions/activities/check-in";

/** The "Pointer l'arrivée" half of the fiche. Absent entirely once nothing is left to check in. */
export function FicheCheckInAction({ ticket, onChanged }) {
  const [admitting, setAdmitting] = useState(false);
  const isAppointment = ticket.kind === "appointment";

  if (!ticket.admissible) {
    return (
      <div className="flex items-start gap-2 rounded-[10px] bg-red-light-6 px-4 py-3 text-sm font-semibold text-red-dark dark:bg-red/10 dark:text-red">
        <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
        {ticket.blockedReason}
      </div>
    );
  }

  async function handleAdmit() {
    setAdmitting(true);
    const result = await confirmActivityCheckIn({ code: ticket.code });
    setAdmitting(false);

    if (!result.success) {
      toast.error(result.message);
      onChanged(null); // stale card — force a re-lookup by clearing it
      return;
    }
    const seatsAdmitted = result.seatsAdmitted ?? ticket.remainingSeats;
    toast.success(
      isAppointment
        ? `Arrivée confirmée — ${result.data.holderName}`
        : `${seatsAdmitted} place${seatsAdmitted > 1 ? "s" : ""} pointée${seatsAdmitted > 1 ? "s" : ""} — ${result.data.holderName}`
    );
    onChanged(result.data);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-stroke px-4 py-3 dark:border-dark-3">
      <div className="flex items-center gap-2 text-sm text-dark dark:text-white">
        {isAppointment ? (
          <span>Arrivée à confirmer</span>
        ) : (
          <>
        <span>Places réservées</span>
        <strong className="font-semibold">
          {ticket.seatsCount}
        </strong>
        {ticket.checkedInSeats > 0 && (
          <span className="text-body-color dark:text-dark-6">({ticket.remainingSeats} restantes)</span>
        )}
          </>
        )}
      </div>
      <button
        type="button"
        disabled={admitting}
        onClick={handleAdmit}
        className="ml-auto inline-flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
        {admitting
          ? "Pointage…"
          : !isAppointment && ticket.remainingSeats > 1
            ? `Pointer ${ticket.remainingSeats} places`
            : "Pointer l'arrivée"}
      </button>
    </div>
  );
}
