import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is needed for Next's hydration bootstrap and Tailwind/
  // Framer Motion inline styles — a nonce-based CSP would be stricter but
  // needs its own middleware plumbing; this is still a real improvement
  // over no CSP at all (blocks arbitrary external script/object/frame
  // injection, which was the actual gap). 'unsafe-eval' is added only in
  // dev — next dev's HMR/React Refresh runs modules through eval(), which
  // a production build never does, so it must not leak into prod.
  // code.jquery.com + widget.mondialrelay.com + unpkg.com (Leaflet, which the
  // widget itself pulls in for its map): the Mondial Relay pickup-point
  // picker widget on boutique checkout (components/boutique/MondialRelayPicker.jsx)
  // is a third-party jQuery plugin loaded from their CDN — it only activates
  // once NEXT_PUBLIC_MONDIAL_RELAY_BRAND_ID is set, but the CSP has to allow
  // it and everything it pulls in up front, or it fails silently the moment
  // that env var is configured.
  `script-src 'self' 'unsafe-inline' https://code.jquery.com https://widget.mondialrelay.com https://unpkg.com${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
  // fonts.googleapis.com: the widget also pulls its own Montserrat stylesheet.
  "style-src 'self' 'unsafe-inline' https://widget.mondialrelay.com https://unpkg.com https://fonts.googleapis.com",
  // static.wixstatic.com: product/service/gallery images imported from the
  // original Wix site are still hotlinked from there, not re-hosted locally.
  // *.mondialrelay.com + *.tile.openstreetmap.org + unpkg.com: map
  // tiles/markers for the pickup-point widget above (it moved to Leaflet,
  // loaded from unpkg, + OpenStreetMap tiles in v4).
  "img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net https://*.wixstatic.com https://*.mondialrelay.com https://*.tile.openstreetmap.org https://unpkg.com",
  // media-src has no fallback from img-src — without its own directive it
  // falls back to default-src 'self' instead, which blocks Instagram Reels
  // (<video> elements, served from the same *.fbcdn.net CDN as the photos).
  "media-src 'self' https://*.cdninstagram.com https://*.fbcdn.net",
  // fonts.gstatic.com: actual font files served by the Google Fonts stylesheet above.
  "font-src 'self' data: https://fonts.gstatic.com",
  // *.mondialrelay.com: the pickup-point widget's own point-search XHR calls.
  // *.pusher.com: Pusher notifications client — wss://ws-<cluster>.pusher.com
  // for the live socket, plus https://sockjs-<cluster>.pusher.com and
  // stats.pusher.com that the same client falls back to/reports to.
  // *.ingest.de.sentry.io: the Sentry SDK's client-side error/event beacon
  // (instrumentation-client.js) — without this, every browser-side error
  // report is itself silently blocked by this very CSP.
  "connect-src 'self' https://*.mondialrelay.com wss://*.pusher.com https://*.pusher.com https://*.ingest.de.sentry.io",
  // Google Maps embed on the Contact page.
  "frame-src 'self' https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Raise the multipart body size limit for API routes to 10 MB.
  // Default is 4 MB; a 8 MB raw file encodes to ~10.5 MB in multipart — this covers it.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // geolocation=(self): the Mondial Relay pickup-point widget's native
          // "use my location" search (components/boutique/MondialRelayPicker.jsx)
          // calls navigator.geolocation from our own page — geolocation=() would
          // silently block that button for every visitor.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          // Production-only: browsers cache HSTS per-origin, so sending this
          // over local http://localhost dev would be harmless (spec-ignored
          // on non-https), but scoping it to prod avoids any confusion during
          // local development entirely.
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        // Instagram / Facebook CDN — used for media_url and thumbnail_url
        protocol: "https",
        hostname: "**.cdninstagram.com",
      },
      {
        // Facebook CDN (some Instagram assets are served from here)
        protocol: "https",
        hostname: "**.fbcdn.net",
      },
      {
        // Local uploads served from /public/uploads
        protocol: "http",
        hostname: "localhost",
      },
      {
        // Legacy product/service/gallery images imported from the original
        // Wix site — still hotlinked from there, not re-hosted locally
        // (see lib/wixImport.js's WIX_MEDIA_BASE).
        protocol: "https",
        hostname: "**.wixstatic.com",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.js");

export default withSentryConfig(withNextIntl(nextConfig), {
  // Only used for source-map upload — silent no-op locally/without a token,
  // so this is safe to leave configured even before SENTRY_AUTH_TOKEN exists.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  // Routes the browser SDK's error/event beacon through our own domain
  // (/monitoring, proxied server-side to Sentry's real ingest URL) instead
  // of calling *.ingest.de.sentry.io directly. Ad-blockers/privacy extensions
  // (uBlock, Brave Shields, etc.) ship domain blocklists that target Sentry's
  // ingest hosts by name — that's ERR_BLOCKED_BY_CLIENT in the console, not a
  // CSP or app bug, and no connect-src change can fix it. A same-origin path
  // isn't on those lists, so this is Sentry's own documented workaround.
  tunnelRoute: "/monitoring",
});
