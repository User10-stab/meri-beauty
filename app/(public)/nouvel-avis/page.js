import { NouvelAvisPageClient } from "./NouvelAvisPageClient";
import { getTranslations } from "next-intl/server";

// Titre traduit selon la langue choisie (cookie NEXT_LOCALE) — MB-008.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("newReviewTitle"),
    description: t("newReviewDescription"),
    robots: { index: false, follow: false },
  };
}

// Next 16 : searchParams est une Promise — sans await, le jeton était
// toujours perdu et la page affichait « Lien invalide ».
export default async function NouvelAvisPage({ searchParams }) {
  const params = await searchParams;
  const token = typeof params?.token === "string" ? params.token : null;
  return <NouvelAvisPageClient token={token} />;
}
