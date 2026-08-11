const DEFAULT_DEV_URL = "http://localhost:3000";

// Matches the fallback every SEO file (sitemap.js, robots.js, layout.js,
// (public)/layout.js) hardcoded independently before they were centralized
// here — keeping it means wiring them to this helper can't ever weaken the
// existing fail-safe (no env var set in prod still resolves to a real,
// crawlable domain instead of an empty string).
const PRODUCTION_DEFAULT_URL = "https://meribeautystudio.com";

function normalizeBaseUrl(value) {
  if (!value) return null;

  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function getAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL
    || process.env.AUTH_URL
    || process.env.NEXTAUTH_URL
    || process.env.NEXTAUTH_URL_INTERNAL
    || process.env.VERCEL_URL;

  const normalized = normalizeBaseUrl(configured);
  if (normalized) {
    return normalized;
  }

  if (process.env.NODE_ENV === "development") {
    return DEFAULT_DEV_URL;
  }

  return PRODUCTION_DEFAULT_URL;
}

export function getAbsoluteUrl(path = "/") {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) {
    return path.startsWith("/") ? path : `/${path}`;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function getMetadataBase() {
  const baseUrl = getAppBaseUrl();
  return baseUrl ? new URL(baseUrl) : undefined;
}
