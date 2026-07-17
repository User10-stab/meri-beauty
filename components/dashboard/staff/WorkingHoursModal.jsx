"use client";

import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { toast } from "sonner";
import { getWorkingHours, upsertWorkingHours } from "@/actions/staff/working-hours";

const DAY_LABELS = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

const DAY_ORDER = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

/**
 * @param {object} props
 * @param {object} props.staff — { id, user: { fullName } }
 * @param {() => void} props.onClose
 */
export function WorkingHoursModal({ staff, onClose }) {
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await getWorkingHours(staff.id);
      if (res.success) {
        setDays(res.data);
      } else {
        toast.error(res.message);
        onClose();
      }
      setLoading(false);
    }
    load();
  }, [staff.id, onClose]);

  function updateDay(index, field, value) {
    setDays((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };

      // When marking as closed, clear validation errors for that day
      if (field === "isClosed" && value) {
        delete next[index]._errors;
      }
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Client-side validation
    let hasErrors = false;
    const validated = days.map((d) => {
      const errors = [];
      if (!d.isClosed) {
        if (!d.startTime) errors.push("startTime");
        if (!d.endTime) errors.push("endTime");
        if (d.startTime && d.endTime && d.startTime >= d.endTime) {
          errors.push("startTime");
        }
      }
      if (errors.length > 0) hasErrors = true;
      return { ...d, _errors: errors };
    });

    setDays(validated);
    if (hasErrors) {
      toast.error("Corrigez les horaires invalides avant d'enregistrer.");
      return;
    }

    setSaving(true);
    const res = await upsertWorkingHours({
      staffId: staff.id,
      days: days.map((d) => ({
        day: d.day,
        startTime: d.isClosed ? "00:00" : d.startTime,
        endTime: d.isClosed ? "00:00" : d.endTime,
        isClosed: d.isClosed,
      })),
    });

    if (res.success) {
      toast.success(res.message);
      onClose();
    } else {
      toast.error(res.message);
    }
    setSaving(false);
  }

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="working-hours-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className=" rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2f3a2e]/10">
              <Clock size={18} className="text-[#2f3a2e]" />
            </div>
            <div>
              <h2 id="working-hours-title" className="text-base font-semibold text-gray-900">
                Définir les horaires de travail
              </h2>
              <p className="text-xs text-gray-500">{staff.user?.fullName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Fermer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-gray-400">
            <svg className="mx-auto h-6 w-6 animate-spin mb-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Chargement des horaires…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-1">
            {DAY_ORDER.map((dayKey, index) => {
              const d = days[index];
              if (!d) return null;

              const hasStartError = d._errors?.includes("startTime");
              const hasEndError = d._errors?.includes("endTime");

              return (
                <div
                  key={dayKey}
                  className={`grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 border-b border-gray-50 last:border-b-0 ${
                    d.isClosed ? "opacity-50" : ""
                  }`}
                >
                  {/* Day label + closed toggle */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700 min-w-[100px]">
                      {DAY_LABELS[dayKey]}
                    </span>

                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span>Heure de début</span>
                        <input
                          type="time"
                          value={d.startTime}
                          onChange={(e) => updateDay(index, "startTime", e.target.value)}
                          disabled={d.isClosed}
                          className={`h-8 w-[120px] rounded-md border px-2 text-sm ${
                            hasStartError
                              ? "border-red-300 bg-red-50 text-red-600"
                              : "border-gray-200 bg-white text-gray-700"
                          } focus:outline-none focus:ring-2 focus:ring-[#2f3a2e]/20 disabled:cursor-not-allowed disabled:bg-gray-50`}
                        />
                      </label>

                      <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        <span>Heure de fin</span>
                        <input
                          type="time"
                          value={d.endTime}
                          onChange={(e) => updateDay(index, "endTime", e.target.value)}
                          disabled={d.isClosed}
                          className={`h-8 w-[120px] rounded-md border px-2 text-sm ${
                            hasEndError
                              ? "border-red-300 bg-red-50 text-red-600"
                              : "border-gray-200 bg-white text-gray-700"
                          } focus:outline-none focus:ring-2 focus:ring-[#2f3a2e]/20 disabled:cursor-not-allowed disabled:bg-gray-50`}
                        />
                      </label>
                    </div>

                    {(hasStartError || hasEndError) && (
                      <span className="text-xs text-red-500">
                        L'heure de début doit être antérieure à l'heure de fin.
                      </span>
                    )}
                  </div>

                  {/* Closed toggle */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-xs text-gray-500">Fermé</span>
                    <input
                      type="checkbox"
                      checked={d.isClosed}
                      onChange={(e) => updateDay(index, "isClosed", e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2f3a2e] focus:ring-[#2f3a2e] cursor-pointer"
                    />
                  </label>
                </div>
              );
            })}

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2f3a2e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3d4e3b] disabled:opacity-50"
              >
                {saving && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                Enregistrer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}