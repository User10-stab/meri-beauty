"use client";

import { useEffect } from "react";

/**
 * Locks page-level scrolling on desktop (lg+) while the staff profile page is
 * mounted. The two-column fixed layout only applies on lg screens; on mobile
 * the page scrolls naturally so this lock must not apply there.
 *
 * The shared public layout wraps pages in `<main className="min-h-screen">`
 * below the sticky navbar, which would otherwise leave ~1 navbar height of
 * body scroll on desktop. Locking html/body overflow keeps the desktop layout
 * exact (fixed hero + internally scrollable services) with no second scrollbar.
 * Restored on unmount so other pages are unaffected.
 */
export default function StaffViewportLock() {
  useEffect(() => {
    // Only lock on desktop breakpoint (matches Tailwind's lg: ≥ 1024px).
    const mq = window.matchMedia("(min-width: 1024px)");
    if (!mq.matches) return;

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
