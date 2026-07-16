/** @type {import('next').NextConfig} */
const nextConfig = {
  // Raise the multipart body size limit for API routes to 10 MB.
  // Default is 4 MB; a 8 MB raw file encodes to ~10.5 MB in multipart — this covers it.
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
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
