"use client";

import Image from "next/image";
import { Calendar, Clock, Heart, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { LeftBotanical, BotanicalSprig } from "@/components/botanical-decorations";

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

const LANGUAGE_LABELS = {
  FRENCH: "Français", ENGLISH: "English", ARABIC: "العربية", SPANISH: "Español",
  DUTCH: "Nederlands", GERMAN: "Deutsch", PORTUGUESE: "Português", ITALIAN: "Italiano",
};

export default function StaffProfileHero({ name, firstName, bio, yearsOfExperience, languages, rythme, workingHours, image, socialLinks, categories }) {
  const t = useTranslations("staffProfile");
  const hoursByDay = new Map((workingHours || []).map((hour) => [hour.day, hour]));
  const schedule = DAYS.map((day) => hoursByDay.get(day) || { day, isClosed: true });
  const shortBio = bio || t("defaultBio", { firstName });

  return (
    <aside className="relative overflow-hidden rounded-[2rem] border border-[#e7dccb] bg-[#fffdf9]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <LeftBotanical className="absolute -right-10 -top-8 h-40 w-32 -rotate-20 text-[#b89664]/90" />
        {/* <LeftBotanical className="absolute -bottom-12 -left-8 h-32 w-30 -rotate-12 text-[#b89664]/90" /> */}
      </div>
      <div className="relative p-5 sm:p-7">
        <div className="grid grid-cols-3 gap-6">
            <div className="relative col-span-1 mx-auto aspect-[9/16] w-full max-w-[18rem]  rounded-[1.5rem] bg-[#efe5d7] sm:max-w-[20rem]">
            <Image src={image} alt={name} fill priority sizes="(max-width: 640px) 18rem, (max-width: 1023px) 20rem, 20rem" className="object-contain rounded-xl" unoptimized />
            {/* {yearsOfExperience > 0 && (
              <span className="absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-white/95 px-3 py-1.5 text-[11px] w-[145px] z-2 font-semibold text-[#2F3A2E]">
                <Star size={14} className="fill-[#b89664] text-[#b89664]" />{t("experience", { count: yearsOfExperience })}
              </span>
            )} */}
            </div>
            <div className="col-span-2 mt-6 border-b border-[#ede5d8] pb-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b89664]">{t("profile")}</p>
              <h1 className="my-2 font-display text-3xl font-semibold leading-tight text-[#2F3A2E]">{name}</h1>
               {yearsOfExperience > 0 && (
              <span className="flex items-center gap-2 font-semibold text-[#2F3A2E] text-[12px] mb-3">
                <Star size={14} className="fill-[#b89664] text-[#b89664]" />{t("experience", { count: yearsOfExperience })}
              </span>
              )}
               {languages?.length > 0 && (
              <div className="border-t border-[#ede5d8] pt-4">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b8178]">{t("languages")}</h2>
                <div className="mt-3 flex flex-wrap gap-2">{languages.map((language) => <span key={language} className="rounded-full border border-[#e7dccb] bg-[#fdf8f0] px-3 py-1.5 text-xs text-[#465044]">{LANGUAGE_LABELS[language] || language}</span>)}</div>
              </div>
              )}
             
            </div>
        </div>
        {/* <p className="mt-2 text-sm font-medium text-[#8b7046]">{categories?.join(" · ") || t("professional")}</p> */}
              <p className="mt-6 mb-4 text-sm leading-6 text-[#6f6a64]">{shortBio}</p>
             
        
        {rythme && (
          <div className="flex items-center gap-3 border-b border-[#ede5d8] py-5"><Clock size={17} className="shrink-0 text-[#b89664]" /><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b8178]">{t("workRhythm")}</p><p className="mt-1 text-sm font-medium text-[#2F3A2E]">{t(`rhythm.${rythme}`)}</p></div></div>
        )}
        <section className="pt-5" aria-labelledby="working-hours-title">
          <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2F3A2E] text-white"><Calendar size={15} /></span><div><h2 id="working-hours-title" className="text-base font-semibold text-[#2F3A2E]">{t("workingHours")}</h2><p className="text-xs text-[#8b8178]">{t("workingHoursNote")}</p></div></div>
          <dl className="mt-4 divide-y divide-[#ede5d8] rounded-xl border border-[#ede5d8] bg-[#fdfaf4] px-4">
            {schedule.map((hour) => <div key={hour.day} className="flex items-center justify-between gap-4 py-2.5 text-xs"><dt className="font-medium text-[#465044]">{t(`days.${hour.day}`)}</dt><dd className={hour.isClosed ? "text-[#9a9590]" : "font-semibold text-[#8b7046]"}>{hour.isClosed ? t("closed") : `${hour.startTime} – ${hour.endTime}`}</dd></div>)}
          </dl>
        </section>
        {Object.entries(socialLinks || {}).filter(([, url]) => url).length > 0 && (
          <section className="pt-5" aria-labelledby="social-links-title">
            <h2 id="social-links-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8b8178]">{t("follow")}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(socialLinks).filter(([, url]) => url).map(([platform, url]) => (
                <a key={platform} href={url} target="_blank" rel="noreferrer" className="rounded-full border border-[#e7dccb] bg-white px-3 py-1.5 text-xs font-medium capitalize text-[#465044] transition-colors hover:border-[#b89664] hover:text-[#8b7046]">{platform}</a>
              ))}
            </div>
          </section>
        )}
        <div className="mt-6 flex items-center justify-center gap-2 text-[#b89664]/45" aria-hidden="true"><span className="h-px w-10 bg-current" /><Heart size={13} className="fill-current" /><span className="h-px w-10 bg-current" /></div>
      </div>
    </aside>
  );
}
