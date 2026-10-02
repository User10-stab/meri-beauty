"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { getFormationCustomDateMonth, getFormationCustomDateSlots } from "@/actions/formations/custom-dates";

/**
 * « Date libre » picker for a private formation: a day, then one or two
 * journées, then a start time. Everything it offers comes from the animator's
 * calendar (lib/formations/custom-date-availability.js) — the booking action
 * re-validates the choice, this only keeps the client from picking a day that
 * would be refused.
 */

const WEEK_DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const pad = (n) => String(n).padStart(2, "0");

/** A "YYYY-MM-DD" calendar day, read as itself whatever the browser's zone. */
function dayDate(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function formatDateKey(dateKey, options = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) {
  return dayDate(dateKey).toLocaleDateString("fr-FR", { ...options, timeZone: "UTC" });
}

export function nextDateKey(dateKey) {
  const next = dayDate(dateKey);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** Same rule as customDatePerDayMinutes (lib/formations/custom-date-availability.js). */
export function perDayMinutes(totalMinutes, days) {
  const total = Number(totalMinutes || 0);
  return days === 2 ? Math.ceil(total / 2) : total;
}

/** "10:00" + 240 min → "14:00". */
export function endTimeOf(time, durationMinutes) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + Number(durationMinutes || 0);
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function currentMonthKey() {
  // The salon's month, not the browser's: late on the 31st in another zone
  // the two differ.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  return `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}`;
}

function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/**
 * @param {object} props
 * @param {string} props.formationId
 * @param {number} props.durationMinutes - the formation's TOTAL duration
 * @param {{ date: string, time: string, days: 1|2 } | null} props.value
 * @param {(value: { date: string, time: string, days: 1|2 } | null) => void} props.onChange
 */
export function CustomDatePicker({ formationId, durationMinutes, value, onChange }) {
  const firstMonth = currentMonthKey();
  const [monthKey, setMonthKey] = useState(firstMonth);
  const [monthDays, setMonthDays] = useState(null); // null = loading
  const [dateKey, setDateKey] = useState(value?.date ?? null);
  const [days, setDays] = useState(value?.days ?? 1);
  const [slots, setSlots] = useState(null); // { 1: string[], 2: string[] } | null
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setMonthDays(null);
    getFormationCustomDateMonth(formationId, monthKey).then((result) => {
      if (!active) return;
      if (!result.success) {
        setLoadError(result.message || "Impossible de charger les disponibilités.");
        setMonthDays({});
        return;
      }
      setLoadError("");
      setMonthDays(result.data.days);
    });
    return () => {
      active = false;
    };
  }, [formationId, monthKey]);

  useEffect(() => {
    if (!dateKey) return;
    let active = true;
    setLoadingSlots(true);
    getFormationCustomDateSlots(formationId, dateKey).then((result) => {
      if (!active) return;
      setLoadingSlots(false);
      setSlots(result.success ? result.data.times : { 1: [], 2: [] });
    });
    return () => {
      active = false;
    };
  }, [formationId, dateKey]);

  function pickDate(nextDateKeyValue) {
    setDateKey(nextDateKeyValue);
    setSlots(null);
    setDays(1);
    onChange(null);
  }

  // A formation too long for one working day (or a day with no room left for
  // it) has no one-journée answer: it is two journées automatically.
  useEffect(() => {
    if (!slots) return;
    if (days === 1 && slots[1].length === 0 && slots[2].length > 0) setDays(2);
  }, [slots, days]);

  function pickDays(nextDays) {
    setDays(nextDays);
    onChange(null);
  }

  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Monday-first grid.
  const leadingBlanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const times = slots?.[days] ?? [];
  const twoDaysPossible = (slots?.[2] ?? []).length > 0;
  const oneDayPossible = (slots?.[1] ?? []).length > 0;

  return (
    <div data-testid="custom-date-picker" className="space-y-5">
      {/* Day */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Mois précédent"
            onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            disabled={monthKey <= firstMonth}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:border-gold/40 hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span data-testid="custom-date-month" className="text-sm font-semibold capitalize text-ink">{monthLabel}</span>
          <button
            type="button"
            aria-label="Mois suivant"
            onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            disabled={monthKey >= shiftMonth(firstMonth, 12)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/15 text-ink transition-colors hover:border-gold/40 hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEK_DAYS.map((label) => (
            <span key={label} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/40">
              {label}
            </span>
          ))}
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const key = `${monthKey}-${pad(index + 1)}`;
            const free = Boolean(monthDays?.[key]);
            const selected = key === dateKey;
            return (
              <button
                key={key}
                type="button"
                data-date={key}
                data-free={free ? "true" : "false"}
                disabled={!free}
                aria-pressed={selected}
                aria-label={formatDateKey(key)}
                onClick={() => pickDate(key)}
                className={`flex h-9 items-center justify-center rounded-lg text-sm transition-colors ${
                  selected
                    ? "bg-gold font-semibold text-white"
                    : free
                      ? "border border-ink/10 text-ink hover:border-gold/50 hover:bg-gold/10"
                      : "cursor-not-allowed text-ink/20"
                }`}
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        {monthDays === null && (
          <p className="mt-3 flex items-center gap-2 text-xs text-ink/50">
            <Loader2 size={14} className="animate-spin" /> Chargement des disponibilités…
          </p>
        )}
        {loadError && <p className="mt-3 text-xs text-red-600">{loadError}</p>}
        {monthDays !== null && !loadError && Object.keys(monthDays).length === 0 && (
          <p data-testid="custom-date-month-empty" className="mt-3 text-xs text-ink/50">
            Aucune disponibilité ce mois-ci. Essayez le mois suivant.
          </p>
        )}
      </div>

      {/* Duration + start time */}
      {dateKey && (
        <div className="space-y-4 border-t border-ink/8 pt-4">
          <p className="text-sm text-ink/70">
            <span className="font-semibold capitalize text-ink">{formatDateKey(dateKey)}</span>
          </p>

          <div>
            <p className="mb-2 text-xs font-medium text-ink/60">Durée de la formation</p>
            <div role="radiogroup" aria-label="Durée de la formation" className="grid grid-cols-2 gap-2">
              {[1, 2].map((option) => {
                const disabled = slots !== null && (option === 2 ? !twoDaysPossible : !oneDayPossible && twoDaysPossible);
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={days === option}
                    data-testid={`custom-date-days-${option}`}
                    disabled={disabled || slots === null}
                    onClick={() => pickDays(option)}
                    className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      days === option ? "border-gold bg-gold/5" : "border-ink/10 hover:border-ink/20"
                    }`}
                  >
                    <span className="block font-medium text-ink">{option === 1 ? "1 journée" : "2 journées"}</span>
                    <span className="block text-xs text-ink/50">
                      {option === 1
                        ? disabled
                          ? "Ne tient pas sur une seule journée"
                          : "La formation sur un seul jour"
                        : disabled
                          ? "Le lendemain n'est pas disponible"
                          : `Ce jour et le lendemain (${formatDateKey(nextDateKey(dateKey), { weekday: "long", day: "numeric", month: "long" })})`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink/60">
              Heure de début{days === 2 ? " (identique les deux jours)" : ""}
            </p>
            {loadingSlots || slots === null ? (
              <p className="flex items-center gap-2 text-xs text-ink/50">
                <Loader2 size={14} className="animate-spin" /> Chargement des horaires…
              </p>
            ) : times.length === 0 ? (
              <p data-testid="custom-date-no-times" className="text-xs text-ink/50">
                Plus aucun horaire disponible ce jour-là. Choisissez une autre date.
              </p>
            ) : (
              <div data-testid="custom-date-times" className="flex flex-wrap gap-2">
                {times.map((time) => {
                  const selected = value?.date === dateKey && value?.days === days && value?.time === time;
                  return (
                    <button
                      key={time}
                      type="button"
                      data-time={time}
                      aria-pressed={selected}
                      onClick={() => onChange({ date: dateKey, time, days })}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? "border-gold bg-gold font-semibold text-white"
                          : "border-ink/15 text-ink hover:border-gold/50 hover:bg-gold/10"
                      }`}
                    >
                      {time}
                      <span className={`ml-1 text-xs ${selected ? "text-white/80" : "text-ink/40"}`}>
                        – {endTimeOf(time, perDayMinutes(durationMinutes, days))}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
