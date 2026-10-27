"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { getFormationCustomDateMonth, getFormationCustomDateSlots } from "@/actions/formations/custom-dates";

/**
 * « Date libre » picker for a private formation: the client picks the first
 * day; the journées are fixed — 10:00 → 17:00, as many as the formation's
 * duration needs (lib/formations/custom-date-availability.js). The journées
 * after the first fall on the animator's next free days, which the server
 * names; the client is shown each of them, and the booking action
 * re-validates the choice against those same days.
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

/** Same rule as customDatePerDayMinutes: a journée is always 10:00 → 17:00. */
export function perDayMinutes() {
  return 7 * 60;
}

/** "7 h 30" from 450 minutes. */
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
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
 * @param {{ date: string, time: string, days: number, dates: string[] } | null} props.value
 * @param {(value: { date: string, time: string, days: number, dates: string[] } | null) => void} props.onChange
 * @param {Function} [props.loadMonth] - defaults to the public getFormationCustomDateMonth
 * @param {Function} [props.loadSlots] - defaults to the public getFormationCustomDateSlots
 */
export function CustomDatePicker({
  formationId,
  durationMinutes,
  value,
  onChange,
  loadMonth = getFormationCustomDateMonth,
  loadSlots = getFormationCustomDateSlots,
}) {
  const firstMonth = currentMonthKey();
  const [monthKey, setMonthKey] = useState(firstMonth);
  const [monthDays, setMonthDays] = useState(null); // null = loading
  const [dateKey, setDateKey] = useState(value?.date ?? null);
  const [days, setDays] = useState(value?.days ?? 1);
  const [slots, setSlots] = useState(null); // { [journées]: string[] } | null
  const [slotDates, setSlotDates] = useState({}); // { [journées]: the days of that booking }
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setMonthDays(null);
    loadMonth(formationId, monthKey).then((result) => {
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
  }, [formationId, monthKey, loadMonth]);

  useEffect(() => {
    if (!dateKey) return;
    let active = true;
    setLoadingSlots(true);
    loadSlots(formationId, dateKey).then((result) => {
      if (!active) return;
      setLoadingSlots(false);
      setSlotDates(result.success ? result.data.dates ?? {} : {});
      setSlots(result.success ? result.data.times : {});
    });
    return () => {
      active = false;
    };
  }, [formationId, dateKey, loadSlots]);

  function pickDate(nextDateKeyValue) {
    setDateKey(nextDateKeyValue);
    setSlots(null);
    setDays(1);
    onChange(null);
  }

  // Nothing left to choose once the day is picked: the number of journées
  // comes from the duration and the hours are fixed — select it outright.
  useEffect(() => {
    if (!slots || !dateKey) return;
    const count = Object.keys(slots).map(Number).find((option) => (slots[option] ?? []).length > 0);
    if (!count) return;
    setDays(count);
    const time = slots[count][0];
    const dates = slotDates[count] ?? [];
    if (value?.date !== dateKey || value?.time !== time || value?.days !== count || value?.dates?.join() !== dates.join()) {
      onChange({ date: dateKey, time, days: count, dates });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, dateKey]);

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
  const dates = slotDates[days] ?? [];

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

          {loadingSlots || slots === null ? (
            <p className="flex items-center gap-2 text-xs text-ink/50">
              <Loader2 size={14} className="animate-spin" /> Chargement des horaires…
            </p>
          ) : times.length === 0 ? (
            <p data-testid="custom-date-no-times" className="text-xs text-ink/50">
              Cette date n&apos;est plus disponible. Choisissez-en une autre.
            </p>
          ) : (
            <div data-testid="custom-date-choice" data-days={days} className="rounded-lg border border-gold bg-gold/5 px-3 py-2.5 text-sm">
              <span className="block font-medium text-ink">
                {days} journée{days > 1 ? "s" : ""} · {times[0]} – {endTimeOf(times[0], perDayMinutes())}
                {days > 1 ? " chaque jour" : ""}
              </span>
              {days > 1 && (
                <ul data-testid="custom-date-days" className="mt-1.5 space-y-0.5 text-xs capitalize text-ink/70">
                  {dates.map((key, index) => (
                    <li key={key} data-date={key}>
                      <span className="normal-case text-ink/45">Journée {index + 1} · </span>
                      {formatDateKey(key, { weekday: "long", day: "numeric", month: "long" })}
                    </li>
                  ))}
                </ul>
              )}
              <span className="mt-1 block text-xs text-ink/50">
                formation de {formatMinutes(Number(durationMinutes))} au total
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
