"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_KEY = "meri-beauty:terms-accepted";

/** Bottom banner shown to a visitor the first time they load the site,
 * asking them to acknowledge the CGV / mentions légales / politique de
 * confidentialité before continuing to browse. Purely an acknowledgment
 * of the legal pages (not a cookie/tracking-consent banner — the site
 * doesn't use non-essential cookies, see the Politique de confidentialité).
 * Persisted in localStorage so it only ever shows once per browser. */
export default function SiteTermsNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "true") {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (private mode/blocked) — skip the notice
      // rather than show it on every single page load.
    }
  }, []);

  function handleAccept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore — worst case the notice reappears next visit
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Conditions d'utilisation du site"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gold-soft bg-primary px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] sm:px-6"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-center text-sm leading-relaxed text-cream/85 sm:text-left">
          En poursuivant votre navigation sur ce site, vous acceptez nos{" "}
          <Link href="/cgv" className="underline text-gold hover:text-gold/80">
            Conditions Générales de Vente
          </Link>
          , nos{" "}
          <Link href="/mentions-legales" className="underline text-gold hover:text-gold/80">
            Mentions légales
          </Link>{" "}
          et notre{" "}
          <Link href="/politique-de-confidentialite" className="underline text-gold hover:text-gold/80">
            Politique de confidentialité
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={handleAccept}
          className="shrink-0 rounded-full bg-gold px-6 py-2.5 text-sm font-semibold text-primary transition hover:bg-gold/90"
        >
          J&apos;accepte
        </button>
      </div>
    </div>
  );
}
