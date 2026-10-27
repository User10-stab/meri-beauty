/**
 * Analytics — pont vers gtag / dataLayer.
 *
 * Aucune dépendance : si ni `gtag` ni `dataLayer` n'existent (bloqueur,
 * consentement refusé), chaque appel est un no-op silencieux.
 *
 * Consentement cookies (audit MB-003) : rien n'est poussé vers GA tant que
 * le visiteur n'a pas cliqué « Accepter » sur le bandeau cookies
 * (components/website/SiteTermsNotice). Le choix est stocké sous une clé
 * versionnée : l'ancien « J'accepte » (clé meri-beauty:terms-accepted)
 * n'informait pas sur Google Analytics, il ne vaut donc PAS consentement et
 * tout le monde est redemandé.
 */

export const COOKIE_CONSENT_KEY = "meri-beauty:cookie-consent:v2";
const LEGACY_TERMS_KEY = "meri-beauty:terms-accepted";
/** Émis (detail: "granted" | "denied") à chaque choix sur le bandeau. */
export const COOKIE_CONSENT_EVENT = "meri-beauty:cookie-consent";
/** Émis par « Gérer les cookies » pour rouvrir le bandeau. */
export const OPEN_COOKIE_BANNER_EVENT = "meri-beauty:open-cookie-banner";

/** "granted" | "denied" | null (pas encore choisi / stockage indisponible). */
export function readCookieConsent() {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function hasAnalyticsConsent() {
  return readCookieConsent() === "granted";
}

// Supprime les cookies _ga / _ga_<ID> posés par GA4 (retrait du
// consentement). Ils sont posés sur le domaine racine (.meribeauty…) :
// on tente l'hôte courant puis chaque domaine parent.
function clearGaCookies() {
  try {
    const names = document.cookie
      .split(";")
      .map((c) => c.split("=")[0].trim())
      .filter((n) => n === "_ga" || n.startsWith("_ga_") || n === "_gid" || n === "_gat");
    const parts = window.location.hostname.split(".");
    const domains = [""];
    for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join(".")}`);
    for (const name of names) {
      for (const domain of domains) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
  } catch {
    // analytics ne casse jamais la page.
  }
}

/** Enregistre le choix du visiteur et met gtag à jour (si déjà chargé). */
export function setCookieConsent(choice) {
  const value = choice === "granted" ? "granted" : "denied";
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
    window.localStorage.removeItem(LEGACY_TERMS_KEY);
  } catch {
    // stockage indisponible — le choix vaut pour la page en cours seulement.
  }
  try {
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: value });
    }
    if (value === "denied") clearGaCookies();
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: value }));
  } catch {
    // analytics ne casse jamais la page.
  }
}

/** Rouvre le bandeau cookies (lien « Gérer les cookies »). */
export function openCookieBanner() {
  try {
    window.dispatchEvent(new Event(OPEN_COOKIE_BANNER_EVENT));
  } catch {
    // ignore
  }
}

function pushToDataLayer(event) {
  try {
    if (typeof window === "undefined") return;
    // Pas de consentement → aucun événement, même mis en file d'attente.
    if (!hasAnalyticsConsent()) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(event);
    if (typeof window.gtag === "function" && event?.event) {
      const { event: name, ...params } = event;
      window.gtag("event", name, params);
    }
  } catch {
    // analytics ne casse jamais la page.
  }
}

/** Page vue (appelé par <UtmTracker/> à chaque navigation). */
export function trackPageView(path, { utm = {} } = {}) {
  pushToDataLayer({ event: "page_view", page_path: path, ...utm });
}

/** Événement libre (clic CTA, inscription newsletter, réservation…). */
export function trackEvent(name, params = {}) {
  if (!name) return;
  pushToDataLayer({ event: name, ...params });
}

/** Clic sur un lien de campagne (complète le tracking serveur /track). */
export function trackCampaignClick(campaignId, url) {
  pushToDataLayer({ event: "campaign_click", campaign_id: campaignId ?? null, link_url: url ?? null });
}

// Clés déjà émises pendant le chargement de la page : une page de succès
// ne doit compter sa conversion qu'une seule fois (garde anti double
// effet React StrictMode + anti re-render).
const firedConversions = new Set();

/**
 * Conversion GA4 — à appeler UNE fois sur chaque écran de succès :
 *   appointment_booked — RDV / prestation réservé
 *   workshop_booked    — atelier réservé
 *   formation_booked   — formation réservée
 *   purchase           — commande boutique (nom imposé par GA pour le suivi
 *                        du chiffre d'affaires : value + currency + transaction_id)
 * Marque ensuite chacun comme « événement clé » dans GA4 (Admin >
 * Événements) : le total Conversions du dashboard vaut alors exactement
 * la somme de ces 4 actes.
 */
export function trackConversion(name, params = {}, dedupeKey = null) {
  if (!name) return;
  const key = dedupeKey ? `${name}:${dedupeKey}` : name;
  if (firedConversions.has(key)) return;
  firedConversions.add(key);
  pushToDataLayer({ event: name, ...params });
}
