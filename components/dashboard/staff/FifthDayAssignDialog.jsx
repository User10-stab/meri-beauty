"use client";

import { useEffect, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { toast } from "sonner";
import { assignFifthDay, getFifthDayOptions } from "@/actions/staff/fifth-day";

const DAY_LABELS = {
  MONDAY: "lundi",
  TUESDAY: "mardi",
  WEDNESDAY: "mercredi",
  THURSDAY: "jeudi",
  FRIDAY: "vendredi",
  SATURDAY: "samedi",
  SUNDAY: "dimanche",
};

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** « samedi 29 novembre » */
export function fifthDayLabel(dateKey, day) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${DAY_LABELS[day] ?? ""} ${d} ${MONTHS[m - 1]}`.trim();
}

/**
 * Who works one month's 5th day (its 5th Saturday, say) — one, several, or
 * nobody — for that date only. Ticked to start with: the staff members who
 * work it already (« 5e » in their hours, or given that day).
 *
 * @param {object} props
 * @param {string} props.dateKey - "YYYY-MM-DD"
 * @param {() => void} props.onClose
 * @param {() => void} [props.onAssigned]
 */
export function FifthDayAssignDialog({ dateKey, onClose, onAssigned }) {
  const [options, setOptions] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFifthDayOptions(dateKey).then((res) => {
      if (!res.success) {
        toast.error(res.message);
        onClose();
        return;
      }
      setOptions(res.data);
      setChosen(new Set(res.data.assignedStaffIds ?? []));
    });
  }, [dateKey, onClose]);

  async function save() {
    setSaving(true);
    const res = await assignFifthDay({ dateKey, staffIds: [...chosen] });
    setSaving(false);
    if (!res.success) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    onAssigned?.();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fifth-day-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2f3a2e]/10">
              <CalendarDays size={18} className="text-[#2f3a2e]" />
            </div>
            <div>
              <h2 id="fifth-day-title" className="text-base font-semibold text-gray-900">
                Qui travaille ce jour-là ?
              </h2>
              {options && (
                <p className="text-xs text-gray-500">
                  {fifthDayLabel(dateKey, options.day)} — 5e {DAY_LABELS[options.day]} du mois
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {!options ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">Chargement…</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-3 text-xs text-gray-500">
              Pour cette date seulement : cochez qui travaille ce jour-là — ou personne. Les horaires de chacune (et
              leur case « 5e ») ne changent pas pour les autres mois.
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Membres du personnel</legend>
              {options.candidates.map((c) => (
                <label
                  key={c.staffId}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                    chosen.has(c.staffId) ? "border-[#2f3a2e] bg-[#2f3a2e]/5" : "border-gray-200"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chosen.has(c.staffId)}
                      onChange={() =>
                        setChosen((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.staffId)) next.delete(c.staffId);
                          else next.add(c.staffId);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e]"
                    />
                    <span className="font-medium text-gray-800">{c.name}</span>
                    {c.byRule && <span className="text-xs text-gray-400">(« 5e » coché)</span>}
                  </span>
                  <span className="text-xs text-gray-400">
                    {c.startTime} – {c.endTime}
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="mt-2 text-xs text-gray-400">
              {chosen.size === 0 ? "Personne de coché : aucune réservation possible ce jour-là." : `${chosen.size} personne${chosen.size > 1 ? "s" : ""} ce jour-là.`}
            </p>

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d4e3b] disabled:opacity-50"
              >
                Valider
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
