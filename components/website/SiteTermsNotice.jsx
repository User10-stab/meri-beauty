"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  OPEN_COOKIE_BANNER_EVENT,
  readCookieConsent,
  setCookieConsent,
} from "@/lib/analytics";

/** Bandeau de consentement cookies (audit MB-003).
 *
 * Remplace l'ancien bandeau « En poursuivant votre navigation… / J'accepte »
 * qui activait Google Analytics sans le dire. Désormais :
 *  - le texte nomme explicitement Google Analytics (mesure d'audience) ;
 *  - « Accepter » et « Refuser » ont le même poids visuel ;
 *  - GA n'est chargé qu'après « Accepter » (components/analytics/GoogleAnalytics) ;
 *  - « Refuser » est mémorisé : le bandeau ne revient pas ;
 *  - « Gérer les cookies » (components/analytics/CookieSettingsButton) le
 *    rouvre pour changer d'avis.
 * Le choix vit dans localStorage sous une clé versionnée (lib/analytics) :
 * l'ancien « J'accepte » n'est pas repris, chacun est redemandé une fois. */
export default function SiteTermsNotice() {
  const pathname = usePathname();
  const t = useTranslations("siteTermsNotice");
  const [visible, setVisible] = useState(false);
  // Ouvert à la demande via « Gérer les cookies » : s'affiche aussi sur
  // les pages staff, où le bandeau automatique est masqué.
  const [openedManually, setOpenedManually] = useState(false);

  useEffect(() => {
    if (readCookieConsent() === null) setVisible(true);
    function onOpen() {
      setOpenedManually(true);
      setVisible(true);
    }
    window.addEventListener(OPEN_COOKIE_BANNER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_COOKIE_BANNER_EVENT, onOpen);
  }, []);

  function choose(choice) {
    setCookieConsent(choice);
    setVisible(false);
    setOpenedManually(false);
  }

  if (!visible) return null;

  // Keep staff profile pages to their standalone two-section layout
  // (sans choix, GA reste simplement non chargé).
  if (pathname?.startsWith("/staff/") && !openedManually) return null;

  const linkClass = "underline text-gold hover:text-gold/80";
  // Même gabarit pour les deux boutons : refuser doit être aussi simple
  // et visible qu'accepter.
  const buttonClass =
    "min-w-[120px] shrink-0 rounded-full border border-gold bg-gold px-6 py-2.5 text-sm font-semibold text-primary transition hover:bg-gold/90";

  return (
    <div
      role="region"
      aria-label={t("ariaLabel")}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gold-soft bg-primary px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] sm:px-6"
    >
      <div className="mx-auto flex max-w-[1400px] flex-col items-center gap-3 md:flex-row md:justify-between md:gap-6">
        <div className="text-center text-sm leading-relaxed text-cream/85 md:text-left">
          <p className="font-semibold text-cream">{t("title")}</p>
          <p className="mt-1">{t("body")}</p>
          <p className="mt-1 text-xs text-cream/70">
            {t.rich("learnMore", {
              privacy: (chunks) => (
                <Link href="/politique-de-confidentialite" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {chunks}
                </Link>
              ),
              terms: (chunks) => (
                <Link href="/cgv" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {chunks}
                </Link>
              ),
              legal: (chunks) => (
                <Link href="/mentions-legales" target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className={buttonClass}
          >
            {t("refuse")}
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className={buttonClass}
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
