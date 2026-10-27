import { getTranslations } from "next-intl/server";

// Titre d'onglet traduit (MB-008) pour /reservation et ses sous-pages (succès, reprise du paiement), qui sont des composants client sans metadata propre.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("reservationTitle"),
    description: t("reservationDescription"),
  };
}

export default function ReservationLayout({ children }) {
  return children;
}
