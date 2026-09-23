/**
 * Analytics — pont vers gtag / dataLayer.
 *
 * Aucune dépendance : si ni `gtag` ni `dataLayer` n'existent (bloqueur,
 * consentement refusé), chaque appel est un no-op silencieux.
 */

function pushToDataLayer(event) {
  try {
    if (typeof window === "undefined") return;
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
