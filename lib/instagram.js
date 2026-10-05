/**
 * Fetches posts + profile from the Instagram Graph API.
 *
 * Requires INSTA_API env var — a valid long-lived access token issued for a
 * Business or Creator account connected to a Facebook Page.
 *
 * Notes:
 *  - like_count / comments_count require the instagram_manage_insights permission
 *    (Business/Creator accounts only). Basic Display API tokens return 0.
 *  - profile_picture_url requires the instagram_business_basic permission.
 *  - VIDEO posts return media_url (the .mp4) + thumbnail_url (the cover image).
 *  - These functions are server-only (no "use client").
 *  - Tokens are refreshed automatically using the stored refresh token before
 *    expiration. A background job (run every ~7 days) calls
 *    /refresh_access_token to get a new long-lived token.
 */

const INSTAGRAM_API_BASE = "https://graph.instagram.com";

const MEDIA_FIELDS =
  "id,media_type,media_url,thumbnail_url,caption,timestamp,permalink,like_count,comments_count";

const PROFILE_FIELDS = "id,name,username,profile_picture_url,biography,followers_count";

// The homepage calls fetchInstagramPosts/fetchInstagramProfile directly in a
// Server Component with no dynamic APIs, so Next statically renders it —
// including at `next build` time. A hung or erroring Instagram call must
// never hang or fail that build; it must always resolve, even to "no data".
const FETCH_TIMEOUT_MS = 8000;

// ─── helpers ────────────────────────────────────────────────────────────────

async function hasToken({ useRefresh = true } = {}) {
  const dbToken = globalThis.__meriInstagramToken;
  if (!dbToken) return false;
  if (useRefresh && dbToken.isExpired) {
    // Token expired — try refreshing it before giving up
    await refreshInstagramToken();
    if (dbToken.isExpired) return false;
  }
  return true;
}

