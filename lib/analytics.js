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
