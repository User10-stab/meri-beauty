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
 */

const INSTAGRAM_API_BASE = "https://graph.instagram.com";

const MEDIA_FIELDS =
  "id,media_type,media_url,thumbnail_url,caption,timestamp,permalink,like_count,comments_count";

const PROFILE_FIELDS = "id,name,username,profile_picture_url,biography,followers_count";

// ─── helpers ────────────────────────────────────────────────────────────────

function hasToken() {
  const t = process.env.INSTA_API;
  return t && t !== "YOUR_INSTAGRAM_ACCESS_TOKEN_HERE";
}

async function igFetch(path, params = {}) {
  const url = new URL(`${INSTAGRAM_API_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", process.env.INSTA_API);

  const res = await fetch(url.toString(), { next: { revalidate: 1800 } });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[instagram] ${path} → HTTP ${res.status}:`, body);
    return null;
  }
  return res.json();
  
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

  const json = await igFetch("/me/media", { fields: MEDIA_FIELDS });
  if (!json?.data || !Array.isArray(json.data)) {
    console.error("[instagram] Unexpected media response:", json);
    return [];
  }
  console.log("instagram Fetched", json.data);

  return json.data.map((item) => ({
    id: item.id,
    media_type: item.media_type,          // "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
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
