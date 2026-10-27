/**
 * Fiches publiques de l'équipe : /staff/<id>.
 *
 * Les ids Staff sont des cuid Prisma (`@default(cuid())`) : 25 caractères,
 * minuscules et chiffres. Tout le reste — /staff/1 … /staff/5, les liens de
 * l'ancienne équipe de démonstration d'OurExperts, encore connus de Google —
 * ne peut correspondre à aucune fiche.
 *
 * Pourquoi un contrôle de format et pas seulement notFound() dans la page :
 * app/(public)/loading.js enveloppe la page dans un <Suspense>, donc la
 * réponse part en streaming avec un statut 200 avant que la requête Prisma
 * réponde ; notFound() n'ajoute alors qu'un <meta name="robots" noindex>
 * (docs Next 16, loading.js « Status Codes »). Pour un vrai 404 HTTP, le
 * contrôle doit avoir lieu avant le rendu — dans proxy.js, sans base de
 * données (le proxy tourne à chaque requête).
 *
 * Marge volontaire (20 à 32 caractères) : un cuid2 ou un id importé ne doit
 * pas tomber en 404 par excès de zèle ; un id bien formé mais inconnu ou
 * désactivé reste traité par la page (notFound() + noindex).
 */
const STAFF_ID_PATTERN = /^[a-z0-9]{20,32}$/;

export function isWellFormedStaffId(staffId) {
  return typeof staffId === "string" && STAFF_ID_PATTERN.test(staffId);
}

/** true pour /staff/<id> dont l'id ne peut pas être celui d'une fiche. */
export function isMalformedStaffProfilePath(pathname) {
  const match = /^\/staff\/([^/]+)\/?$/.exec(pathname ?? "");
  if (!match) return false;
  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return true;
  }
  return !isWellFormedStaffId(id);
}
