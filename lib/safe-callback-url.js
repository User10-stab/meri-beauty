const LOCAL_ORIGIN = "http://local.invalid";

/**
 * Converts an auth callback into a same-site path before it is used in
 * `window.location` or threaded into another auth link.
 */
export function normalizeCallbackUrl(rawCallbackUrl, fallback = "/", currentOrigin = null) {
  const raw = String(rawCallbackUrl ?? "").trim();
  if (!raw || /[\u0000-\u001F\u007F\\]/.test(raw)) return fallback;

  try {
    if (raw.startsWith("/")) {
      if (raw.startsWith("//")) return fallback;
      const url = new URL(raw, LOCAL_ORIGIN);
      const path = `${url.pathname}${url.search}${url.hash}`;
      return path.startsWith("//") ? fallback : path;
    }

    if (!currentOrigin) return fallback;

    const url = new URL(raw);
    if (url.origin !== currentOrigin) return fallback;

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
