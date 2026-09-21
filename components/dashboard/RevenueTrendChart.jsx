"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/**
 * Monthly revenue chart for the admin dashboard.
 *
 * Replaces the previous bare `<div>` bars, which were unreadable in practice:
 * every bar was scaled against the single best day of the month, so one big
 * day flattened every other day into the 4% minimum height — and because that
 * same 4% floor was also applied to days with no takings at all, a real 40 €
 * day looked exactly like a day with nothing. There was no axis either, so a
 * bar's height meant nothing on its own.
 *
 * What this draws instead:
 *  - a real euro axis with hairline gridlines rounded to clean values;
 *  - no bar at all on days with zero takings, so any bar you see is money;
 *  - a reference line at the average of the days that actually took money,
 *    which is the number "is this a good day?" is really asked against;
 *  - a "Cumulé" view — the running month total, which rises on every single
 *    day with revenue however small, so progress is always visible;
 *  - a "Tableau" view, so no value is reachable only by hovering.
 *
 * In the running month the days after today are drawn as empty (not as 0 €)
 * and are excluded from the total, the average and the cumulative curve.
 */

const EUR = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });
const EUR_ROUND = new Intl.NumberFormat("fr-BE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function formatEuro(value) {
  return EUR.format(value);
}

function formatAxis(value) {
  return EUR_ROUND.format(value);
}

function dayNumber(dateKey) {
  return Number(dateKey.slice(8, 10));
}

function longDate(dateKey) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Brussels",
  }).format(new Date(`${dateKey}T12:00:00`));
}

/** Rounds an axis maximum up to the next clean 1 / 2 / 2.5 / 5 × 10ⁿ value. */
function niceCeil(value) {
  if (!(value > 0)) return 100;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalised = value / base;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * base;
}

const TICK_FRACTIONS = [1, 0.75, 0.5, 0.25, 0];
const PLOT_HEIGHT = 200;
// Narrowest a day slot may get before the strip starts scrolling — enough
// for a two-digit label plus air on both sides.
const SLOT_MIN_PX = 22;

const VIEWS = [
  { id: "daily", label: "Par jour" },
  { id: "cumulative", label: "Cumulé" },
  { id: "table", label: "Tableau" },
];

export function RevenueTrendChart({ days, monthLabel, todayKey, isCurrentMonth, href }) {
  const [view, setView] = useState("daily");
  const clipId = useId();

  const model = useMemo(() => {
    const todayIndex = days.findIndex((d) => d.date === todayKey);
    // A day that hasn't happened yet is missing data, not a zero — counting it
    // would halve the average halfway through the month.
    const lastElapsed = isCurrentMonth && todayIndex >= 0 ? todayIndex : days.length - 1;
    const elapsed = days.slice(0, lastElapsed + 1);
    const active = elapsed.filter((d) => d.total > 0);
    const total = elapsed.reduce((sum, d) => sum + d.total, 0);
    const best = active.reduce((a, b) => (a === null || b.total > a.total ? b : a), null);
    const average = active.length > 0 ? total / active.length : 0;

    let running = 0;
    const cumulative = elapsed.map((d) => {
      running += d.total;
      return { date: d.date, total: d.total, running };
    });

    return {
      elapsed,
      cumulative,
      total,
      best,
      average,
      activeCount: active.length,
      dailyMax: niceCeil(Math.max(0, ...elapsed.map((d) => d.total))),
      cumulativeMax: niceCeil(running),
    };
  }, [days, todayKey, isCurrentMonth]);

  const hasRevenue = model.total > 0;
  // Only the running month has a "today" to point at.
  const markToday = isCurrentMonth ? todayKey : null;

  return (
    <div className="rounded-[10px] border border-stroke bg-white p-6 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-dark dark:text-white">Revenus — {monthLabel}</h2>
          {href ? (
            <Link
              href={href}
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-gray-500 underline-offset-2 hover:underline dark:text-dark-6"
            >
              Voir le journal des recettes
              <ArrowUpRight size={12} />
            </Link>
          ) : null}
        </div>
        <ViewSwitch view={view} onChange={setView} />
      </div>

      <SummaryStrip model={model} isCurrentMonth={isCurrentMonth} />

      {!hasRevenue ? (
        <p className="py-10 text-center text-sm text-gray-400">
          Aucun encaissement enregistré sur ce mois.
        </p>
      ) : view === "table" ? (
        <TableView model={model} />
      ) : (
        <Plot model={model} view={view} todayKey={markToday} clipId={clipId} />
      )}
    </div>
  );
}

