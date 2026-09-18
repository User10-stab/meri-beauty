/**
 * Mises en forme partagées entre l'écran SEO (composant serveur) et ses
 * composants clients. Aucun accès base ni jeton ici : ce module traverse la
 * frontière serveur/client sans risque.
 */

const NUMBER_FORMAT = new Intl.NumberFormat("fr-BE");
const PERCENT_FORMAT = new Intl.NumberFormat("fr-BE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const POSITION_FORMAT = new Intl.NumberFormat("fr-BE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/**
 * @param {number} value
 * @returns {string} Ex. « 1 234 ».
 */
export function formatInteger(value) {
  return NUMBER_FORMAT.format(Math.round(Number(value) || 0));
}

/**
 * @param {number} value - Un ratio (0,0432), pas un pourcentage (4,32).
 * @returns {string} Ex. « 4,3 % ».
 */
export function formatCtr(value) {
  return PERCENT_FORMAT.format(Number(value) || 0);
}

/**
 * La position moyenne dans les résultats de recherche.
 *
 * Zéro n'est pas une position : Google renvoie 0 quand il n'y a eu aucune
 * impression sur la plage. Afficher « 0,0 » se lirait comme un classement
 * parfait, soit l'inverse de la réalité — d'où le tiret.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatPosition(value) {
  const position = Number(value) || 0;
  if (position <= 0) return "—";
  return POSITION_FORMAT.format(position);
}

/**
 * Raccourcit une URL de page pour l'affichage : le domaine disparaît, seul
 * le chemin reste — c'est lui qui distingue les lignes du tableau.
 *
 * @param {string} value
 * @returns {string}
 */
export function formatPagePath(value) {
  if (typeof value !== "string" || !value) return "—";
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}` || "/";
  } catch {
    return value;
  }
}

/**
 * @param {string} isoDate - « AAAA-MM-JJ ».
 * @returns {string} Ex. « 18 septembre 2026 ».
 */
export function formatDateLabel(isoDate) {
  if (typeof isoDate !== "string") return "—";
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("fr-BE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
