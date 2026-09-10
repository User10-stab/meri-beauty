"use client";

// Custom next/image loader. Keeps sharp / the /_next/image optimizer out of
// production entirely: sharp runs in-process and OOM-kills the web server under
// memory pressure on the shared OVH VPS (the optimized-image cache has a 4h TTL,
// so blanks reappear whenever a batch of entries expires under load).
//
//  - Bare Wix media URLs  -> rewritten through Wix's own CDN transform, so the
//    resize runs on static.wixstatic.com, not on our box. enc_auto lets the
//    browser negotiate AVIF/WebP via its Accept header. Every product/staff
//    image container is aspect-square + object-cover, so a square fill crop
//    (h == w) is always correct.
//  - Everything else (/uploads/*, /Images/*, Instagram/FB CDN, data: URLs)
//    -> returned unchanged. /uploads/* is served directly by nginx and is
//    already optimized client-side at upload time (lib/imageOptimization.js:
//    max 2500px, WebP q0.88); /Images/* is served from /public.

const WIX_BARE_MEDIA = /^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)$/;

export default function imageLoader({ src, width, quality }) {
  if (typeof src !== "string") return src;

  const wix = WIX_BARE_MEDIA.exec(src);
  if (wix) {
    const id = wix[1];
    const w = Math.round(width);
    // Wix accepts q_1..q_100; default ~82 to match the client-side WebP band.
    const q = Math.min(90, Math.max(1, Math.round(quality || 82)));
    return `https://static.wixstatic.com/media/${id}/v1/fill/w_${w},h_${w},al_c,q_${q},enc_auto/${id}`;
  }

  // data:, blob:, /uploads/*, /Images/*, *.cdninstagram.com, *.fbcdn.net, and
  // any already-transformed Wix URL: hand back untouched.
  return src;
}
