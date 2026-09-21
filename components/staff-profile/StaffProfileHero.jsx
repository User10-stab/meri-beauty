"use client";

import Image from "next/image";
import { Calendar, Heart, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { LeftBotanical } from "@/components/botanical-decorations";

const LANGUAGE_LABELS = {
  FRENCH: "Français", ENGLISH: "English", ARABIC: "العربية", SPANISH: "Español",
  DUTCH: "Nederlands", GERMAN: "Deutsch", PORTUGUESE: "Português", ITALIAN: "Italiano",
};

export default function StaffProfileHero({ name, firstName, bio, yearsOfExperience, languages, workingHours, image, socialLinks, categories }) {
  const t = useTranslations("staffProfile");
  const openDays = (workingHours || []).filter((hour) => !hour.isClosed);
  const shortBio = bio || t("defaultBio", { firstName });

  return (
    /*
     * Mobile  — natural height, no max-height cap, no internal scroll.
     *           Compact layout: small image, smaller type, hidden bio,
     *           hidden language section, reduced spacing.
     * Desktop — unconstrained height, scrollable if content overflows
     *           (hidden scrollbar), full spacing restored.
     */
    <aside className="relative w-full overflow-x-hidden rounded-[2rem] border border-[#e7dccb] bg-[#fffdf9] [scrollbar-width:none] lg:overflow-y-auto lg:[&::-webkit-scrollbar]:hidden">
      {/* Botanical decoration */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <LeftBotanical className="absolute -right-10 -top-8 h-40 w-32 -rotate-20 text-[#b89664]/90" />
      </div>

      <div className="relative p-4 sm:p-5 lg:p-7">

        {/* ── Top grid: image + name block ── */}
        <div className="grid grid-cols-3 gap-3 lg:gap-6">

          {/* Profile image
              Mobile  — small square-ish thumbnail
              Desktop — tall portrait aspect */}
          <div className="relative col-span-1 mx-auto w-full rounded-[1.2rem] lg:rounded-[1.5rem]
                          aspect-square max-w-[5rem]
                          lg:aspect-[9/16] lg:max-w-[20rem]">
            <Image
              src={image}
              alt={name}
              fill
              priority
              sizes="(max-width: 1023px) 5rem, 20rem"
              className="object-cover lg:object-contain"
              unoptimized
            />
          </div>

          {/* Name + experience + languages
              Languages are hidden on mobile, shown on desktop. */}
          <div className="col-span-2 flex flex-col justify-center
                          border-b border-[#ede5d8]
                          pb-3 lg:mt-6 lg:pb-6">
            <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#b89664] lg:text-[10px]">
              {t("profile")}
            </p>
            <h1 className="mt-1 font-display font-semibold leading-tight text-[#2F3A2E]
                           text-lg lg:my-2 lg:text-3xl">
              {name}
            </h1>

            {yearsOfExperience > 0 && (
              <span className="mt-1 flex items-center gap-1.5 font-semibold text-[#2F3A2E]
                               text-[11px] lg:mb-3 lg:text-[12px]">
                <Star size={12} className="fill-[#b89664] text-[#b89664] lg:hidden" />
                <Star size={14} className="hidden fill-[#b89664] text-[#b89664] lg:block" />
                {t("experience", { count: yearsOfExperience })}
              </span>
            )}

            {/* Languages — desktop only */}
            {languages?.length > 0 && (
              <div className="hidden border-t border-[#ede5d8] pt-4 lg:block">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b8178]">
                  {t("languages")}
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {languages.map((language) => (
                    <span
                      key={language}
                      className="rounded-full border border-[#e7dccb] bg-[#fdf8f0] px-3 py-1.5 text-xs text-[#465044]"
                    >
                      {LANGUAGE_LABELS[language] || language}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bio — desktop only */}
        <p className="hidden mt-6 mb-4 text-sm leading-6 text-[#6f6a64] lg:block">
          {shortBio}
        </p>

        {/* Working hours — hidden on mobile, full size on desktop. */}
        {openDays.length > 0 && (
          <section className="hidden lg:block lg:pt-5" aria-labelledby="working-hours-title">
            <div className="flex items-center gap-2 lg:gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F3A2E] text-white">
                <Calendar size={15} />
              </span>
              <div>
                <h2
                  id="working-hours-title"
                  className="text-sm font-semibold text-[#2F3A2E] lg:text-base"
                >
                  {t("workingHours")}
                </h2>
                {/* Note line — desktop only, takes vertical space */}
                <p className="hidden text-xs text-[#8b8178] lg:block">
                  {t("workingHoursNote")}
                </p>
              </div>
            </div>

            <dl className="mt-4 divide-y divide-[#ede5d8] rounded-xl border border-[#ede5d8] bg-[#fdfaf4] px-4">
              {openDays.map((hour) => (
                <div
                  key={hour.day}
                  className="flex items-center justify-between gap-4 py-2.5 text-xs"
                >
                  <dt className="font-medium text-[#465044]">{t(`days.${hour.day}`)}</dt>
                  <dd className="font-semibold text-[#8b7046]">{`${hour.startTime} – ${hour.endTime}`}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Divider heart */}
        <div
          className="mt-4 flex items-center justify-center gap-2 text-[#b89664]/45 lg:mt-6"
          aria-hidden="true"
        >
          <span className="h-px w-10 bg-current" />
          <Heart size={13} className="fill-current" />
          <span className="h-px w-10 bg-current" />
        </div>
      </div>
    </aside>
  );
}
