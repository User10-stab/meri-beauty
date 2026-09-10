"use client";

import { FicheCheckInAction } from "@/components/dashboard/boutique/counter/FicheCheckInAction";
import { FicheSettleAction } from "@/components/dashboard/boutique/counter/FicheSettleAction";
import { FicheSeatsAction } from "@/components/dashboard/boutique/counter/FicheSeatsAction";
import { FicheBuyerAction } from "@/components/dashboard/boutique/counter/FicheBuyerAction";
import { KIND_LABEL, formatDateTime, isToday } from "@/components/dashboard/boutique/counter/counter-format";
import { CheckCircle2, TriangleAlert } from "lucide-react";

export function CounterFiche({ ticket, onChanged, canCollectCash = false }) {
  const wrongDay = !isToday(ticket.sessionStartDate);

  return (
    <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stroke px-6 py-4 dark:border-dark-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {KIND_LABEL[ticket.kind]}
          </span>
          <h2 className="text-lg font-bold text-dark dark:text-white">{ticket.activityTitle}</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-dark-6">{formatDateTime(ticket.sessionStartDate)}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            ticket.remainingSeats <= 0
              ? "bg-green-light-6 text-green-dark dark:bg-green/10 dark:text-green"
              : ticket.admissible
                ? "bg-blue-light-5 text-blue-dark dark:bg-blue/10 dark:text-blue-light"
                : "bg-red-light-6 text-red-dark dark:bg-red/10 dark:text-red"
          }`}
        >
          {ticket.remainingSeats <= 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
          {ticket.remainingSeats <= 0 ? "Déjà pointé" : ticket.admissible ? "Non pointé" : "Entrée refusée"}
        </span>
      </div>

      <dl className="grid gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-dark-6">Au nom de</dt>
          <dd className="mt-1 text-base font-bold text-dark dark:text-white">{ticket.holderName}</dd>
          <dd className="text-xs text-gray-500 dark:text-dark-6">{ticket.holderEmail}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-dark-6">
            {ticket.kind === "appointment" ? "Avec" : "Places"}
          </dt>
          <dd className="mt-1 text-base font-bold text-dark dark:text-white">
            {ticket.kind === "appointment"
              ? ticket.staffName ?? "—"
              : `${ticket.remainingSeats} restante${ticket.remainingSeats > 1 ? "s" : ""} sur ${ticket.seatsCount}`}
          </dd>
        </div>
      </dl>

      {wrongDay && (
        <div className="mx-6 mb-4 flex items-start gap-2 rounded-[10px] bg-orange-light-5 px-4 py-3 text-xs font-medium text-orange-dark dark:bg-orange-light/10 dark:text-orange-light">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
          Ceci ne concerne pas une session d&apos;aujourd&apos;hui.
        </div>
      )}

      <div className="space-y-3 px-6 pb-6">
        <FicheCheckInAction ticket={ticket} onChanged={onChanged} />
        {ticket.status === "CONFIRMED" && (
          <FicheSettleAction ticket={ticket} onChanged={() => onChanged(null)} canCollectCash={canCollectCash} />
        )}
        {ticket.status === "CONFIRMED" && ticket.kind !== "appointment" && (
          <FicheSeatsAction ticket={ticket} onChanged={() => onChanged(null)} />
        )}
        <FicheBuyerAction ticket={ticket} onChanged={() => onChanged(null)} />
      </div>
    </div>
  );
}
