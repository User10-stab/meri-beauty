"use client";

import dynamic from "next/dynamic";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

// Palette validée (scripts/validate_palette.js) pour les deux thèmes à la
// fois : bande de luminosité, plancher de chroma, séparation daltonienne et
// contraste passent en clair comme en sombre. Ne pas remplacer une teinte
// sans revalider — l'écart deutan/protan entre l'indigo et le turquoise est
// ce qui rend les deux séries distinguables sans dépendre de la couleur.
export const SEO_COLORS = {
  clics: "#5750F1",
  impressions: "#0E8FA8",
  position: "#C97B34",
};

const AXIS_LABEL = { style: { colors: "#9CA3AF", fontSize: "12px" } };

const GRID = {
  strokeDashArray: 4,
  borderColor: "rgba(148,163,184,0.25)",
  padding: { left: 8, right: 8, top: -8 },
};

/** Les dates Search Console ("2026-09-15") en libellé court ("15/09"). */
function shortDate(value) {
  const [, month, day] = String(value).split("-");
  return day && month ? `${day}/${month}` : value;
}

function baseOptions(categories) {
  return {
    chart: {
      fontFamily: "inherit",
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: false },
      parentHeightOffset: 0,
    },
    dataLabels: { enabled: false },
    grid: GRID,
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { ...AXIS_LABEL, rotate: 0, hideOverlappingLabels: true },
      tooltip: { enabled: false },
    },
    legend: { show: false },
    tooltip: { theme: "light", x: { show: true } },
  };
}

/**
 * Clics et impressions, en deux graphiques empilés plutôt qu'un seul à double
 * axe.
 *
 * Les deux mesures n'ont pas du tout le même ordre de grandeur (des dizaines
 * de clics contre des centaines d'impressions). Sur une échelle commune, la
 * courbe des clics s'écrase contre l'axe et devient illisible ; avec deux
 * axes verticaux, n'importe quel croisement des courbes serait un artefact du
 * cadrage, pas un fait. Deux panneaux qui partagent l'axe des dates gardent
 * la comparaison honnête : les formes se lisent, les hauteurs ne se comparent
 * pas entre panneaux.
 */
export function SeoTrendChart({ rows }) {
  const categories = rows.map((row) => shortDate(row.key));
  const shared = baseOptions(categories);

  const panel = (color, name, data, formatter) => ({
    options: {
      ...shared,
      chart: { ...shared.chart, type: "area", height: 150, group: "seo-trend" },
      colors: [color],
      stroke: { curve: "smooth", width: 2 },
      fill: {
        type: "gradient",
        gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.02, stops: [0, 100] },
      },
      markers: { size: 0, hover: { size: 4 } },
      yaxis: { labels: { ...AXIS_LABEL, formatter } },
    },
    series: [{ name, data }],
  });

  const clics = panel(SEO_COLORS.clics, "Clics", rows.map((r) => r.clicks), (v) => Math.round(v));
  const impressions = panel(
    SEO_COLORS.impressions,
    "Impressions",
    rows.map((r) => r.impressions),
    (v) => Math.round(v)
  );

  return (
    <div className="space-y-1">
      <ChartPanel label="Clics" color={SEO_COLORS.clics} {...clics} />
      <ChartPanel label="Impressions" color={SEO_COLORS.impressions} {...impressions} />
    </div>
  );
}

function ChartPanel({ label, color, options, series }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
      </div>
      <Chart options={options} series={series} type="area" height={150} />
    </div>
  );
}

/**
 * Position moyenne dans le temps.
 *
 * L'axe est inversé à dessein : la position 1 est le meilleur résultat
 * possible, donc « vers le haut » doit vouloir dire « ça s'améliore ». Sans
 * cette inversion, une courbe qui monte signalerait une dégringolade.
 */
export function SeoPositionChart({ rows }) {
  const categories = rows.map((row) => shortDate(row.key));
  const shared = baseOptions(categories);

  const options = {
    ...shared,
    chart: { ...shared.chart, type: "line", height: 316 },
    colors: [SEO_COLORS.position],
    stroke: { curve: "smooth", width: 2 },
    markers: { size: 4, strokeWidth: 2, strokeColors: "#fff", hover: { size: 6 } },
    yaxis: {
      reversed: true,
      labels: { ...AXIS_LABEL, formatter: (v) => (v == null ? "—" : v.toFixed(1)) },
    },
    tooltip: { ...shared.tooltip, y: { formatter: (v) => (v == null ? "—" : v.toFixed(1)) } },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Position moyenne", data: rows.map((r) => Number(r.position.toFixed(1))) }]}
      type="line"
      height={316}
    />
  );
}

/**
 * Barres horizontales : les libellés de pays sont du texte, et l'horizontale
 * leur laisse la place de s'écrire en entier sans rotation.
 */
export function SeoCountriesChart({ rows, labels }) {
  const options = {
    ...baseOptions(labels),
    chart: { fontFamily: "inherit", type: "bar", height: 300, toolbar: { show: false }, animations: { enabled: false } },
    colors: [SEO_COLORS.clics],
    plotOptions: {
      bar: { horizontal: true, barHeight: "55%", borderRadius: 4, borderRadiusApplication: "end" },
    },
    // Une seule série : la valeur au bout de chaque barre évite l'aller-retour
    // vers l'axe, et satisfait le contraste exigé par la palette.
    dataLabels: {
      enabled: true,
      offsetX: 24,
      style: { fontSize: "12px", fontWeight: 500, colors: ["#6B7280"] },
    },
    grid: { ...GRID, xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
    yaxis: { labels: { ...AXIS_LABEL } },
  };

  return (
    <Chart options={options} series={[{ name: "Clics", data: rows.map((r) => r.clicks) }]} type="bar" height={300} />
  );
}

/** Ordinateur / mobile / tablette, en clics. */
export function SeoDevicesChart({ rows, labels }) {
  const options = {
    ...baseOptions(labels),
    chart: { fontFamily: "inherit", type: "bar", height: 300, toolbar: { show: false }, animations: { enabled: false } },
    colors: [SEO_COLORS.clics],
    plotOptions: {
      bar: { columnWidth: "42%", borderRadius: 4, borderRadiusApplication: "end", distributed: false },
    },
    dataLabels: {
      enabled: true,
      offsetY: -22,
      style: { fontSize: "12px", fontWeight: 500, colors: ["#6B7280"] },
    },
    yaxis: { labels: { ...AXIS_LABEL, formatter: (v) => Math.round(v) } },
  };

  return (
    <Chart options={options} series={[{ name: "Clics", data: rows.map((r) => r.clicks) }]} type="bar" height={300} />
  );
}
