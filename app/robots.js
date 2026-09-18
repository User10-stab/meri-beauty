import { getAppBaseUrl } from "@/lib/site-url";

const SITE_URL = getAppBaseUrl();

// Same paths kept out of every crawler below — private/transactional pages
// that have nothing to index (auth, cart/checkout, account, payment and
// success screens, one-click e-mail actions).
//
// Entries are prefix matches, so "/reservation-atelier" also covers its
// /succes child, and "/reservation" is deliberately NOT listed: that one is
// the public booking landing page and belongs in the sitemap.
const DISALLOW = [
  "/api/",
  "/dashboard/",
  "/acces",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/mon-compte",
  "/profile",
  "/mes-reservations",
  "/boutique/cart",
  "/boutique/checkout",
  "/boutique/order/",
  // Query-param driven booking funnels (?activityId=, ?formationId=). The
  // bare URL renders an empty client shell with no content to index, and the
  // parameterised ones are mid-checkout steps.
  "/reservation-atelier",
  "/reservation-formation",
  "/reservation/success",
  "/reservation/retry-payment",
  // Pay-this-appointment links sent by e-mail.
  "/appointment/",
  // Unsubscribe confirmation reached from a newsletter footer link.
  "/newsletter/",
];

// AI assistants and answer engines that read robots.txt before crawling or
// citing a page (ChatGPT, Claude, Perplexity, Google's AI Overviews/Gemini,
// Common Crawl — which many other models train on). A bare `userAgent: "*"`
// rule already allows all of these by default; listing them explicitly is a
// deliberate "yes, on purpose" rather than an accident of the wildcard, and
// gives each one a place to be turned off individually later if ever needed.
const AI_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
