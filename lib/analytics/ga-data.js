import { JWT } from "google-auth-library";

/**
 * Google Analytics Data API (GA4) — lecture seule, côté serveur.
 *
 * Aucun package supplémentaire : authentification par compte de service
 * (JWT, google-auth-library déjà installée) + fetch direct sur
 * analyticsdata.googleapis.com/v1beta.
 *
 * Variables requises :
 *   GA_PROPERTY_ID                — ID numérique de la propriété (Admin > Détails du compte,
 *                                   PAS l'ID de mesure G-XXXX ni l'ID du flux).
 *   GA_SERVICE_ACCOUNT_EMAIL      — e-mail du compte de service (...@....iam.gserviceaccount.com).
 *   GA_SERVICE_ACCOUNT_PRIVATE_KEY — clé privée PEM (garder les \n tels quels dans le .env).
 *
 * Le compte de service doit être ajouté dans GA4 (Admin > Gestion des accès
 * à la propriété, rôle Lecteur) sinon l'API répond 403.
 */

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const API_BASE = "https://analyticsdata.googleapis.com/v1beta";

// Cache mémoire 15 min : l'API GA a des quotas, et les chiffres intraday
// n'ont pas besoin d'être recalculés à chaque affichage.
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

export function getGaDataConfig() {
  const propertyId = process.env.GA_PROPERTY_ID?.trim();
  const clientEmail = process.env.GA_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GA_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!propertyId || !clientEmail || !privateKey || !privateKey.includes("BEGIN PRIVATE KEY")) {
    return null;
  }
  return { propertyId, clientEmail, privateKey };
}

export function isGaDataConfigured() {
  return getGaDataConfig() !== null;
}

async function getAccessToken() {
  const cfg = getGaDataConfig();
  if (!cfg) {
    const error = new Error("GA_DATA_NOT_CONFIGURED");
    error.code = "GA_DATA_NOT_CONFIGURED";
    throw error;
  }
  const jwt = new JWT({ email: cfg.clientEmail, key: cfg.privateKey, scopes: [SCOPE] });
  const { token } = await jwt.getAccessToken();
  if (!token) throw Object.assign(new Error("GA_AUTH_FAILED"), { code: "GA_AUTH_FAILED" });
  return token;
}

async function runReport(body) {
  const cfg = getGaDataConfig();
  const key = JSON.stringify(body);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;

  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/properties/${cfg.propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: key,
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    const error = new Error(res.status === 403 ? "GA_ACCESS_DENIED" : `GA_DATA_API_${res.status}`);
    error.code = error.message;
    error.details = details.slice(0, 500);
    throw error;
  }

  const data = await res.json();
  cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
  return data;
}

function metric(row, i) {
  return Number(row?.metricValues?.[i]?.value ?? 0);
}

function dim(row, i) {
  return row?.dimensionValues?.[i]?.value ?? "";
}

/**
 * Vue d'ensemble 28 derniers jours : totaux (actifs, sessions, nouveaux,
 * revenants, pages vues, conversions) + courbe + top pages + canaux +
 * campagnes UTM + événements clés.
 * Les chiffres intraday de GA mettent quelques heures à se consolider.
 */
export async function getGaOverview() {
  const dateRanges = [{ startDate: "28daysAgo", endDate: "today" }];

  const [totals, series, pages, channels, campaigns, events] = await Promise.all([
    runReport({
      dateRanges,
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "newUsers" },
        { name: "screenPageViews" },
        { name: "conversions" },
      ],
    }),
    runReport({
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 50,
    }),
    runReport({
      dateRanges,
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 10,
    }),
    runReport({
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    runReport({
      dateRanges,
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    }),
    runReport({
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 10,
    }),
  ]);

  const totalRow = totals?.rows?.[0];
  const activeUsers = metric(totalRow, 0);
  const newUsers = metric(totalRow, 2);
  return {
    totals: {
      activeUsers,
      sessions: metric(totalRow, 1),
      newUsers,
      returningUsers: Math.max(0, activeUsers - newUsers),
      pageViews: metric(totalRow, 3),
      conversions: metric(totalRow, 4),
    },
    timeseries: (series?.rows ?? []).map((r) => ({
      date: dim(r, 0),
      sessions: metric(r, 0),
      users: metric(r, 1),
    })),
    topPages: (pages?.rows ?? []).map((r) => ({
      path: dim(r, 0),
      title: dim(r, 1) || dim(r, 0),
      views: metric(r, 0),
      users: metric(r, 1),
    })),
    channels: (channels?.rows ?? []).map((r) => ({
      channel: dim(r, 0) || "(non défini)",
      sessions: metric(r, 0),
      users: metric(r, 1),
    })),
    campaigns: (campaigns?.rows ?? []).map((r) => ({
      campaign: dim(r, 0) || "(non défini)",
      source: dim(r, 1) || "—",
      medium: dim(r, 2) || "—",
      sessions: metric(r, 0),
      users: metric(r, 1),
    })),
    events: (events?.rows ?? []).map((r) => ({
      name: dim(r, 0),
      count: metric(r, 0),
      users: metric(r, 1),
    })),
  };
}
