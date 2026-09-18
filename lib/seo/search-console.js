import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/token-encryption";
import { createOAuthClient, getConfiguredSiteUrl } from "@/lib/seo/google-oauth";
import { SEO_ERROR_CODES, buildError } from "@/lib/seo/errors";

/**
 * Couche d'accès à l'API Search Console.
 *
 * Elle porte trois responsabilités et rien d'autre :
 *   1. retrouver la connexion Google enregistrée et déchiffrer ses jetons ;
 *   2. renouveler l'access token quand il a expiré, de façon transparente ;
 *   3. appeler l'API et rendre des lignes déjà agrégées.
 *
 * Les server actions de actions/seo/ enveloppent ces fonctions dans la
 * forme `{ success, data, message }` et traduisent les erreurs — ici, on
 * laisse les erreurs remonter telles quelles pour que la traduction ait
 * accès au statut HTTP d'origine.
 */

/** Marge avant expiration : un jeton qui expire dans moins de 2 min est traité comme expiré. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

/**
 * Renouvellements en cours, par connexion.
 *
 * L'écran SEO lance quatre requêtes en parallèle. Si l'access token vient
 * d'expirer, les quatre constatent l'expiration en même temps et partent
 * chacune renouveler : quatre allers-retours chez Google, et quatre
 * écritures concurrentes sur la même ligne dont la dernière écrase les
 * autres. Partager la promesse en cours ramène cela à un seul
 * renouvellement, les trois autres attendant son résultat.
 */
const refreshesInFlight = new Map();

/** Nombre de jours affichés par défaut. */
export const DEFAULT_RANGE_DAYS = 28;

/**
 * Search Console ne sert pas les données du jour ni, la plupart du temps,
 * celles de la veille : elles sont consolidées avec deux à trois jours de
 * retard. Terminer la plage par défaut à aujourd'hui afficherait donc
 * systématiquement deux journées à zéro, que Marie lirait comme une chute
 * de trafic. La plage par défaut s'arrête trois jours en arrière.
 */
export const DATA_LAG_DAYS = 3;

/**
 * Formate une date au format attendu par l'API (AAAA-MM-JJ).
 * @param {Date} date
 * @returns {string}
 */
export function toApiDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Valide une date « AAAA-MM-JJ » reçue de l'interface.
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseApiDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return value;
}

/**
 * Résout la plage de dates à interroger.
 *
 * Toute entrée invalide retombe sur la plage par défaut plutôt que de lever
 * une erreur : un paramètre d'URL bricolé doit donner un écran utilisable,
 * pas un message d'erreur.
 *
 * @param {{ from?: unknown, to?: unknown, now?: Date }} [params]
 * @returns {{ startDate: string, endDate: string }}
 */
export function resolveDateRange({ from, to, now = new Date() } = {}) {
  const parsedFrom = parseApiDate(from);
  const parsedTo = parseApiDate(to);

  if (parsedFrom && parsedTo && parsedFrom <= parsedTo) {
    return { startDate: parsedFrom, endDate: parsedTo };
  }

  const end = new Date(now.getTime());
  end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS);

  const start = new Date(end.getTime());
  start.setUTCDate(start.getUTCDate() - (DEFAULT_RANGE_DAYS - 1));

  return { startDate: toApiDate(start), endDate: toApiDate(end) };
}

/**
 * Indique si l'access token doit être renouvelé avant l'appel.
 *
 * Une date d'expiration absente est traitée comme expirée : mieux vaut un
 * renouvellement inutile qu'un 401 qui ferait croire à une révocation.
 *
 * @param {Date | null | undefined} expiresAt
 * @param {number} [now]
 * @returns {boolean}
 */
export function needsRefresh(expiresAt, now = Date.now()) {
  if (!expiresAt) return true;
  const time = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(time)) return true;
  return time - REFRESH_MARGIN_MS <= now;
}

