"use client";

import { useTranslations } from "next-intl";
import { openCookieBanner } from "@/lib/analytics";

/**
 * Lien « Gérer les cookies » : rouvre le bandeau cookies (SiteTermsNotice)
 * pour que le visiteur puisse changer d'avis à tout moment (RGPD : retirer
 * son consentement doit être aussi simple que le donner). Rendu comme un
 * bouton texte : passer `className` pour l'aligner sur les liens voisins
 * (ex. footer, page politique de confidentialité).
 */
export default function CookieSettingsButton({ className = "" }) {
  const t = useTranslations("siteTermsNotice");
  return (
    <button type="button" onClick={openCookieBanner} className={className}>
      {t("manage")}
    </button>
  );
}
