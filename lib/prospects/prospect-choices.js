/**
 * Listes de choix prospects — module PUR, sans import serveur.
 * Importable côté client (dropdowns, badges) ET côté serveur.
 */

export const PROSPECT_STATUSES = Object.freeze([
  "nouveau",
  "contacte",
  "lecteur",
  "engage",
  "interesse",
  "demo_essai",
  "client",
  "perdu",
]);

export const PROSPECT_STATUS_LABELS = Object.freeze({
  nouveau: "Nouveau",
  contacte: "Contacté",
  lecteur: "Lecteur (a ouvert)",
  engage: "Engagé",
  interesse: "Intéressé",
  demo_essai: "En essai (RDV/atelier)",
  client: "Client",
  perdu: "Perdu",
});

// Une seule source de vérité pour les dropdowns "Source" (création,
// filtres). Les valeurs correspondent à l'enum Prisma ProspectSource.
export const PROSPECT_SOURCE_CHOICES = Object.freeze([
  { value: "google", label: "Google" },
  { value: "google_ads", label: "Google Ads" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "email", label: "E-mail / Newsletter" },
  { value: "campagne", label: "Campagne marketing" },
  { value: "salon_evenement", label: "Salon / Événement" },
  { value: "recommandation", label: "Recommandation" },
  { value: "site_web", label: "Site web" },
  { value: "reservation", label: "Réservation (RDV / atelier / formation)" },
  { value: "boutique", label: "Boutique" },
  { value: "atelier", label: "Atelier" },
  { value: "formation", label: "Formation" },
  { value: "contact", label: "Formulaire de contact" },
  { value: "autre", label: "Autre" },
]);

export function getSourceLabel(source) {
  return PROSPECT_SOURCE_CHOICES.find((c) => c.value === source)?.label ?? source ?? "";
}
