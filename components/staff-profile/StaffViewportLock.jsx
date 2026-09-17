"use client";

import { useEffect } from "react";

/**
 * Locks page-level scrolling while a staff profile page is mounted.
 * The shared public layout wraps this page in `<main className="min-h-screen">`
 * below the in-flow sticky navbar, which would otherwise leave ~1 navbar
 * height of body scroll. Locking html/body overflow keeps the staff layout
 * exactly as designed (fixed hero + internally scrollable services) with no
 * second scrollbar. Restored on unmount so other pages are unaffected.
 */
export default function StaffViewportLock() {
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  return null;
}