function ViewSwitch({ view, onChange }) {
  return (
    <div
      role="tablist"
      aria-label="Mode d'affichage des revenus"
      className="flex shrink-0 rounded-lg border border-stroke bg-gray-50 p-0.5 dark:border-dark-3 dark:bg-dark-2"
    >
      {VIEWS.map((item) => {
        const active = item.id === view;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-white text-dark shadow-sm dark:bg-gray-dark dark:text-white"
                : "text-gray-500 hover:text-dark dark:text-dark-6 dark:hover:text-white"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryStrip({ model, isCurrentMonth }) {
  const items = [
    { label: isCurrentMonth ? "Total à ce jour" : "Total du mois", value: formatEuro(model.total) },
    {
      label: `Moyenne — ${model.activeCount} jour${model.activeCount > 1 ? "s" : ""} avec recettes`,
      value: model.average > 0 ? formatEuro(model.average) : "—",
    },
    {
      label: model.best ? `Meilleur jour — le ${dayNumber(model.best.date)}` : "Meilleur jour",
      value: model.best ? formatEuro(model.best.total) : "—",
    },
  ];
  return (
    <dl className="mb-6 grid grid-cols-3 gap-4 border-b border-stroke pb-4 dark:border-dark-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dd className="truncate text-base font-semibold text-dark dark:text-white">{item.value}</dd>
          <dt className="truncate text-xs text-gray-500 dark:text-dark-6">{item.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function Plot({ model, view, todayKey, clipId }) {
  const daily = view === "daily";
  const max = daily ? model.dailyMax : model.cumulativeMax;
  const slots = model.elapsed.length;
  const averagePct = daily && model.average > 0 ? (model.average / max) * 100 : null;

  return (
    <div className="flex gap-2">
      {/* ── Y axis ── */}
      <div className="relative w-14 shrink-0" style={{ height: `${PLOT_HEIGHT}px` }}>
        {TICK_FRACTIONS.map((fraction) => (
          <span
            key={fraction}
            style={{ bottom: `${fraction * 100}%` }}
            className="absolute right-0 translate-y-1/2 text-[10px] tabular-nums text-gray-400 dark:text-dark-6"
          >
            {formatAxis(max * fraction)}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto pb-1">
        <div style={{ minWidth: `${slots * SLOT_MIN_PX}px` }}>
          <div className="relative" style={{ height: `${PLOT_HEIGHT}px` }}>
            {/* Gridlines — solid hairlines, one step off the surface. */}
            {TICK_FRACTIONS.map((fraction) => (
              <div
                key={fraction}
                style={{ bottom: `${fraction * 100}%` }}
                className="pointer-events-none absolute inset-x-0 h-px bg-stroke dark:bg-dark-3"
              />
            ))}

            {/* Average of the days that actually took money. */}
            {averagePct !== null && averagePct < 92 && (
              <div
                style={{ bottom: `${averagePct}%` }}
                className="pointer-events-none absolute inset-x-0 h-px bg-[#2f3a2e]/35 dark:bg-[#a9c0a3]/40"
              >
                <span className="absolute -top-4 right-0 rounded bg-white px-1 text-[10px] font-medium text-gray-500 dark:bg-gray-dark dark:text-dark-6">
                  moy. {formatAxis(model.average)}
                </span>
              </div>
            )}

            {daily ? (
              <Columns points={model.elapsed} max={max} best={model.best} todayKey={todayKey} />
            ) : (
              <CumulativeCurve points={model.cumulative} max={max} clipId={clipId} />
            )}
          </div>

          <XAxis days={model.elapsed} todayKey={todayKey} />
        </div>
      </div>
    </div>
  );
}

function Columns({ points, max, best, todayKey }) {
  return (
    <div className="absolute inset-0 flex items-end">
      {points.map((day, index) => {
        const isBest = best !== null && day.date === best.date;
        const isToday = day.date === todayKey;
        // A visible bar always means money: zero days draw nothing, and any
        // positive amount keeps a 3px sliver so it can never read as nothing.
        const heightPx = day.total > 0 ? Math.max(3, (day.total / max) * PLOT_HEIGHT) : 0;
        return (
          <div
            key={day.date}
            tabIndex={day.total > 0 ? 0 : -1}
            aria-label={`${longDate(day.date)} : ${formatEuro(day.total)}`}
            className="group relative flex h-full flex-1 items-end justify-center px-px outline-none"
          >
            {day.total > 0 && (
              <>
                <Tooltip index={index} count={points.length}>
                  <span className="font-semibold">{formatEuro(day.total)}</span>
                  <span className="block text-[10px] opacity-70">{longDate(day.date)}</span>
                </Tooltip>
                {isBest && (
                  <span
                    style={{ bottom: `${heightPx + 4}px` }}
                    className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-dark dark:text-white"
                  >
                    {formatAxis(day.total)}
                  </span>
                )}
                <div
                  style={{ height: `${heightPx}px` }}
                  className={`w-full max-w-6 rounded-t-[4px] bg-[#2f3a2e] transition-opacity group-hover:opacity-80 dark:bg-[#a9c0a3] ${
                    isToday ? "ring-2 ring-[#2f3a2e]/25 dark:ring-[#a9c0a3]/30" : ""
                  }`}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CumulativeCurve({ points, max, clipId }) {
  const slots = points.length;
  // Plotted at slot centres so the curve lines up with the daily view's
  // columns and both can share one x axis.
  const coords = points.map((d, i) => ({
    x: i + 0.5,
    y: 100 - (d.running / max) * 100,
  }));
  const last = coords[coords.length - 1];
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const area = `M${coords[0].x} 100 ${coords.map((c) => `L${c.x} ${c.y}`).join(" ")} L${last.x} 100 Z`;

  return (
    <div className="absolute inset-0">
      <svg
        viewBox={`0 0 ${slots} 100`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        <clipPath id={clipId}>
          <rect x="0" y="0" width={slots} height="100" />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          <path d={area} className="fill-[#2f3a2e]/10 dark:fill-[#a9c0a3]/15" />
          <path
            d={line}
            fill="none"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-[#2f3a2e] dark:stroke-[#a9c0a3]"
          />
        </g>
      </svg>

      {/* End marker, in HTML so the SVG's non-uniform scale can't squash it. */}
      <span
        style={{ left: `${(last.x / slots) * 100}%`, bottom: `${100 - last.y}%` }}
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-[#2f3a2e] ring-2 ring-white dark:bg-[#a9c0a3] dark:ring-gray-dark"
      />

      {/* Hover layer: one hit column per day, with a crosshair. */}
      <div className="absolute inset-0 flex">
        {points.map((day, index) => (
          <div
            key={day.date}
            tabIndex={0}
            aria-label={`${longDate(day.date)} : ${formatEuro(day.total)} sur la journée, ${formatEuro(day.running)} cumulé`}
            className="group relative h-full flex-1 outline-none"
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#2f3a2e]/20 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-[#a9c0a3]/30" />
            <Tooltip index={index} count={points.length}>
              <span className="font-semibold">{formatEuro(day.running)} cumulé</span>
              <span className="block text-[10px] opacity-70">
                {longDate(day.date)} · {day.total > 0 ? formatEuro(day.total) : "aucune recette"}
              </span>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tooltip anchored above its slot. Near the edges it aligns to the plot side
 * instead of centring, so the text is never cut off by the card.
 */
function Tooltip({ index, count, children }) {
  const edge = index < 3 ? "left-0" : index > count - 4 ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <span
      className={`pointer-events-none absolute top-1 z-10 ${edge} whitespace-nowrap rounded-md bg-[#2f3a2e] px-2 py-1 text-[11px] leading-tight text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-white dark:text-dark`}
    >
      {children}
    </span>
  );
}

function XAxis({ days, todayKey }) {
  return (
    <div className="mt-2 flex">
      {days.map((day) => {
        const number = dayNumber(day.date);
        const isToday = day.date === todayKey;
        // Every day is numbered — reading "the 17th" off the chart is the
        // whole point of a daily view. SLOT_MIN_PX guarantees the room, and
        // the decades are a shade stronger so the eye can still jump.
        const milestone = number === 1 || number % 5 === 0;
        return (
          <div key={day.date} className="flex flex-1 justify-center">
            <span
              className={`rounded text-[10px] tabular-nums ${
                isToday
                  ? "bg-[#2f3a2e] px-1 font-semibold text-white dark:bg-[#a9c0a3] dark:text-dark"
                  : milestone
                    ? "font-medium text-gray-500 dark:text-dark-6"
                    : "text-gray-400 dark:text-dark-6/70"
              }`}
            >
              {number}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ model }) {
  const rows = model.cumulative.filter((d) => d.total > 0);
  return (
    <div className="max-h-[232px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white dark:bg-gray-dark">
          <tr className="border-b border-stroke text-left text-xs text-gray-500 dark:border-dark-3 dark:text-dark-6">
            <th scope="col" className="py-2 font-medium">
              Jour
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Recettes
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Cumulé
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke dark:divide-dark-3">
          {rows.map((day) => (
            <tr key={day.date}>
              <td className="py-2 text-dark dark:text-white">{longDate(day.date)}</td>
              <td className="py-2 text-right font-medium tabular-nums text-dark dark:text-white">
                {formatEuro(day.total)}
              </td>
              <td className="py-2 text-right tabular-nums text-gray-500 dark:text-dark-6">
                {formatEuro(day.running)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