/**
 * La connexion Google active.
 *
 * Le salon n'a qu'une seule propriété Search Console : s'il existe
 * plusieurs lignes (deux administrateurs ayant chacun connecté leur compte),
 * la plus récemment mise à jour fait foi.
 *
 * @param {{ client?: typeof prisma }} [options]
 * @returns {Promise<object | null>}
 */
export async function getActiveConnection({ client = prisma } = {}) {
  return client.googleConnection.findFirst({ orderBy: { updatedAt: "desc" } });
}

/**
 * Enregistre les jetons renouvelés.
 *
 * Google ne renvoie un refresh token qu'au premier consentement : lors d'un
 * simple renouvellement, `tokens.refresh_token` est absent. Il ne faut donc
 * surtout pas écraser celui qu'on détient avec une valeur vide — ce serait
 * perdre l'accès pour de bon et forcer une reconnexion manuelle.
 *
 * @param {string} connectionId
 * @param {{ access_token?: string, refresh_token?: string, expiry_date?: number }} tokens
 * @param {{ client?: typeof prisma }} [options]
 * @returns {Promise<void>}
 */
export async function persistRefreshedTokens(connectionId, tokens, { client = prisma } = {}) {
  const data = {};

  if (tokens?.access_token) {
    data.accessToken = encryptSecret(tokens.access_token);
  }
  if (tokens?.refresh_token) {
    data.refreshToken = encryptSecret(tokens.refresh_token);
  }
  if (tokens?.expiry_date) {
    data.expiresAt = new Date(tokens.expiry_date);
  }

  if (Object.keys(data).length === 0) return;

  await client.googleConnection.update({ where: { id: connectionId }, data });
}

/**
 * Construit un client OAuth authentifié à partir de la connexion stockée,
 * en renouvelant l'access token si nécessaire.
 *
 * Le refresh token déchiffré ne quitte jamais cette fonction : il est posé
 * dans le client googleapis et n'est renvoyé à aucun appelant.
 *
 * @param {object} connection - La ligne GoogleConnection.
 * @param {{ client?: typeof prisma, now?: number, oauthClient?: object }} [options]
 * @returns {Promise<object>} Le client OAuth2 prêt à l'emploi.
 */
export async function buildAuthorizedClient(connection, { client = prisma, now = Date.now(), oauthClient } = {}) {
  const auth = oauthClient ?? createOAuthClient();

  let accessToken = null;
  let refreshToken = null;

  try {
    accessToken = connection.accessToken ? decryptSecret(connection.accessToken) : null;
    refreshToken = connection.refreshToken ? decryptSecret(connection.refreshToken) : null;
  } catch {
    // Jetons illisibles : clé de chiffrement changée/absente, ou ligne
    // altérée. Rien n'est récupérable sans un nouveau consentement.
    const error = new Error("Jetons Google illisibles.");
    error.seoCode = SEO_ERROR_CODES.RECONNEXION_REQUISE;
    throw error;
  }

  if (!refreshToken) {
    const error = new Error("Aucun refresh token enregistré.");
    error.seoCode = SEO_ERROR_CODES.RECONNEXION_REQUISE;
    throw error;
  }

  auth.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken,
    expiry_date: connection.expiresAt ? new Date(connection.expiresAt).getTime() : undefined,
  });

  if (needsRefresh(connection.expiresAt, now)) {
    // `refreshAccessToken` échoue en `invalid_grant` si l'accès a été
    // révoqué côté Google ; mapGoogleError traduit ce cas en
    // « reconnexion nécessaire ».
    const { credentials } = await auth.refreshAccessToken();
    await persistRefreshedTokens(connection.id, credentials, { client });
    auth.setCredentials(credentials);
  }

  return auth;
}

/**
 * Le client Search Console (API webmasters v3).
 * @param {object} auth
 * @returns {object}
 */
export function webmastersClient(auth) {
  return google.webmasters({ version: "v3", auth });
}

/**
 * Liste les propriétés auxquelles le compte connecté a accès.
 *
 * @param {object} auth
 * @returns {Promise<Array<{ siteUrl: string, permissionLevel: string }>>}
 */
