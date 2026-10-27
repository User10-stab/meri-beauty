"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { COOKIE_CONSENT_EVENT, hasAnalyticsConsent } from "@/lib/analytics";

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/**
 * Charge GA4 (gtag.js) UNIQUEMENT après un « Accepter » explicite sur le
 * bandeau cookies (SiteTermsNotice, audit MB-003). Tant que le visiteur n'a
 * pas accepté — ou s'il a refusé — gtag.js n'est même pas téléchargé : aucun
 * cookie, aucune requête vers Google (pas de « pings » sans cookie du mode
 * consentement avancé).
 *
 * Retrait du consentement : setCookieConsent("denied") passe
 * analytics_storage à denied et efface les cookies _ga ; le script déjà
 * chargé reste en mémoire jusqu'au prochain chargement de page mais ne
 * pose plus de cookie et lib/analytics ne lui pousse plus rien.
 */
export function GoogleAnalytics() {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    setGranted(hasAnalyticsConsent());
    function onConsent(e) {
      if (e?.detail === "granted") setGranted(true);
    }
    window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
  }, []);

  if (!MEASUREMENT_ID || !granted) return null;

  return (
    <>
      <Script id="ga-consent-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
          gtag('js', new Date());
          gtag('config', '${MEASUREMENT_ID}', { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
        `}
      </Script>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
    </>
  );
}
