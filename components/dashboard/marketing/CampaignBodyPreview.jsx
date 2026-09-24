"use client";

import { renderCampaignContent } from "@/lib/campaigns/render-content";

/**
 * Aperçu du corps d'e-mail tel qu'il part : bonjour auto + image +
 * contenu + bouton CTA. Utilisé par la modale "Aperçu" de la liste ET
 * par l'étape 3 du wizard (même rendu, une seule source de vérité).
 */
export function CampaignBodyPreview({ campaign }) {
  if (!campaign) return null;
  return (
    <div className="rounded-lg bg-gray-50 p-4 text-sm dark:bg-dark-2">
      <p className="mb-1 text-gray-700 dark:text-dark-6">
        Bonjour {"{entreprise ou nom du destinataire}"},
      </p>
      <p className="mb-2 text-[11px] italic text-gray-400">
        (personnalisé à l'envoi : entreprise, sinon prénom + nom)
      </p>
      {campaign.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={campaign.imageUrl} alt="" className="mb-2 max-h-48 rounded-xl" />
      )}
      <div
        className="text-gray-700 dark:text-dark-6"
        dangerouslySetInnerHTML={{ __html: renderCampaignContent(campaign.content) || "<p>(contenu vide)</p>" }}
      />
      {campaign.ctaUrl && (
        <p className="mt-4 text-center">
          <span className="inline-block rounded-full bg-[#2f3a2e] px-6 py-2.5 font-semibold text-white">
            {campaign.ctaText || "Découvrir"}
          </span>
        </p>
      )}
    </div>
  );
}
