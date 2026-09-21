"use server";

import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";
import { isTokenEncryptionConfigured } from "@/lib/token-encryption";
import { isGoogleOAuthConfigured } from "@/lib/seo/google-oauth";
import {
  buildAuthorizedClient,
  formatDimensionRow,
  getActiveConnection,
  listSites,
  querySearchAnalytics,
  resolveDateRange,
  resolveSiteUrl,
  summarizeRows,
  listSitemaps,
} from "@/lib/seo/search-console";
import { cacheKey, cached } from "@/lib/seo/cache";
import { SEO_ERROR_CODES, failure, failureFromGoogleError } from "@/lib/seo/errors";

/**
 * Server actions de lecture Search Console.
 *
 * Toutes suivent la même forme que le reste du projet :
 * `{ success, data, message }`, avec en plus un `code` (voir
 * lib/seo/errors.js) pour que l'écran sache distinguer un problème
 * transitoire d'une connexion à refaire.
 *
 * Aucun appel n'atteint Google sans passer par le cache mémoire de
 * lib/seo/cache.js : les données Search Console ne sont consolidées que
 * toutes les quelques heures, donc rappeler Google à chaque rendu
 * consommerait du quota sans jamais rendre un chiffre plus frais.
 */

/**
 * Garde d'accès + préparation du client authentifié.
 *
 * Renvoie soit `{ auth, connection, siteUrl }`, soit `{ failure }` déjà
 * formaté en français.
 *
 * @returns {Promise<object>}
 */
async function prepare() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return {
      failure: { success: false, code: "ACCES_REFUSE", message: "Accès non autorisé.", data: null },
    };
  }

  if (!isGoogleOAuthConfigured() || !isTokenEncryptionConfigured()) {
    return { failure: failure(SEO_ERROR_CODES.NON_CONFIGURE) };
  }

  const connection = await getActiveConnection();
  if (!connection) {
    return { failure: failure(SEO_ERROR_CODES.NON_CONNECTE) };
  }

  try {
    const client = await buildAuthorizedClient(connection);
    return { auth: client, connection, siteUrl: resolveSiteUrl(connection) };
  } catch (error) {
    return { failure: failureFromGoogleError(error) };
  }
}

/**
 * Les propriétés Search Console auxquelles le compte connecté a accès.
 *
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function listSearchConsoleSites() {
  const context = await prepare();
  if (context.failure) return context.failure;

  try {
    const sites = await cached(
      cacheKey("sites", context.connection.id),
      () => listSites(context.auth)
    );
    return { success: true, data: sites };
  } catch (error) {
    console.error("[listSearchConsoleSites]", error);
    return failureFromGoogleError(error);
  }
}

/**
 * Les quatre indicateurs de tête sur une plage de dates.
 *
 * Interrogés SANS dimension : Google renvoie alors une ligne unique qui
 * porte déjà les totaux, CTR et position moyenne compris — c'est la seule
 * façon d'obtenir exactement les chiffres affichés dans Search Console.
 * Les recalculer depuis les lignes par requête donnerait des totaux
 * légèrement inférieurs, Google tronquant les longues traînes.
 *
 * @param {{ from?: string, to?: string }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: object | null }>}
 */
export async function getSearchConsoleOverview({ from, to } = {}) {
  const context = await prepare();
  if (context.failure) return context.failure;
  if (!context.siteUrl) return failure(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);

  const { startDate, endDate } = resolveDateRange({ from, to });

  try {
    const rows = await cached(
      cacheKey("overview", context.connection.id, context.siteUrl, startDate, endDate),
      () =>
        querySearchAnalytics(context.auth, {
          siteUrl: context.siteUrl,
          startDate,
          endDate,
          dimensions: [],
          rowLimit: 1,
        })
    );

    return {
      success: true,
      data: { ...summarizeRows(rows), startDate, endDate, siteUrl: context.siteUrl },
    };
  } catch (error) {
    console.error("[getSearchConsoleOverview]", error);
    return failureFromGoogleError(error);
  }
}

