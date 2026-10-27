import { getTranslations } from "next-intl/server";

// Titre d'onglet traduit (MB-008) : la page de réservation d'atelier est un composant client, elle ne peut pas exporter de metadata elle-même.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("workshopBookingTitle"),
  };
}

export default function WorkshopBookingLayout({ children }) {
  return children;
}
