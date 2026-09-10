"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function scrollToHash(hash, smooth = true) {
  if (!hash) return false;
  const id = hash.replace(/^#/, "");
  if (!id) return false;
  let decodedId;
  try {
    decodedId = decodeURIComponent(id);
  } catch {
    decodedId = id;
  }
  const el = document.getElementById(decodedId);
  if (!el) return false;
  const headerOffset = 72;
  const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
  window.scrollTo({ top: y, behavior: smooth ? "smooth" : "auto" });
  return true;
}

function scrollToHashWithRetry(hash, smooth = true) {
  if (!hash) return;
  // Try immediately
  if (scrollToHash(hash, smooth)) return;
  // Retry until element exists (homepage client sections hydrate after SSR)
  let attempts = 0;
  const maxAttempts = 25;
  const interval = setInterval(() => {
    attempts += 1;
    if (scrollToHash(hash, smooth) || attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 100);
  // Also watch DOM mutations for when #equipe is injected
  const observer = new MutationObserver(() => {
    if (scrollToHash(hash, smooth)) {
      observer.disconnect();
      clearInterval(interval);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 3000);
}

export default function HashScrollHandler() {
  const pathname = usePathname();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      // Initial load or navigation to a hash — retry until mounted
      // Use rAF to wait for React commit, then retry
      requestAnimationFrame(() => {
        scrollToHashWithRetry(hash, true);
      });
      // Fallback additional retries at 80ms/400ms for async sections like #booking
      const t1 = setTimeout(() => scrollToHashWithRetry(hash, true), 80);
      const t2 = setTimeout(() => scrollToHashWithRetry(hash, true), 400);
      const t3 = setTimeout(() => scrollToHashWithRetry(hash, true), 900);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [pathname]);

  useEffect(() => {
    const onHashChange = () => {
      scrollToHashWithRetry(window.location.hash, true);
    };
    window.addEventListener("hashchange", onHashChange);

    // Smooth same-page hash clicks (e.g. / -> /#equipe when already on homepage)
    const onClick = (e) => {
      const anchor = e.target.closest('a[href*="#"]');
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.includes("#")) return;
      try {
        const url = new URL(href, window.location.href);
        // Only handle same-page hash navigation here; cross-page is handled by pathname effect
        if (url.pathname !== window.location.pathname) return;
        if (!url.hash) return;
        e.preventDefault();
        // Keep hash in URL
        history.pushState(null, "", url.hash);
        scrollToHashWithRetry(url.hash, true);
      } catch {
        // ignore
      }
    };
    document.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return null;
}
