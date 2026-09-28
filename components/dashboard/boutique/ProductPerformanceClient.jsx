"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  Download,
  Euro,
  Info,
  Package,
  Search,
  ShoppingBag,
} from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  PERFORMANCE_PERIODS,
  SORT_COLUMNS,
  VERDICTS,
  VERDICT_META,
  filterProducts,
  nextSort,
  readViewFilters,
  searchProducts,
  sortProducts,
  summarizeProducts,
  writeViewFilters,
} from "@/lib/stock/performance-filters";

const PAGE_PATH = "/dashboard/boutique/stock/mouvements/performance";

const TONE_CLASSES = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
  sky: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-500/10 dark:text-orange-300",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300",
  gray: "bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-dark-2 dark:text-dark-6",
};

const STATUS_LABELS = { DRAFT: "Brouillon", ACTIVE: null, ARCHIVED: "Archivé" };

// What the header tooltip says the first click does.
const BEST_FIRST_HINT = {
  name: "de A à Z",
  verdict: "des meilleurs verdicts aux pires",
  sold: "les plus vendus d'abord",
  trend: "les plus fortes hausses d'abord",
  revenue: "le plus gros chiffre d'affaires d'abord",
  margin: "la plus grosse marge d'abord",
  stock: "le plus de stock d'abord",
  coverage: "ceux qui s'écoulent le plus vite d'abord",
  sellThrough: "le meilleur écoulement d'abord",
  lastSale: "les ventes les plus récentes d'abord",
};

const COLUMN_TOOLTIPS = {
  coverage: "Combien de mois le stock actuel tiendra au rythme de vente de la période",
  sellThrough: "Part du stock disponible (début + réassort) qui a été vendue",
};

const money = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("fr-BE", { style: "percent", maximumFractionDigits: 0 });

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-BE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Brussels",
  });
}