export async function listSites(auth) {
  const response = await webmastersClient(auth).sites.list({});
  const entries = response?.data?.siteEntry ?? [];

  return entries.map((entry) => ({
    siteUrl: entry.siteUrl ?? "",
    permissionLevel: entry.permissionLevel ?? "",
  }));
}

/**
 * Exécute une requête Search Analytics.
 *
 * @param {object} auth
 * @param {{ siteUrl: string, startDate: string, endDate: string, dimensions?: string[], rowLimit?: number }} params
 * @returns {Promise<Array<object>>} Les lignes brutes renvoyées par Google.
 */
export async function querySearchAnalytics(auth, { siteUrl, startDate, endDate, dimensions = [], rowLimit = 25 }) {
  const response = await webmastersClient(auth).searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      // "web" seulement : Découverte et Actualités ont leurs propres
      // ordres de grandeur et fausseraient une lecture du référencement.
      type: "web",
    },
  });

  return response?.data?.rows ?? [];
}

/**
 * Agrège des lignes Search Analytics en quatre indicateurs.
 *
 * Le CTR et la position moyenne sont RECALCULÉS, jamais moyennés ligne à
 * ligne : la moyenne arithmétique des CTR de chaque requête donnerait le
 * même poids à une requête vue dix fois et à une vue dix mille fois. Le CTR
 * global est clics/impressions, et la position moyenne est pondérée par les
 * impressions — c'est ce que Google affiche lui-même.
 *
 * @param {Array<{ clicks?: number, impressions?: number, position?: number }>} rows
 * @returns {{ clicks: number, impressions: number, ctr: number, position: number }}
 */
export function summarizeRows(rows) {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;

  for (const row of rows ?? []) {
    const rowClicks = Number(row?.clicks) || 0;
    const rowImpressions = Number(row?.impressions) || 0;
    const rowPosition = Number(row?.position) || 0;

    clicks += rowClicks;
    impressions += rowImpressions;
    weightedPosition += rowPosition * rowImpressions;
  }

  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
  };
}

/**
 * Met en forme une ligne à dimension unique (requête ou page).
 *
 * @param {object} row
 * @returns {{ key: string, clicks: number, impressions: number, ctr: number, position: number }}
 */
export function formatDimensionRow(row) {
  return {
    key: row?.keys?.[0] ?? "—",
    clicks: Number(row?.clicks) || 0,
    impressions: Number(row?.impressions) || 0,
    ctr: Number(row?.ctr) || 0,
    position: Number(row?.position) || 0,
  };
}

/**
 * Résout la propriété à interroger.
 *
 * La valeur enregistrée lors de la connexion prime sur la variable
 * d'environnement : c'est celle que l'administrateur a effectivement
 * choisie. GOOGLE_SEARCH_CONSOLE_SITE ne sert que de valeur initiale.
 *
 * @param {object | null} connection
 * @returns {string | null}
 */
export function resolveSiteUrl(connection) {
  return connection?.siteUrl || getConfiguredSiteUrl();
}

/**
 * Construit l'erreur « propriété non choisie ».
 * @returns {{ code: string, message: string, status: number | null }}
 */
export function missingSiteError() {
  return buildError(SEO_ERROR_CODES.PROPRIETE_INTROUVABLE);
}

/**
 * Les sitemaps connus de Google pour la propriété, avec leur état de lecture.
 *
 * Utile pour répondre sans quitter le tableau de bord à « Google a-t-il bien
 * lu mon sitemap, et y a-t-il des erreurs ? ». `lastSubmitted` est la date de
 * soumission, `lastDownloaded` celle de la dernière lecture effective : les
 * deux diffèrent souvent de plusieurs jours, ce qui est normal.
 *
 * @param {object} auth
 * @param {string} siteUrl
 * @returns {Promise<Array<object>>}
 */
