"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function PageHero({
  title,
  description,
  buttonText,
  buttonLink = "#booking",
  backgroundImage = "/images/heroImage.webp",
  label,
}) {
  const tHome = useTranslations("home");

  return (
    <section className="relative h-[700px] overflow-hidden bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url('${backgroundImage}')` }}>
      <div className="mx-auto grid h-full w-full items-center lg:grid-cols-3">
        <div className="relative z-10 flex h-full w-full flex-col items-center bg-[#2F3A2E]/90 px-6 py-24">
          <div className="mx-auto w-3/4 text-center lg:text-left">
            <span className="mb-5 inline-block text-sm font-semibold uppercase tracking-[0.32em] text-[#C8A46A]">
              {label || tHome("bookNow")}
            </span>
            <h1 className="max-w-xl text-5xl font-bold leading-tight text-[#F8F6F2] lg:text-[5rem]">{title || tHome("title")}</h1>
            <div className="mt-8 h-[3px] w-20 rounded-full bg-[#C8A46A]" />
            <p className="mt-8 max-w-lg text-[17px] leading-9 text-gray-300">{description || tHome("subtitle")}</p>
            <div className="mt-12 flex flex-wrap gap-5">
              <Link href={buttonLink} className="inline-flex items-center gap-3 rounded-xl bg-[#C8A46A] px-6 py-4 font-medium text-white transition hover:-translate-y-1 hover:bg-[#243022]">
                {buttonText || tHome("bookNow")}
              </Link>
            </div>
          </div>
        </div>
        <div className="relative h-full w-full bg-black/20 lg:col-span-2">
          <div className="absolute inset-y-0 left-0 w-52 bg-gradient-to-r from-[#2F3A2E]/90 via-[#2F3A2E]/80 to-transparent" />
        </div>
      </div>
    </section>
  );
}
