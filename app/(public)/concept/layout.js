import { getTranslations } from "next-intl/server";

// Titre traduit selon la langue choisie (cookie NEXT_LOCALE) — MB-008.
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("conceptTitle"),
    description: t("conceptDescription"),
    alternates: { canonical: "/concept" },
  };
}

export default function ConceptLayout({ children }) {
  return children;
}
