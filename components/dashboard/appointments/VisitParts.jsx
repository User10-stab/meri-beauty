"use client";

import { Check, Link2 } from "lucide-react";

/**
 * The pieces the calendar drawer and the appointments list share to show a
 * visit — several prestations booked together for one client — and to ask,
 * at « Terminer », whether the whole visit is being closed or only this
 * prestation. The data comes from presentVisit (lib/appointments/visit.js).
 */

const STATUS_LABELS = {
  PENDING: "En attente",
  ACCEPTED: "Acceptée",
  CONFIRMED: "Confirmée",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  REJECTED: "Refusée",
  NO_SHOW: "Absente",
};

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Brussels" });
}

export function formatVisitPrice(amount) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

/**
 * What « Terminer toute la visite » would close from this prestation: the
 * prestations that are confirmed and already started, and what the counter
 * still has to collect for them. `available` is false when the visit has
 * nothing else to close — the plain single « Terminer » is then the only
 * thing to offer.
 */
export function visitCompletion(visit, currentId) {
  const completable = (visit?.prestations ?? []).filter((p) => p.completable);
  const includesCurrent = completable.some((p) => p.id === currentId);
  return {
    available: includesCurrent && completable.length > 1,
    prestations: completable,
    amountDue: completable.reduce((sum, p) => sum + p.amountDue, 0),
    // One operation per staff member — see completeVisit.
    staffCount: new Set(completable.map((p) => p.staffId)).size,
  };
}

/** Small « Visite » marker for a calendar card or a table row. */
export function VisitBadge({ visit, className = "" }) {
  if (!visit) return null;
  const count = visit.prestations.length;
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-white/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#2F3A2E] shadow-sm ${className}`}
      title={`Visite de ${count} prestation${count > 1 ? "s" : ""} : ${visit.prestations.map((p) => p.serviceName).join(" + ")}`}
    >
      <Link2 size={9} strokeWidth={3} />
      Visite
    </span>
  );
}

/** Every prestation of the visit, the one being looked at highlighted. */
export function VisitPrestationsList({ visit, currentId }) {
  if (!visit) return null;
  const sameDay = new Set(visit.prestations.map((p) => formatDay(p.startTime))).size === 1;
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700/50" data-testid="visit-prestations">
      {visit.prestations.map((p) => {
        const isCurrent = p.id === currentId;
        const settled = p.status === "COMPLETED" || (p.status === "CONFIRMED" && p.amountDue === 0);
        return (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className={`truncate text-sm ${isCurrent ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-gray-200"}`}>
                {p.serviceName}
                {isCurrent && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#b89664]">celle-ci</span>}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {!sameDay && `${formatDay(p.startTime)} · `}
                <span className="tabular-nums">{formatTime(p.startTime)} – {formatTime(p.endTime)}</span> · {p.staffName}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              {/* An independent's prestation is her own sale: the salon sees
                  that it is on the client's schedule, never what it brings in. */}
              <p className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-200">
                {p.independent ? <span className="text-xs font-medium text-gray-500">Indépendante — sa propre vente</span> : formatVisitPrice(p.price)}
              </p>
              <p className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium ${settled ? "text-emerald-700" : "text-gray-500"}`}>
                {p.status === "COMPLETED" && <Check size={10} strokeWidth={3} />}
                {p.coveredByVisit ? "Encaissée avec la visite" : STATUS_LABELS[p.status] ?? p.status}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * « Toute la visite » or « Cette prestation seulement », asked at « Terminer ».
 *
 * @param {{ completion: ReturnType<typeof visitCompletion>, singleAmountDue: number,
 *   value: "VISIT" | "SINGLE", onChange: (value: "VISIT" | "SINGLE") => void }} props
 */
export function VisitScopeChoice({ completion, singleAmountDue, value, onChange }) {
  const options = [
    {
      key: "VISIT",
      title: "Toute la visite",
      detail: `${completion.prestations.length} prestations · ${formatVisitPrice(completion.amountDue)}`,
      hint:
        completion.staffCount > 1
          ? `${completion.staffCount} opérations : une par membre du personnel.`
          : "Une seule opération, un seul ticket.",
    },
    {
      key: "SINGLE",
      title: "Cette prestation seulement",
      detail: formatVisitPrice(singleAmountDue),
      hint: "Les autres restent à terminer.",
    },
  ];
  return (
    <div role="radiogroup" aria-label="Que terminer ?" className="grid grid-cols-2 gap-2">
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.key)}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              selected ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200 bg-white hover:bg-gray-50"
            }`}
          >
            <span className="block text-xs font-semibold text-gray-800">{option.title}</span>
            <span className="mt-0.5 block text-xs font-medium tabular-nums text-gray-700">{option.detail}</span>
            <span className="mt-1 block text-[11px] leading-snug text-gray-500">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