export async function listSitemaps(auth, siteUrl) {
  const response = await webmastersClient(auth).sitemaps.list({ siteUrl });
  const entries = response?.data?.sitemap ?? [];

  return entries.map((entry) => {
    // `contents` est un tableau par type (web, image, video…). Le total
    // d'URL découvertes est la somme de toutes les lignes.
    const submitted = (entry.contents ?? []).reduce(
      (total, content) => total + Number(content.submitted ?? 0),
      0
    );

    return {
      path: entry.path ?? "",
      lastSubmitted: entry.lastSubmitted ?? null,
      lastDownloaded: entry.lastDownloaded ?? null,
      isPending: Boolean(entry.isPending),
      errors: Number(entry.errors ?? 0),
      warnings: Number(entry.warnings ?? 0),
      submitted,
    };
  });
}

/**
 * L'hôte d'une propriété Search Console, quelle que soit sa forme.
 *
 * Google identifie une propriété de deux façons : "sc-domain:exemple.com"
 * pour une propriété de domaine, ou une URL complète
 * "https://exemple.com/" pour une propriété de préfixe. Les deux désignent
 * le même site, d'où cette normalisation avant toute comparaison.
 *
 * @param {string} siteUrl
 * @returns {string} L'hôte en minuscules, sans "www.", ou "" si illisible.
 */
export function siteUrlHost(siteUrl) {
  const value = String(siteUrl || "").trim();
  if (!value) return "";

  if (value.toLowerCase().startsWith("sc-domain:")) {
    return value.slice("sc-domain:".length).toLowerCase().replace(/^www\./, "");
  }

  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Une propriété de domaine ("sc-domain:…") plutôt qu'un préfixe d'URL. */
export function isDomainProperty(siteUrl) {
  return String(siteUrl || "").toLowerCase().startsWith("sc-domain:");
}

/**
 * La propriété de domaine qui couvre la même chose que celle choisie.
 *
 * Une propriété de préfixe ne mesure QUE l'hôte exact : si le site répond
 * aussi sur www, ou sur un sous-domaine, ce trafic n'apparaît nulle part. La
 * propriété de domaine équivalente, elle, couvre tout. Retourner celle-ci
 * permet de le signaler au lieu de laisser les chiffres être discrètement
 * incomplets.
 *
 * @param {string} selected
 * @param {Array<{ siteUrl: string }>} sites
 * @returns {string|null} La propriété de domaine équivalente, ou null.
 */
export function findBroaderDomainProperty(selected, sites) {
  if (!selected || isDomainProperty(selected)) return null;

  const host = siteUrlHost(selected);
  if (!host) return null;

  const match = (sites ?? []).find(
    (site) => isDomainProperty(site?.siteUrl) && siteUrlHost(site.siteUrl) === host
  );

  return match ? match.siteUrl : null;
}

/**
 * La propriété à interroger par défaut.
 *
 * Priorité : ce qui a déjà été choisi explicitement et reste accessible, puis
 * la propriété de domaine si elle existe — c'est la plus large, donc celle
 * qui ne perd pas de trafic — puis, à défaut, la première accessible.
 *
 * @param {Array<{ siteUrl: string }>} sites
 * @param {string} [configured]
 * @returns {string|null}
 */
export function pickPreferredSite(sites, configured) {
  const available = (sites ?? []).map((site) => site?.siteUrl).filter(Boolean);
  if (available.length === 0) return configured || null;

  if (configured && available.includes(configured)) return configured;

  // Le domaine configure d'abord, s'il correspond a une propriete de domaine.
  const host = siteUrlHost(configured);
  if (host) {
    const sameHost = available.find(
      (siteUrl) => isDomainProperty(siteUrl) && siteUrlHost(siteUrl) === host
    );
    if (sameHost) return sameHost;
  }

  // Sinon n'importe quelle propriete de domaine : elle couvre plus de trafic
  // qu'un prefixe d'URL, et c'est le seul critere qui vaille quand la valeur
  // configuree ne designe rien d'accessible.
  const anyDomain = available.find((siteUrl) => isDomainProperty(siteUrl));
  if (anyDomain) return anyDomain;

  return available[0];
}
