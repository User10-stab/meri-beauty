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

export default function NouvelAvisPage({ searchParams }) {
  const token = searchParams?.token ?? null;
  return <NouvelAvisPageClient token={token} />;
}
