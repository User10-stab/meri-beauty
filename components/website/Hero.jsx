import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { ArrowIcon, ClockIcon, MapPinIcon } from "./icons";
import { getSalon } from "@/actions/salon/get-salon";
import { groupWorkingDays } from "@/lib/groupWorkingDays";
import WorkshopBanner from "./WorkshopBanner";

export default async function Hero() {
  const t = await getTranslations("home");
  const salon = await getSalon();
  const workingDays = groupWorkingDays(salon?.data?.workingDays || []);
  const services = [
    t("serviceHair"),
    t("serviceFacial"),
    t("serviceManicure"),
    t("serviceMassage"),
    t("serviceMakeup"),
    t("serviceBody"),
  ];

  return (
    <div className="relative w-full">
      <section id="accueil" className="relative flex w-full flex-col" style={{ minHeight: "92vh" }}>
        <div className="absolute inset-0 -z-10">
          <Image src="/Images/hero.webp" alt="" fill priority sizes="100vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/40 to-black/65" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-primary/25 to-transparent" />
        </div>

        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-start justify-center px-6 py-28 pr-6 md:px-10 lg:px-14 lg:py-36 lg:pr-[380px]">
          <div className="mb-7 inline-flex items-center gap-3">
            <span className="h-px w-12 bg-gold" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.22em] text-gold">{t("heroEyebrow")}</span>
          </div>

          <h1 className="w-full text-[2.55rem] font-bold leading-[1.05] tracking-tight text-white sm:text-[4.2rem] lg:text-[5.5rem]">
            {t("title")}{" "}
            <em className="block font-light text-gold/90 not-italic">{t("heroTitleAccent")}</em>
          </h1>

          <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-white/70 sm:text-[18px] lg:text-[19px]">
            {t("heroDescription")}
          </p>

          <div className="mt-10 flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <a href="/reservation" className="group inline-flex items-center justify-center gap-3 rounded-full bg-gold px-6 py-4 text-[15px] font-semibold text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20 sm:px-9">
              {t("heroBook")}
              <ArrowIcon className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </a>
            <a href="#concept" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 px-6 py-4 text-[15px] font-semibold text-white backdrop-blur-sm transition-all duration-300 hover:border-white/60 hover:bg-white/10 sm:px-9">
              {t("heroConcept")}
            </a>
          </div>
        </div>

        <div className="w-full overflow-hidden border-t border-white/10 bg-black/40 py-5 backdrop-blur-sm">
          <div className="flex w-max animate-marquee">
            <MarqueeGroup services={services} />
            <MarqueeGroup services={services} aria-hidden="true" />
          </div>
        </div>
      </section>

      <WorkshopBanner />

      <aside aria-label={t("openingHours")} className="absolute right-6 z-20 hidden w-[330px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/25 sm:right-10 lg:right-14 lg:block xl:right-20" style={{ transform: "translateY(-50%)" }}>
        <div className="bg-gold px-6 py-5">
          <div className="flex items-start gap-2.5">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-white/80" />
            <p className="whitespace-pre-line text-[14px] font-semibold leading-snug text-white">
              {salon?.data?.address || t("addressUnavailable")}
            </p>
          </div>
        </div>

        <div className="px-6 py-6">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-[1.3rem] font-bold uppercase leading-[1.1] tracking-tight text-ink">{t("openingHours")}</h2>
            <ClockIcon className="mt-0.5 h-9 w-9 text-gold" />
          </div>
          <ul className="flex flex-col gap-4">
            {workingDays.length > 0 ? (
              workingDays.map((item) => (
                <li key={item.label} className="border-b border-black/8 pb-4 last:border-0 last:pb-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/40">{item.label}</p>
                  <p className="mt-1 text-[1.15rem] font-light text-gold">{item.hours}</p>
                </li>
              ))
            ) : (
              <li>
                <p className="text-sm text-gray-500">{t("openingHoursUnavailable")}</p>
              </li>
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function MarqueeGroup({ services, ...props }) {
  return (
    <div className="flex shrink-0 items-center gap-6 pr-6 sm:gap-12 sm:pr-12" {...props}>
      {services.map((service) => (
        <span key={service} className="flex items-center gap-6 text-[12px] font-medium uppercase tracking-[0.18em] text-white/60 sm:gap-12 sm:text-[13px]">
          {service}
          <span className="h-1.5 w-1.5 rounded-full bg-gold/70" />
        </span>
      ))}
    </div>
  );
}