async function refreshInstagramToken() {
  const refreshToken = globalThis.__meriInstagramRefreshToken;
  if (!refreshToken) {
    console.warn("[instagram] No refresh token available — cannot auto-renew");
    return false;
  }

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", refreshToken);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text();
      console.error("[instagram] Token refresh failed HTTP", res.status, ":", body);
      return false;
    }
    const data = await res.json();

    // Instagram returns: access_token, token_type, expires_in (seconds)
    if (!data.access_token) {
      console.error("[instagram] Token refresh response missing access_token:", data);
      return false;
    }

    // Calculate new expiry (now + expires_in - small buffer)
    const newExpiresAt = Date.now() + (data.expires_in - 300) * 1000; // 5-min buffer

    // Store new tokens in memory + persist to DB if prisma available
    globalThis.__meriInstagramToken = {
      accessToken: data.access_token,
      // Instagram long-lived tokens typically last ~60 days (5184000s),
      // but we store the exact expiry from the response
      isExpired: false,
    };

    if (globalThis.__meriPrisma) {
      await globalThis.__meriPrisma.salon.update({
        where: { id: "main-salon" },
        data: {
          instagramAccessToken: data.access_token,
          instagramRefreshToken: data.refresh_token || refreshToken,
          instagramTokenExpiresAt: newExpiresAt,
        },
      });
    }

    // Also update in-memory refresh token if provided
    if (data.refresh_token) {
      globalThis.__meriInstagramRefreshToken = data.refresh_token;
    }

    console.log("[instagram] Token refreshed successfully, expires at", new Date(newExpiresAt));
    return true;
  } catch (err) {
    console.error("[instagram] Token refresh failed (network error or timeout):", err.message);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── public exports ──────────────────────────────────────────────────────────

/**
 * Returns the latest posts shaped for InstagramLifestyle.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function fetchInstagramPosts() {
  if (!hasToken()) {
    console.warn("[instagram] INSTA_API is not set. Returning empty posts.");
    return [];
  }

  // Refresh token proactively if within 7 days of expiration
  const expiresAt = globalThis.__meriInstagramToken?.isExpired
    ? null
    : globalThis.__meriInstagramToken?.expiresAt;
  const now = Date.now();
  if (expiresAt && now + 7 * 24 * 60 * 60 * 1000 >= expiresAt) {
    // Within 7 days of expiry — refresh now
    await refreshInstagramToken();
  }

  const json = await igFetch("/me/media", { fields: MEDIA_FIELDS });
  if (!json?.data || !Array.isArray(json.data)) {
    console.error("[instagram] Unexpected media response:", json);
    return [];
  }
  // console.log("instagram Fetched", json.data);

  return json.data.map((item) => ({
    id: item.id,
    media_type: item.media_type, // "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
    media_url: item.media_url ?? null,
    thumbnail_url: item.thumbnail_url ?? item.media_url ?? null,
    caption: item.caption ?? "",
    timestamp: item.timestamp,
    permalink: item.permalink,
    likes: item.like_count ?? 0,
    comments: item.comments_count ?? 0,
  }));
}

/**
 * Returns the authenticated user's profile (name, username, avatar).
 * @returns {Promise<{name:string, username:string, avatar:string|null, bio:string, followers:number}|null>}
 */
export async function fetchInstagramProfile() {
  if (!hasToken()) return null;

  // Refresh token proactively if within 7 days of expiration
  const expiresAt = globalThis.__meriInstagramToken?.isExpired
    ? null
    : globalThis.__meriInstagramToken?.expiresAt;
  const now = Date.now();
  if (expiresAt && now + 7 * 24 * 60 * 60 * 1000 >= expiresAt) {
    // Within 7 days of expiry — refresh now
    await refreshInstagramToken();
  }

  const json = await igFetch("/me", { fields: PROFILE_FIELDS });
  if (!json?.id) {
    console.error("[instagram] Unexpected profile response:", json);
    return null;
  }

  return {
    name: json.name ?? json.username ?? "meribeauty.studio",
    username: json.username ?? "meribeauty.studio",
    avatar: json.profile_picture_url ?? null,
    bio: json.biography ?? "",
    followers: json.followers_count ?? 0,
  };
}

// ─── token management ────────────────────────────────────────────────────────

/**
 * Sets the Instagram tokens in memory and persists them to the DB.
 * Called initially when the app starts or after a successful token refresh.
 * @param {Object} options
 * @param {string} options.accessToken - The Instagram access token
 * @param {string} options.refreshToken - The Instagram refresh token
 * @param {Date|number} options.expiresAt - Expiry timestamp (ms since epoch)
 */
export async function setInstagramTokens({ accessToken, refreshToken, expiresAt }) {
  const expiresAtMs =
    typeof expiresAt === "number" ? expiresAt : expiresAt ? new Date(expiresAt).getTime() : 0;

  globalThis.__meriInstagramToken = {
    accessToken,
    isExpired: false,
    expiresAt: expiresAtMs,
  };

  globalThis.__meriInstagramRefreshToken = refreshToken;

  // Persist to DB if prisma is available
  if (globalThis.__meriPrisma) {
    await globalThis.__meriPrisma.salon.update({
      where: { id: "main-salon" },
      data: {
        instagramAccessToken: accessToken,
        instagramRefreshToken: refreshToken,
        instagramTokenExpiresAt: expiresAtMs,
      },
    });
  }

  console.log("[instagram] Tokens set, expires at", new Date(expiresAtMs));
}

// ─── internal fetch ──────────────────────────────────────────────────────────

async function igFetch(path, params = {}) {
  const url = new URL(`${INSTAGRAM_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", process.env.INSTA_API || "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 1800 }, signal: controller.signal });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[instagram] ${path} → HTTP ${res.status}:`, body);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[instagram] ${path} failed (network error or timeout):`, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── initialization ─────────────────────────────────────────────────────────

/**
 * Initialize Instagram tokens from the DB or env on startup.
 * Must be called once when the app starts (e.g., in a server-side init file).
 * @param {Object} init - { accessToken, refreshToken, expiresAt } from DB or env
 */
export async function initInstagramTokens({ accessToken, refreshToken, expiresAt }) {
  // Try to load from DB first, fallback to env
  let token = accessToken || process.env.INSTA_API;
  let rToken = refreshToken;
  let exp = expiresAt;

  // Fallback to env if not provided
  if (!token) token = process.env.INSTA_API;
  if (!rToken && token && token !== "YOUR_INSTAGRAM_ACCESS_TOKEN_HERE") {
    // If we have an env token but no refresh token, we can't auto-refresh yet
    rToken = null;
  }

  await setInstagramTokens({ accessToken: token, refreshToken: rToken, expiresAt: exp });
}

/**
 * Marks the current token as expired and triggers a refresh on next use.
 * Useful if the app detects the token is invalid.
 */
export function invalidateInstagramToken() {
  globalThis.__meriInstagramToken = { isExpired: true, accessToken: null, expiresAt: 0 };
  globalThis.__meriInstagramRefreshToken = null;
}