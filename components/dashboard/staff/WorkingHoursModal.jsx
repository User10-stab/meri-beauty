"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, X } from "lucide-react";
import { toast } from "sonner";
import { getWorkingHours, upsertWorkingHours } from "@/actions/staff/working-hours";
import { WEEKS_OF_MONTH, weeksOfRule } from "@/lib/working-day-overrides";
import { FifthDayAssignDialog, fifthDayLabel } from "@/components/dashboard/staff/FifthDayAssignDialog";

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

const WEEK_LABELS = { 1: "1er", 2: "2e", 3: "3e", 4: "4e", 5: "5e" };

// How many coming 5th days are listed under a weekday.
const FIFTH_DAYS_SHOWN = 2;

/** The weeks of the month as the form holds them: never empty, the default [1–4] spelled out. */
const weeksOf = weeksOfRule;

/**
 * @param {object} props
 * @param {object} props.staff — { id, user: { fullName } }
 * @param {() => void} props.onClose
 */
export function WorkingHoursModal({ staff, onClose }) {
  const [days, setDays] = useState([]);
  // Whether « 5e » was ticked when the modal opened, per weekday — the 5th days listed reflect that.
  const [savedFifth, setSavedFifth] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The coming 5th days of the weekdays shared by weeks of the month, as saved.
  const [fifthDays, setFifthDays] = useState([]);
  const [assigning, setAssigning] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await getWorkingHours(staff.id);
      if (res.success) {
        setDays(res.data);
        setSavedFifth(Object.fromEntries(res.data.map((d) => [d.day, weeksOf(d).includes(5)])));
        setFifthDays(res.fifthDays ?? []);
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

  // At least one week stays ticked: an open day with no week would mean nothing.
  // Toggled from the latest state, so two quick clicks never undo each other.
  function toggleWeek(index, week) {
    const toggle = (weeks) => (weeks.includes(week) ? weeks.filter((w) => w !== week) : [...weeks, week].sort());
    if (toggle(weeksOf(days[index])).length === 0) {
      toast.error("Gardez au moins une semaine, ou cochez « Fermé ».");
      return;
    }
    setDays((prev) => {
      const next = toggle(weeksOf(prev[index]));
      if (next.length === 0) return prev;
      const copy = [...prev];
      copy[index] = { ...copy[index], weeksOfMonth: next };
      return copy;
    });
  }

  const closeAssign = useCallback(() => setAssigning(null), []);
  const reloadFifthDays = useCallback(async () => {
    const res = await getWorkingHours(staff.id);
    if (res.success) setFifthDays(res.fifthDays ?? []);
  }, [staff.id]);

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
        weeksOfMonth: d.isClosed ? [] : weeksOf(d),
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
      if (e.key === "Escape" && !assigning) onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, assigning]);

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
      <div className="flex max-h-[92vh] w-full max-w-[760px] flex-col rounded-2xl bg-white shadow-xl animate-in fade-in-0 zoom-in-95 duration-200">
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
          <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-4 space-y-1">
            <p className="pb-2 text-xs text-gray-500">
              Sous chaque jour, cochez les semaines du mois où elle travaille (ex. le 1er et le 3e samedi) : réglé une
              fois, appliqué tous les mois. « 5e » = le 5e samedi (lundi…) des mois qui en ont un : cochez-le si elle le
              travaille aussi. Pour changer une seule date, utilisez « Modifier ».
            </p>
            {DAY_ORDER.map((dayKey, index) => {
              const d = days[index];
              if (!d) return null;

              const hasStartError = d._errors?.includes("startTime");
              const hasEndError = d._errors?.includes("endTime");

              const weeks = weeksOf(d);
              const dayName = DAY_LABELS[dayKey].toLowerCase();
              const comingFifths = fifthDays.filter((f) => f.day === dayKey).slice(0, FIFTH_DAYS_SHOWN);
              const canAssign = comingFifths.some((f) => f.isCandidate);
              const fifthChanged = weeks.includes(5) !== Boolean(savedFifth[dayKey]);

              return (
                <div key={dayKey} className="py-2.5 border-b border-gray-50 last:border-b-0">
                <div
                  className={`grid grid-cols-[1fr_auto] items-center gap-3 ${
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

                {!d.isClosed && (
                  <div className="mt-2 pl-[112px] text-xs text-gray-500">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>Semaines du mois :</span>
                      {WEEKS_OF_MONTH.map((week) => (
                        <button
                          key={week}
                          type="button"
                          aria-pressed={weeks.includes(week)}
                          aria-label={`${WEEK_LABELS[week]} ${dayName} du mois`}
                          title={week === 5 ? `Le 5e ${dayName} des mois qui en ont un` : undefined}
                          data-week={week}
                          onClick={() => toggleWeek(index, week)}
                          className={`h-7 min-w-[44px] rounded-md border px-2 font-medium transition-colors ${
                            week === 5 ? "ml-2 " : ""
                          }${
                            weeks.includes(week)
                              ? "border-[#2f3a2e] bg-[#2f3a2e] text-white"
                              : "border-gray-200 bg-white text-gray-400 hover:border-gray-300"
                          }`}
                        >
                          {WEEK_LABELS[week]}
                        </button>
                      ))}
                    </div>

                    <div className="mt-1.5 space-y-1" data-fifth-days={dayKey}>
                      <p className="text-gray-500">
                        {weeks.includes(5)
                          ? `5e ${dayName} : elle le travaille, sans rien à faire chaque mois.`
                          : `5e ${dayName} : elle ne le travaille pas.`}
                        {fifthChanged && <span className="ml-1 text-amber-700">Enregistrez pour l&apos;appliquer.</span>}
                      </p>
                      {fifthChanged ? null : !canAssign ? (
                        <p className="text-gray-400">
                          Ce jour n&apos;est pas encore enregistré pour elle : cliquez sur « Enregistrer », puis rouvrez
                          cette fenêtre pour voir les prochains 5es {dayName}s.
                        </p>
                      ) : (
                        comingFifths.map((f) => (
                          <div key={f.dateKey} className="flex items-center gap-2">
                            <span className="text-gray-600">{fifthDayLabel(f.dateKey, f.day)} :</span>
                            {f.assignedNames.length > 0 ? (
                              <span className="font-medium text-gray-800">{f.assignedNames.join(", ")}</span>
                            ) : (
                              <span className="font-medium text-amber-700">personne pour l&apos;instant</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setAssigning(f.dateKey)}
                              className="rounded-md border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-50"
                            >
                              Modifier
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
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

      {assigning && <FifthDayAssignDialog dateKey={assigning} onClose={closeAssign} onAssigned={reloadFifthDays} />}
    </div>
  );
}