/**
 * Les requêtes qui amènent le plus de clics.
 *
 * @param {{ from?: string, to?: string, limit?: number }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getTopQueries({ from, to, limit = 25 } = {}) {
  return getTopByDimension("query", { from, to, limit });
}

/**
 * Les pages qui reçoivent le plus de clics.
 *
 * @param {{ from?: string, to?: string, limit?: number }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getTopPages({ from, to, limit = 25 } = {}) {
  return getTopByDimension("page", { from, to, limit });
}

/**
 * Corps commun aux deux tableaux : même requête, seule la dimension change.
 *
 * @param {"query" | "page"} dimension
 * @param {{ from?: string, to?: string, limit?: number }} params
 * @returns {Promise<object>}
 */
async function getTopByDimension(dimension, { from, to, limit }) {
  const context = await prepare();
  if (context.failure) return context.failure;
  if (!context.siteUrl) return failure(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);

  const { startDate, endDate } = resolveDateRange({ from, to });
  const rowLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);

  try {
    const rows = await cached(
      cacheKey("dimension", dimension, context.connection.id, context.siteUrl, startDate, endDate, rowLimit),
      () =>
        querySearchAnalytics(context.auth, {
          siteUrl: context.siteUrl,
          startDate,
          endDate,
          dimensions: [dimension],
          rowLimit,
        })
    );

    return { success: true, data: rows.map(formatDimensionRow) };
  } catch (error) {
    console.error(`[getTopByDimension:${dimension}]`, error);
    return failureFromGoogleError(error);
  }
}

/**
 * La série jour par jour, pour les courbes de tendance.
 *
 * `rowLimit` est volontairement large : une ligne par jour, et la période la
 * plus longue proposée par l'interface est de trois mois.
 *
 * @param {{ from?: string, to?: string }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getSeoTimeseries({ from, to } = {}) {
  const context = await prepare();
  if (context.failure) return context.failure;
  if (!context.siteUrl) return failure(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);

  const { startDate, endDate } = resolveDateRange({ from, to });

  try {
    const rows = await cached(
      cacheKey("timeseries", context.connection.id, context.siteUrl, startDate, endDate),
      () =>
        querySearchAnalytics(context.auth, {
          siteUrl: context.siteUrl,
          startDate,
          endDate,
          dimensions: ["date"],
          rowLimit: 200,
        })
    );

    // Google renvoie déjà les dates dans l'ordre, mais rien ne le garantit :
    // un tri explicite évite une courbe en dents de scie si cela changeait.
    return {
      success: true,
      data: rows.map(formatDimensionRow).sort((a, b) => a.key.localeCompare(b.key)),
    };
  } catch (error) {
    console.error("[getSeoTimeseries]", error);
    return failureFromGoogleError(error);
  }
}

/**
 * D'où viennent les recherches.
 *
 * @param {{ from?: string, to?: string, limit?: number }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getTopCountries({ from, to, limit = 8 } = {}) {
  return getTopByDimension("country", { from, to, limit });
}

/**
 * Répartition ordinateur / mobile / tablette.
 *
 * @param {{ from?: string, to?: string }} [params]
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getDeviceBreakdown({ from, to } = {}) {
  return getTopByDimension("device", { from, to, limit: 3 });
}

/**
 * L'état des sitemaps déclarés pour la propriété.
 *
 * @returns {Promise<{ success: boolean, code?: string, message?: string, data: Array<object> | null }>}
 */
export async function getSitemaps() {
  const context = await prepare();
  if (context.failure) return context.failure;
  if (!context.siteUrl) return failure(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);

  try {
    const sitemaps = await cached(
      cacheKey("sitemaps", context.connection.id, context.siteUrl),
      () => listSitemaps(context.auth, context.siteUrl)
    );

    return { success: true, data: sitemaps };
  } catch (error) {
    console.error("[getSitemaps]", error);
    return failureFromGoogleError(error);
  }
}
