import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { unsubscribeFromNewsletter } from "@/actions/newsletter/unsubscribe";

export async function generateMetadata() {
  const t = await getTranslations("newsletter");
  return {
    title: t("metadataTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function NewsletterUnsubscribePage({ searchParams }) {
  const params = await searchParams;
  const t = await getTranslations("newsletter");
  const userId = params?.u || "";
  const token = params?.t || "";

  const result = userId && token
    ? await unsubscribeFromNewsletter(userId, token)
    : { success: false, message: t("invalidLink") };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-20">
      <div className="max-w-md w-full text-center space-y-5 bg-white dark:bg-zinc-900 border border-[#2F3A2E]/10 dark:border-[#2F3A2E]/30 rounded-3xl shadow-xl p-10">
        <div
          className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${
            result.success ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
          }`}
        >
          {result.success ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
        </div>
        <h1 className="text-xl font-bold text-[#2F3A2E] dark:text-[#a8c4a2] font-serif">
          {result.success ? t("confirmedTitle") : t("invalidTitle")}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">{result.message}</p>
        <Link
          href="/"
          className="inline-flex justify-center py-3 px-6 text-sm font-semibold rounded-2xl text-white bg-[#2F3A2E] hover:bg-[#3d4d3c] transition-all"
        >
          {t("backHome")}
        </Link>
      </div>
    </div>
  );
}
