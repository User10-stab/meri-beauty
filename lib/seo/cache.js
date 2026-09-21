/**
 * Cache mémoire à durée de vie courte pour les réponses Search Console.
 *
 * Pourquoi un cache maison plutôt que le cache de données de Next : les
 * appels partent d'une server action déclenchée par l'utilisateur, pas d'un
 * rendu de page, et ils dépendent d'un jeton OAuth déchiffré côté serveur.
 * Un simple Map par processus suffit ici — l'application tourne sous un seul
 * processus pm2 sur le VPS — et garde la logique lisible et testable.
 *
 * Ce que ça évite concrètement : Google plafonne l'API Search Console à
 * environ 1 200 requêtes par minute et 25 000 par jour, et surtout ses
 * données ne bougent que toutes les quelques heures. Rappeler Google à
 * chaque rendu de l'écran ne donnerait jamais un chiffre plus frais, mais
 * consommerait du quota et rendrait la page lente.
 *
 * Le cache étant en mémoire, il disparaît à chaque redémarrage — c'est
 * voulu : aucune donnée Google ne survit au processus, et un redéploiement
 * repart toujours de chiffres frais.
 */

/** Durée de vie par défaut : 3 heures. */
export const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * Le cache est accroché à `globalThis` pour survivre aux rechargements à
 * chaud du serveur de développement, qui réévaluent les modules et
 * repartiraient sinon d'un cache vide à chaque sauvegarde de fichier.
 */
const globalForSeoCache = globalThis;
const store = globalForSeoCache.__seoCache ?? new Map();
globalForSeoCache.__seoCache = store;

/**
 * Récupère une valeur en cache, ou la calcule et la mémorise.
 *
 * L'entrée n'est écrite qu'en cas de succès : une erreur Google (quota,
 * permission) ne doit pas être figée pendant trois heures — l'utilisateur
 * doit pouvoir réessayer dès que le problème est réglé.
 *
 * @template T
 * @param {string} key - Clé de cache. Doit inclure tout ce qui change le
 *   résultat (propriété, plage de dates, dimension).
 * @param {() => Promise<T>} compute - Le calcul à mémoriser.
 * @param {{ ttlMs?: number, now?: number }} [options]
 * @returns {Promise<T>}
 */
export async function cached(key, compute, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const entry = store.get(key);

  if (entry && entry.expiresAt > now) {
    return entry.value;
  }

  const value = await compute();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/**
 * Vide le cache, entièrement ou pour un préfixe de clé.
 *
 * Appelé après une connexion ou une déconnexion : les chiffres mis en cache
 * appartiennent au compte Google précédent et ne doivent pas rester visibles
 * une fois celui-ci remplacé ou retiré.
 *
 * @param {string} [prefix] - Si fourni, seules les clés commençant par
 *   cette valeur sont supprimées.
 */
export function invalidateCache(prefix) {
  if (!prefix) {
    store.clear();
    return;
  }

  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/**
 * Construit une clé de cache stable à partir de composants.
 *
 * Les valeurs nulles sont normalisées pour qu'une même requête produise
 * toujours la même clé, quel que soit le chemin qui l'a construite.
 *
 * @param {...(string | number | null | undefined)} parts
 * @returns {string}
 */
export function cacheKey(...parts) {
  return parts.map((part) => (part === null || part === undefined ? "-" : String(part))).join("|");
}
