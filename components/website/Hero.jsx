import Image from "next/image";
import { ArrowIcon, ClockIcon, MapPinIcon } from "./icons";
import { getSalon } from "@/actions/salon/get-salon";
import { groupWorkingDays } from "@/lib/groupWorkingDays";
import WorkshopBanner from "./WorkshopBanner";
import { getTranslations } from "next-intl/server";

export default async function Hero() {
  const [salon, t] = await Promise.all([getSalon(), getTranslations("home")]);

  const workingDays = groupWorkingDays(salon?.data?.workingDays || []);

  const services = [
    t("servicePedicure"),
    t("serviceFacial"),
    t("serviceManicure"),
    t("serviceMassage"),
    t("serviceGel"),
    t("serviceBody"),
  ];

  return (
    /* Outer wrapper: relative so the card can be absolutely positioned.
       Right padding reserves space so the card doesn't overlap the text. */
    <div className="relative w-full">

      {/* ══════════════════════════════════════
          HERO SECTION
      ══════════════════════════════════════ */}
      {/* `isolate` makes this section its own stacking context, which the
          full-bleed background below depends on. Without it the -z-10
          background is a negative-z child of the root context, and the
          painting order puts it *behind* the `bg-white` that (public)/layout
          sets on <main> — the photo loads, then gets covered in white. */}
      <section
        id="accueil"
        className="relative isolate flex w-full flex-col"
        style={{ minHeight: "92vh" }}
      >
        {/* Full-bleed background */}
        <div className="absolute inset-0 -z-10">
          <Image
            src="/Images/hero.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/40 to-black/65" />
          <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-primary/25 to-transparent" />
        </div>

        {/* Hero content — flex-1 so marquee is pushed to the bottom */}
        <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-center text-center justify-center px-4 py-16 pr-4 sm:items-start sm:text-left sm:px-6 sm:py-20 md:px-10 md:py-28 lg:px-14 lg:py-36 lg:pr-[380px]">

          {/* Eyebrow */}
          <div className="mb-5 inline-flex items-center gap-2 sm:mb-7 sm:gap-3">
            <span className="h-px w-8 sm:w-12 bg-gold" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold sm:text-[13px]">
              {t("heroEyebrow")}
            </span>
          </div>

          {/* Headline */}
          <h1 className="w-full text-[2rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.5rem] md:text-[3.5rem] lg:text-[5.5rem]">
           {t("heroHeadline")}{" "}
            <em className="block font-light text-gold/90 italic">
              {t("heroTitleAccent")}
            </em>
          </h1>

          {/* Sub-copy */}
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70 sm:mt-6 sm:max-w-xl sm:text-[16px] md:mt-8 md:text-[17px] lg:text-[19px]">
            {t("heroDescription")}
          </p>

          {/* CTAs */}
          <div className="mt-5 flex w-full max-w-xs flex-col items-center gap-2.5 sm:mt-8 sm:w-auto sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <a
              href="/reservation"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-gold px-4 py-2.5 text-[13px] text-white shadow-lg transition-all duration-300 hover:bg-gold/90 hover:shadow-xl hover:shadow-gold/20 sm:px-8 sm:py-4 sm:gap-3 sm:text-[15px] lg:px-9"
            >
              {t("heroBook")}
              <ArrowIcon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1 sm:h-4 sm:w-4" />
            </a>
            <a
              href="#concept"
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/30 px-4 py-2.5 text-[13px] text-white backdrop-blur-sm transition-all duration-300 hover:border-white/60 hover:bg-white/10 sm:px-8 sm:py-4 sm:gap-2 sm:text-[15px] lg:px-9"
            >
              {t("heroConcept")}
            </a>
          </div>

        </div>

        {/* ── Marquee strip — last child, sits on the hero background ── */}
        <div className="w-full overflow-hidden border-t border-white/10 bg-black/40 py-3 backdrop-blur-sm sm:py-5">
          <div className="flex w-max animate-marquee">
            <MarqueeGroup services={services} />
            <MarqueeGroup services={services} aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* Event/workshop promo card — floats over the hero's top-right on
          desktop, plain strip under the hero on mobile (see WorkshopBanner). */}
      <WorkshopBanner />

      {/* ══════════════════════════════════════
          OPENING HOURS FLOATING CARD
          Vertically centered on the right side
          of the hero section.

          top-1/2 pairs with the -50% shift below to centre the card. Without
          it the element fell back to its static position — the bottom of the
          hero — and the transform then lifted it by half its own height,
          leaving it hanging off the hero's lower edge rather than centred.
      ══════════════════════════════════════ */}
     <aside
  aria-label={t("openingHours")}
  className="absolute right-4 top-1/2 z-20 hidden w-[280px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/25 sm:right-6 sm:w-[300px] md:right-8 md:w-[320px] lg:right-14 lg:block lg:w-[330px] xl:right-20"
  style={{
    transform: "translateY(-50%)",
  }}
>
  {/* Address */}
  <div className="bg-gold px-6 py-5">
    <div className="flex items-start gap-2.5">
      <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-white/80" />

      <p className="whitespace-pre-line text-[14px] font-semibold leading-snug text-white">
        {salon?.data?.address || t("addressUnavailable")}
      </p>
    </div>
  </div>

  {/* Card Body */}
  <div className="px-6 py-6">
    <div className="mb-6 flex items-center gap-4 justify-between">
      <h2 className="text-[1.3rem] font-bold uppercase leading-[1.1] tracking-tight text-ink">
        {t("openingHours")}
      </h2>

      <ClockIcon className="mt-0.5 h-9 w-9 text-gold" />
    </div>

    <ul className="flex flex-col gap-4">
      {workingDays.length > 0 ? (
        workingDays.map((item) => (
          <li
            key={item.label}
            className="border-b border-black/8 pb-4 last:border-0 last:pb-0"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/40">
              {item.label}
            </p>

            <p className="mt-1 text-[1.15rem] font-light text-gold">
              {item.hours}
            </p>
          </li>
        ))
      ) : (
        <li>
          <p className="text-sm text-gray-500">
            {t("openingHoursUnavailable")}
          </p>
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
        <span
          key={service}
          className="flex items-center gap-6 text-[12px] font-medium uppercase tracking-[0.18em] text-white/60 sm:gap-12 sm:text-[13px]"
        >
          {service}
          <span className="h-1.5 w-1.5 rounded-full bg-gold/70" />
        </span>
      ))}
    </div>
  );
}
