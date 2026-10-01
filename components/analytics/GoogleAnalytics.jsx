"use client";

import Script from "next/script";
import { useEffect } from "react";

const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const TERMS_KEY = "meri-beauty:terms-accepted";

function grantAnalyticsConsent() {
  try {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag === "function") {
      window.gtag("consent", "update", { analytics_storage: "granted" });
    }
  } catch {
    // analytics ne casse jamais la page.
  }
}

/**
 * Charge GA4 (gtag.js) en mode consentement refusé par défaut (RGPD) :
 * aucun cookie analytics tant que le visiteur n'a pas cliqué "J'accepte"
 * sur le bandeau des CGV (SiteTermsNotice), qui déclenche
 * l'événement `meri-beauty:terms-accepted`.
 */
export function GoogleAnalytics() {
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TERMS_KEY) === "true") grantAnalyticsConsent();
    } catch {
      // localStorage indisponible — on reste en refusé.
    }
    window.addEventListener("meri-beauty:terms-accepted", grantAnalyticsConsent);
    return () => window.removeEventListener("meri-beauty:terms-accepted", grantAnalyticsConsent);
  }, []);

  if (!MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-consent-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied' });
          gtag('js', new Date());
          gtag('config', '${MEASUREMENT_ID}', { anonymize_ip: true });
        `}
      </Script>
    </>
  );
}
