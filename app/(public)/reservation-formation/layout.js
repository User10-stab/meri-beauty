import { getTranslations } from "next-intl/server";

// Titre d'onglet traduit (MB-008) : la page d'inscription à une formation est un composant client, elle ne peut pas exporter de metadata elle-même.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("formationBookingTitle"),
  };
}

export default function FormationBookingLayout({ children }) {
  return children;
}
