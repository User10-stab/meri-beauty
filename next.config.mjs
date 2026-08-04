const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is needed for Next's hydration bootstrap and Tailwind/
  // Framer Motion inline styles — a nonce-based CSP would be stricter but
  // needs its own middleware plumbing; this is still a real improvement
  // over no CSP at all (blocks arbitrary external script/object/frame
  // injection, which was the actual gap). 'unsafe-eval' is added only in
  // dev — next dev's HMR/React Refresh runs modules through eval(), which
  // a production build never does, so it must not leak into prod.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // static.wixstatic.com: product/service/gallery images imported from the
  // original Wix site are still hotlinked from there, not re-hosted locally.
  "img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net https://*.wixstatic.com",
  "font-src 'self' data:",
  "connect-src 'self'",
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
