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
  // fonts.gstatic.com: actual font files served by the Google Fonts stylesheet above.
  "font-src 'self' data: https://fonts.gstatic.com",
  // *.mondialrelay.com: the pickup-point widget's own point-search XHR calls.
  "connect-src 'self' https://*.mondialrelay.com",
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
    ],
  },
};

export default nextConfig;
