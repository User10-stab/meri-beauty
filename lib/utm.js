/**
 * UTM helpers — lecture des paramètres marketing d'URL.
 *
 * Utilisé côté client (UtmTracker) pour mémoriser la provenance d'un
 * visiteur, et réutilisable côté formulaire (inscription, contact,
 * réservation) pour Attribuer `source` + `utm` du futur prospect.
 */

export const UTM_KEYS = Object.freeze([
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
]);

const QUERY_TO_UTM = Object.freeze({
  utm_source: "utmSource",
  utm_medium: "utmMedium",
  utm_campaign: "utmCampaign",
  utm_content: "utmContent",
  utm_term: "utmTerm",
});

const STORAGE_KEY = "mb_last_utm";

/**
 * Lit les UTM depuis une query-string (défaut : URL courante du navigateur).
 * Retourne {} si rien — jamais d'exception (SSR-safe).
 */
export function getUtmParams(search = null) {
  try {
    const query = search ?? (typeof window !== "undefined" ? window.location.search : "");
    if (!query) return {};
    const params = new URLSearchParams(query.startsWith("?") ? query : `?${query}`);
    const out = {};
    for (const [queryKey, utmKey] of Object.entries(QUERY_TO_UTM)) {
      const value = params.get(queryKey);
      if (value && value.trim()) out[utmKey] = value.trim().slice(0, 100);
    }
    return out;
  } catch {
    return {};
  }
}

/** Mémorise les derniers UTM vus (sessionStorage, client uniquement). */
export function stashUtmParams(utm) {
  try {
    if (typeof window === "undefined" || !utm || Object.keys(utm).length === 0) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStashedUtm(), ...utm }));
  } catch {
    // stockage indisponible — silencieux, le tracking ne doit jamais casser la page.
  }
}

/** Relit les UTM mémorisés ({} si aucun). */
export function readStashedUtm() {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const key of UTM_KEYS) {
      if (typeof parsed[key] === "string" && parsed[key]) out[key] = parsed[key].slice(0, 100);
    }
    return out;
  } catch {
    return {};
  }
}