function toDateOnly(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY", with no time-zone round trip. */
function formatCalendarDate(value) {
  const [year, month, day] = String(value).split("-");
  return `${day}/${month}/${year}`;
}

function sinceLabel(value) {
  if (!value) return "jamais vendu";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return "aujourd'hui";
  if (days < 31) return `il y a ${days} j`;
  const months = Math.floor(days / 30.44);
  return months < 12 ? `il y a ${months} mois` : `il y a ${Math.floor(months / 12)} an${months >= 24 ? "s" : ""}`;
}

function formatCoverage(product) {
  if (product.coverageMonths === null) return product.stockNow > 0 ? "∞" : "—";
  if (product.stockNow <= 0) return "Rupture";
  if (product.coverageMonths < 1) return "< 1 mois";
  return `${product.coverageMonths.toLocaleString("fr-BE")} mois`;
}

/**
 * "Performance par produit": one row per product over a period, with a
 * keep/remove verdict.
 *
 * The period (?mois= or ?du=&au=) goes through the server, which recomputes
 * everything for it. Search, verdict chips and the column sort are applied in
 * the browser (one catalogue is small) and mirrored into the URL with
 * history.replaceState, so a sorted/filtered view can be bookmarked or shared
 * without a server round trip on every keystroke. Clicking a column header
 * sorts by it — best products first, a second click for the worst first.
 */
export function ProductPerformanceClient({ data }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState(() => readViewFilters(searchParams));
  const [expanded, setExpanded] = useState(() => new Set());

  const { filters, products, sliceLabels } = data;

  const found = useMemo(() => searchProducts(products, view.q), [products, view.q]);
  const verdictCounts = useMemo(() => summarizeProducts(found).byVerdict, [found]);
  const visible = useMemo(() => sortProducts(filterProducts(products, view), view.sort, view.dir), [products, view]);
  const shown = useMemo(() => summarizeProducts(visible), [visible]);
  const periodLabel = filters.mode === "custom" ? "la période" : `${filters.months} mois`;

  function updateView(patch) {
    setView((current) => ({ ...current, ...patch }));
  }

  // Mirror the view into the URL *after* render. Not inside the setView
  // updater: React runs updaters during render, and Next.js hooks
  // history.replaceState to update its Router — calling it there is a
  // setState on Router while rendering this component.
  useEffect(() => {
    const params = writeViewFilters(new URLSearchParams(window.location.search), view);
    const query = params.toString();
    const target = query ? `${PAGE_PATH}?${query}` : PAGE_PATH;
    if (target !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", target);
    }
  }, [view]);

  function sortBy(key) {
    updateView(nextSort(view, key));
  }

  function toggleVerdict(key) {
    updateView({
      verdicts: view.verdicts.includes(key) ? view.verdicts.filter((v) => v !== key) : [...view.verdicts, key],
    });
  }

  /** Period changes go through the server; the view filters ride along. */
  function goToPeriod(periodParams) {
    const params = writeViewFilters(new URLSearchParams(), view);
    for (const [key, value] of Object.entries(periodParams)) params.set(key, value);
    startTransition(() => {
      router.push(`${PAGE_PATH}?${params.toString()}`, { scroll: false });
    });
  }

  /**
   * Same behaviour as the journal's filter bar: each picker moves only its
   * own end of the range and keeps the other one, so picking « Du » on a
   * 6-month view gives « Du <picked> au <end of the 6 months> ». A reversed
   * pair is fixed by moving the other end to match rather than refused.
   */
  function applyRange({ from = filters.from, to = filters.to }) {
    if (!from || !to) return;
    if (from > to) {
      if (from !== filters.from) to = from;
      else from = to;
    }
    goToPeriod({ du: from, au: to });
  }

  function applyFromMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    applyRange({ from: toDateOnly(new Date(year, month - 1, 1)) });
  }

  function applyToMonth(monthValue) {
    if (!monthValue) return;
    const [year, month] = monthValue.split("-").map(Number);
    const lastDay = new Date(year, month, 0);
    const today = new Date();
    applyRange({ to: toDateOnly(lastDay > today ? today : lastDay) });
  }

  const today = toDateOnly(new Date());
  const thisYear = new Date().getFullYear();
  const yearShortcuts = [
    { key: "this-year", label: "Cette année", from: `${thisYear}-01-01`, to: today },
    { key: "last-year", label: "L'année dernière", from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
  ];

  function toggle(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const header = [
      "Produit",
      "Marque",
      "Catégorie",
      "Statut",
      "Verdict",
      "Classe ABC",
      "Vendus",
      "Retours",
      "Vendus nets",
      "Moyenne / mois",
      "CA TTC",
      "Part du CA",
      "CA HT",
      "Coût d'achat HT",
      "Marge HT",
      "Taux de marge",
      "Stock début",
      "Réassort",
      "Prestations",
      "Pertes",
      "Stock actuel",
      "Valeur stock (coût HT)",
      "Mois de stock",
      "Taux d'écoulement",
      "Dernière vente",
      ...sliceLabels.map((label) => `Vendus ${label}`),
    ];
    const rows = visible.map((p) => [
      p.name,
      p.brand?.name ?? "",
      p.category?.name ?? "",
      p.status,
      VERDICT_META[p.verdict].label,
      p.abcClass ?? "",
      p.unitsSold,
      p.unitsReturned,
      p.netSold,
      p.avgPerMonth,
      p.revenueTtc,
      Math.round(p.revenueShare * 1000) / 10,
      p.revenueHt,
      p.costOfSales,
      p.marginHt,
      p.marginRate === null ? "" : Math.round(p.marginRate * 1000) / 10,
      p.stockStart,
      p.restocked,
      p.salonUsage,
      p.losses,
      p.stockNow,
      p.stockValueAtCost,
      p.coverageMonths ?? "",
      p.sellThrough === null ? "" : Math.round(p.sellThrough * 1000) / 10,
      formatDate(p.lastSaleAt),
      ...p.monthly,
    ]);
    // Semicolon + decimal comma: what a Belgian Excel opens without an import wizard.
    const cell = (value) => {
      const text = typeof value === "number" ? String(value).replace(".", ",") : String(value ?? "");
      return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = "﻿" + [header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `performance-produits-${filters.from}_${filters.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const removeBucket = shown.byVerdict.REMOVE;
  const overstockBucket = shown.byVerdict.OVERSTOCK;
  const dateInputClass =
    "rounded-[7px] border border-stroke bg-transparent px-3 py-2 text-sm outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white";

  return (
    <div className={`space-y-6 ${pending ? "opacity-60" : ""}`}>
      {/* ── Period ───────────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">
              Période analysée
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PERFORMANCE_PERIODS.map((months) => (
                <Pill key={months} active={filters.mode === "preset" && filters.months === months} onClick={() => goToPeriod({ mois: String(months) })}>
                  {months} derniers mois
                </Pill>
              ))}
              {yearShortcuts.map((shortcut) => (
                <Pill
                  key={shortcut.key}
                  active={filters.mode === "custom" && filters.from === shortcut.from && filters.to === shortcut.to}
                  onClick={() => goToPeriod({ du: shortcut.from, au: shortcut.to })}
                >
                  {shortcut.label}
                </Pill>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-[7px] border border-stroke bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary hover:text-primary dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            Exporter (CSV)
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <DateField id="perf-from" label="Du" icon={CalendarRange}>
            <input
              id="perf-from"
              type="date"
              value={filters.from}
              max={filters.to}
              onChange={(event) => applyRange({ from: event.target.value })}
              className={dateInputClass}
            />
          </DateField>
          <DateField id="perf-to" label="Au" icon={CalendarRange}>
            <input
              id="perf-to"
              type="date"
              value={filters.to}
              min={filters.from}
              max={today}
              onChange={(event) => applyRange({ to: event.target.value })}
              className={dateInputClass}
            />
          </DateField>
          <DateField id="perf-from-month" label="Du mois" icon={CalendarRange}>
            <input
              id="perf-from-month"
              type="month"
              value={filters.from.slice(0, 7)}
              max={today.slice(0, 7)}
              onChange={(event) => applyFromMonth(event.target.value)}
              className={dateInputClass}
            />
          </DateField>
          <DateField id="perf-to-month" label="Au mois" icon={CalendarRange}>
            <input
              id="perf-to-month"
              type="month"
              value={filters.to.slice(0, 7)}
              max={today.slice(0, 7)}
              onChange={(event) => applyToMonth(event.target.value)}
              className={dateInputClass}
            />
          </DateField>
          <p className="pb-2 text-sm text-gray-500 dark:text-dark-6">
            Du <strong>{formatCalendarDate(filters.from)}</strong> au <strong>{formatCalendarDate(filters.to)}</strong> ·{" "}
            {filters.days} jour{filters.days > 1 ? "s" : ""}
          </p>
        </div>
        {filters.mode === "custom" && (
          <p className="text-xs text-gray-500 dark:text-dark-6">
            Les colonnes « Stock », « Mois de stock » et « Dernière vente » sont toujours celles d'aujourd'hui ; les ventes,
            le chiffre d'affaires et la marge portent sur la période choisie.
          </p>
        )}
      </div>

      {data.history && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-[10px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100"
        >
          <Info className="mt-0.5 h-4 w-4 flex-shrink-0" strokeWidth={2} />
          <p>
            Les données ne remontent qu'au <strong>{formatCalendarDate(data.history.since)}</strong> ({data.history.coveredDays} jours) :
            la période choisie commence avant. Les chiffres portent sur cette durée, et les verdicts restent indicatifs tant que
            l'historique est aussi court.
          </p>
        </div>
      )}

      {/* ── Search + verdict chips ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
        <div className="relative w-full max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={view.q}
            onChange={(event) => updateView({ q: event.target.value })}
            placeholder="Produit, déclinaison ou référence"
            className="h-9 w-full rounded-lg border border-stroke bg-transparent pl-9 pr-3 text-sm text-gray-700 outline-none focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
          />
        </div>

        {/* Several verdicts at once (e.g. « À retirer ? » + « Surstock »). */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6">Verdict</span>
          {VERDICTS.filter((key) => verdictCounts[key] || view.verdicts.includes(key)).map((key) => (
            <VerdictChip
              key={key}
              tone={VERDICT_META[key].tone}
              active={view.verdicts.includes(key)}
              onClick={() => toggleVerdict(key)}
              label={VERDICT_META[key].short}
              count={verdictCounts[key]?.count ?? 0}
              title={VERDICT_META[key].help}
            />
          ))}
          {view.verdicts.length > 0 && (
            <button
              type="button"
              onClick={() => updateView({ verdicts: [] })}
              className="text-xs font-semibold text-gray-500 underline-offset-2 hover:text-primary hover:underline dark:text-dark-6"
            >
              Tous les verdicts
            </button>
          )}
        </div>
      </div>

      {/* ── Totals (follow the filters) ──────────────────────────────────── */}
      <p className="text-sm text-gray-500 dark:text-dark-6">
        {shown.productCount === products.length
          ? `${products.length} produits`
          : `${shown.productCount} produit${shown.productCount > 1 ? "s" : ""} sur ${products.length}`}
      </p>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard icon={<Euro size={20} />} label="Chiffre d'affaires TTC" value={money.format(shown.revenueTtc)} />
        <StatCard icon={<Euro size={20} />} label="Marge brute HT" value={money.format(shown.marginHt)} />
        <StatCard icon={<ShoppingBag size={20} />} label="Unités vendues (nettes)" value={shown.unitsSold} />
        <StatCard icon={<Package size={20} />} label="Valeur du stock (coût HT)" value={money.format(shown.stockValueAtCost)} />
      </div>

      {(removeBucket || overstockBucket) && (
        <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          {removeBucket && (
            <p>
              <strong>{removeBucket.count}</strong> produit{removeBucket.count > 1 ? "s" : ""} sans aucune vente sur {periodLabel} —{" "}
              {money.format(removeBucket.stockValueAtCost)} de stock immobilisé (au prix d'achat).
            </p>
          )}
          {overstockBucket && (
            <p>
              <strong>{overstockBucket.count}</strong> produit{overstockBucket.count > 1 ? "s" : ""} en surstock (plus de 12 mois de
              ventes en rayon) — {money.format(overstockBucket.stockValueAtCost)} au prix d'achat.
            </p>
          )}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="rounded-[10px] border border-stroke bg-white shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">

        {visible.length === 0 ? (
          <div className="px-6 py-16 text-center font-medium text-gray-700 dark:text-white">Aucun produit ne correspond.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead column="name" view={view} onSort={sortBy} className="pl-6" />
                <SortableHead column="verdict" view={view} onSort={sortBy} />
                <SortableHead column="sold" view={view} onSort={sortBy} align="right" />
                <SortableHead column="trend" view={view} onSort={sortBy} />
                <SortableHead column="revenue" view={view} onSort={sortBy} align="right" />
                <SortableHead column="margin" view={view} onSort={sortBy} align="right" />
                <SortableHead column="stock" view={view} onSort={sortBy} align="right" />
                <SortableHead column="coverage" view={view} onSort={sortBy} align="right" />
                <SortableHead column="sellThrough" view={view} onSort={sortBy} align="right" />
                <SortableHead column="lastSale" view={view} onSort={sortBy} className="pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((product) => (
                <ProductRows
                  key={product.id}
                  product={product}
                  sliceLabels={sliceLabels}
                  expanded={expanded.has(product.id)}
                  onToggle={() => toggle(product.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <HowToRead periodLabel={periodLabel} newThresholdDays={data.newThresholdDays} />
    </div>
  );
}

function ProductRows({ product, sliceLabels, expanded, onToggle }) {
  const meta = VERDICT_META[product.verdict];
  const statusLabel = STATUS_LABELS[product.status];
  const hasVariants = product.variants.length > 1;

  return (
    <Fragment>
      <TableRow>
        <TableCell className="pl-6">
          <button
            type="button"
            onClick={hasVariants ? onToggle : undefined}
            className={`flex items-start gap-1.5 text-left ${hasVariants ? "cursor-pointer" : "cursor-default"}`}
            aria-expanded={hasVariants ? expanded : undefined}
          >
            {hasVariants ? (
              expanded ? (
                <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
              )
            ) : (
              <span className="w-4 flex-shrink-0" />
            )}
            <span>
              <span className="block font-medium text-gray-800 dark:text-white">{product.name}</span>
              <span className="block text-xs text-gray-400">
                {hasVariants ? `${product.variants.length} déclinaisons` : product.variants[0]?.sku}
                {statusLabel ? ` · ${statusLabel}` : ""}
              </span>
              {(product.brand || product.category) && (
                <span className="block text-xs text-gray-400">
                  {[product.brand?.name, product.category?.name].filter(Boolean).join(" › ")}
                </span>
              )}
            </span>
          </button>
        </TableCell>
        <TableCell>
          <span
            title={meta.help}
            className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[meta.tone]}`}
          >
            {meta.short}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <div className="font-semibold text-gray-800 dark:text-white">{product.netSold}</div>
          <div className="text-xs text-gray-400">
            {product.avgPerMonth.toLocaleString("fr-BE")}/mois
            {product.unitsReturned > 0 ? ` · ${product.unitsReturned} retour${product.unitsReturned > 1 ? "s" : ""}` : ""}
          </div>
          {(product.salonUsage > 0 || product.losses > 0) && (
            <div className="text-xs text-gray-400">
              {[product.salonUsage > 0 && `${product.salonUsage} en soin`, product.losses > 0 && `${product.losses} perdu${product.losses > 1 ? "s" : ""}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </TableCell>
        <TableCell>
          <Sparkline values={product.monthly} labels={sliceLabels} trend={product.trend} />
        </TableCell>
        <TableCell className="text-right">
          <div className="font-semibold text-gray-800 dark:text-white">{money.format(product.revenueTtc)}</div>
          {product.revenueShare > 0 && <div className="text-xs text-gray-400">{percent.format(product.revenueShare)} du CA</div>}
        </TableCell>
        <TableCell className="text-right">
          <div className={`font-semibold ${product.marginHt < 0 ? "text-red-500" : "text-gray-800 dark:text-white"}`}>
            {money.format(product.marginHt)}
          </div>
          {product.marginRate !== null && <div className="text-xs text-gray-400">{percent.format(product.marginRate)}</div>}
        </TableCell>
        <TableCell className="text-right">
          <div className="font-semibold text-gray-800 dark:text-white">{product.stockNow}</div>
          <div className="text-xs text-gray-400">{money.format(product.stockValueAtCost)}</div>
        </TableCell>
        <TableCell className="text-right text-gray-700 dark:text-dark-6">{formatCoverage(product)}</TableCell>
        <TableCell className="text-right text-gray-700 dark:text-dark-6">
          {product.sellThrough === null ? "—" : percent.format(product.sellThrough)}
        </TableCell>
        <TableCell className="pr-6">
          <div className="text-gray-700 dark:text-dark-6">{sinceLabel(product.lastSaleAt)}</div>
          {product.lastSaleAt && <div className="text-xs text-gray-400">{formatDate(product.lastSaleAt)}</div>}
        </TableCell>
      </TableRow>

      {expanded &&
        product.variants.map((variant) => (
          <TableRow key={variant.id} className="bg-gray-50/60 text-xs dark:bg-dark-2/40">
            <TableCell className="py-2 pl-14">
              <div className="font-medium text-gray-700 dark:text-white">{variant.name}</div>
              <div className="text-gray-400">
                {variant.sku}
                {variant.isActive ? "" : " · désactivée"}
              </div>
            </TableCell>
            <TableCell className="py-2" />
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">
              {variant.netSold}
              {variant.unitsReturned > 0 ? ` (${variant.unitsReturned} ret.)` : ""}
            </TableCell>
            <TableCell className="py-2">
              <Sparkline values={variant.monthly} labels={sliceLabels} trend={variant.trend} small />
            </TableCell>
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">{money.format(variant.revenueTtc)}</TableCell>
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">{money.format(variant.marginHt)}</TableCell>
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">{variant.stockNow}</TableCell>
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">{formatCoverage(variant)}</TableCell>
            <TableCell className="py-2 text-right text-gray-700 dark:text-dark-6">
              {variant.sellThrough === null ? "—" : percent.format(variant.sellThrough)}
            </TableCell>
            <TableCell className="py-2 pr-6 text-gray-700 dark:text-dark-6">{sinceLabel(variant.lastSaleAt)}</TableCell>
          </TableRow>
        ))}
    </Fragment>
  );
}

/** Units sold per monthly slice as small bars, oldest on the left. */
function Sparkline({ values, labels, trend, small = false }) {
  const max = Math.max(1, ...values);
  const height = small ? 18 : 26;
  const barWidth = small ? 5 : 7;
  const gap = 2;
  const width = values.length * (barWidth + gap) - gap;
  const title = values.map((v, i) => `${labels[i]} : ${v}`).join(" · ");

  const TrendIcon = trend === "UP" ? ArrowUpRight : trend === "DOWN" ? ArrowDownRight : trend === "FLAT" ? ArrowRight : null;
  const trendClass = trend === "UP" ? "text-emerald-600" : trend === "DOWN" ? "text-red-500" : "text-gray-400";

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {values.map((value, i) => {
          const barHeight = value > 0 ? Math.max(2, (value / max) * height) : 1;
          return (
            <rect
              key={i}
              x={i * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1}
              className={value > 0 ? "fill-[#2f3a2e] dark:fill-[#c8a46a]" : "fill-gray-200 dark:fill-dark-3"}
            />
          );
        })}
      </svg>
      {TrendIcon && <TrendIcon className={`h-4 w-4 ${trendClass}`} strokeWidth={2.25} />}
      <span className="sr-only">{title}</span>
    </div>
  );
}

function HowToRead({ periodLabel, newThresholdDays }) {
  return (
    <details className="rounded-[10px] border border-stroke bg-white p-4 text-sm text-gray-600 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:text-dark-6 dark:shadow-card">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-gray-700 dark:text-white">
        <Info className="h-4 w-4" strokeWidth={2} />
        Comment lire ce tableau
      </summary>
      <div className="mt-3 space-y-3">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Vendus</strong> : unités vendues sur {periodLabel} (boutique en ligne et caisse), retours
            déduits. Les produits utilisés pendant un soin et les pertes sont indiqués à part — ce ne sont pas des ventes.
          </li>
          <li>
            <strong>CA TTC</strong> : ce qui a réellement été facturé, remises de caisse comprises. Les commandes annulées,
            expirées ou pas encore payées ne comptent pas.
          </li>
          <li>
            <strong>Marge HT</strong> : chiffre d'affaires hors TVA moins le prix d'achat enregistré sur la fiche produit.
          </li>
          <li>
            <strong>Mois de stock</strong> : combien de temps le stock actuel tiendra au rythme de vente de la période. « ∞ »
            = il reste du stock mais rien ne se vend.
          </li>
          <li>
            <strong>Écoulement</strong> : part du stock disponible sur la période (stock de départ + réassorts) qui a été
            vendue.
          </li>
        </ul>
        <div>
          <p className="mb-1 font-semibold text-gray-700 dark:text-white">Les verdicts</p>
          <ul className="space-y-1">
            {VERDICTS.map((key) => (
              <li key={key} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[VERDICT_META[key].tone]}`}
                >
                  {VERDICT_META[key].short}
                </span>
                <span>
                  {VERDICT_META[key].help}
                  {key === "NEW" ? ` (moins de ${newThresholdDays} jours sur cette période)` : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500 dark:text-dark-6">
            Le verdict est une aide à la décision, pas une règle : un produit d'appel, saisonnier ou indispensable aux soins
            peut mériter sa place même s'il se vend peu.
          </p>
        </div>
      </div>
    </details>
  );
}

function DateField({ id, label, icon: Icon, children }) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-dark-6"
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A clickable column header. The arrow shows the current direction on the
 * sorted column and a faint ↕ on the others; the tooltip says what the next
 * click will do, since « best first » means descending for revenue but
 * ascending for months of stock.
 */
function SortableHead({ column, view, onSort, align = "left", className = "" }) {
  const { label, best } = SORT_COLUMNS[column];
  const active = view.sort === column;
  const nextIsBest = !active || view.dir !== best;
  const hint = nextIsBest ? BEST_FIRST_HINT[column] : "ordre inverse";
  const Icon = !active ? ArrowUpDown : view.dir === "asc" ? ArrowUp : ArrowDown;
  const title = [COLUMN_TOOLTIPS[column], `Trier : ${hint}`].filter(Boolean).join(" — ");

  return (
    <TableHead
      className={`${align === "right" ? "text-right" : ""} ${className}`}
      aria-sort={active ? (view.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        title={title}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded font-medium transition-colors hover:text-primary ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-dark dark:text-white" : ""}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "" : "opacity-30"}`} strokeWidth={2} />
      </button>
    </TableHead>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-[#2f3a2e] text-white"
          : "border border-stroke text-gray-500 hover:border-primary hover:text-primary dark:border-dark-3 dark:text-dark-6"
      }`}
    >
      {children}
    </button>
  );
}

function VerdictChip({ active, onClick, label, count, tone, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors ${
        active
          ? "bg-[#2f3a2e] text-white ring-[#2f3a2e]"
          : tone
            ? TONE_CLASSES[tone]
            : "bg-white text-gray-600 ring-stroke dark:bg-gray-dark dark:text-dark-6 dark:ring-dark-3"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 ${active ? "bg-white/20" : "bg-black/5 dark:bg-white/10"}`}>{count}</span>
    </button>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-stroke bg-white p-4 shadow-1 dark:border-dark-3 dark:bg-gray-dark dark:shadow-card">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#2f3a2e]/10 text-[#2f3a2e]">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500 dark:text-dark-6">{label}</div>
        <div className="text-lg font-bold text-dark dark:text-white">{value}</div>
      </div>
    </div>
  );
}
