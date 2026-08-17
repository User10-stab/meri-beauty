"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

const OPTIONS = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
  { value: "nl", label: "NL" },
];

export default function LocaleSwitcher({ className = "" }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();

  function changeLocale(event) {
    const nextLocale = event.target.value;
    if (nextLocale === locale) return;
    document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    // refresh() alone re-fetches and re-renders Server Components (root
    // layout included) with the new cookie value. A router.replace() fired
    // right after used to race it — replacing to the same URL could resolve
    // from an already-cached segment and win over the pending refresh,
    // which is why the language only ever updated after a hard reload.
    router.refresh();
  }

  return (
    <label className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={changeLocale}
        aria-label={t("language")}
        className="rounded-full border border-current/20 bg-transparent px-2 py-1 text-xs font-semibold tracking-wide outline-none"
      >
        {OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
