
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
 
export default nextConfig;


