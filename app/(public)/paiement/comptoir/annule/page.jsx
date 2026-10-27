import { getTranslations } from "next-intl/server";

/**
 * Where the counter's « Carte QR » sends the client's phone if they back out
 * of the Stripe page. Nothing was charged and nothing was recorded — the
 * operator simply picks another method.
 *
 * Titre traduit selon la langue choisie (cookie NEXT_LOCALE) — MB-008.
 */
export async function generateMetadata() {
  const t = await getTranslations("pageMeta");
  return {
    title: t("counterPaymentCancelledTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function CounterPaymentCancelledPage() {
  const t = await getTranslations("counterPayment");
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-bold text-[#2f3a2e]">{t("cancelledTitle")}</h1>
      <p className="mt-3 text-sm text-gray-600">
        {t("cancelledBody")}
      </p>
    </main>
  );
}
